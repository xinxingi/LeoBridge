import { ThemeResources,presentationContext } from '../themes/resources.ts';
import { authorize,type Config } from '../core/config.ts';
import { StoreNetwork } from '../management/store-network.ts';
import { Admin } from '../management/admin.ts';
import { installationFromUrl,installationUrl,PREVIEW_PARAMETER,type ManagementConfig } from '../management/config.ts';
import { protocolApplications,type ProtocolApplication } from './protocols.ts';
import type { ThemeStore,Installation } from '../themes/store.ts';
import { errorResponse,json } from '../core/http.ts';
import { BridgeError } from '../core/errors.ts';
import { sourceConfig } from '../core/source.ts';
import { SourceManagement } from '../management/source.ts';
import { Upstream } from '../upstream/client.ts';
import { previewHtml, previewRedirect } from './preview.ts';
export class Site {
  readonly admin:Admin;
  private resources:ThemeResources;
  onActiveThemeChange:()=>void=()=>{};
  protocols:Record<string,ProtocolApplication>;
  private sourceVersion=0;
  private sourceSessions=new Set<{close():void}>();
  private initial:Config;
  constructor(public config:Config,readonly management:ManagementConfig,readonly store:ThemeStore,loadUi:(path:string)=>Promise<Response>,network?:StoreNetwork){
    this.initial=config;
    network??=new StoreNetwork(store);
    this.resources=new ThemeResources(run=>network!.run(run));
    this.admin=new Admin(management,store,loadUi,new SourceManagement(config,store,c=>new Upstream(c).snapshot(true)),network);
    this.protocols=this.applications();
  }
  private applications(){
    if(!this.config.baseUrl)return {};
    const version=this.sourceVersion,protocols=protocolApplications(this.config);
    for(const protocol of Object.values(protocols)){
      const open=protocol.openRealtime;
      protocol.openRealtime=(client,connect,path,presentation)=>{
        let session:{close():void}|undefined,closed=false,queue=Promise.resolve();
        const close=()=>{if(closed)return;closed=true;session?.close();if(session)this.sourceSessions.delete(session);};
        const current=async()=>{if(closed)return false;if(((await this.store.state()).source?.version??0)!==version){close();return false;}return true;};
        session=open({close:(code,reason)=>client.close(code,reason),onMessage:fn=>client.onMessage(fn),onClose:fn=>client.onClose(fn),onError:fn=>client.onError(fn),send:data=>{queue=queue.then(async()=>{if(await current())client.send(data);}).catch(close);}},async()=>{if(!await current())throw new BridgeError('SOURCE_CHANGED',409,'数据源已变更，请重新连接。');return connect();},path,presentation);
        this.sourceSessions.add(session);client.onClose(close);return {close};
      };
    }
    return protocols;
  }
  private async syncSource(){
    const source=(await this.store.state()).source;
    if(source&&source.version>this.sourceVersion){
      this.config=sourceConfig(this.initial,source);this.sourceVersion=source.version;
      for(const session of this.sourceSessions)session.close();this.sourceSessions.clear();
      this.protocols=this.applications();
    }
  }
  private async version(url:URL){
    if(this.management.routing==='single'&&url.origin===this.management.displayOrigin&&!url.searchParams.has(PREVIEW_PARAMETER)){
      const state=await this.store.state(),item=state.active?state.installations[state.active]:undefined;
      return item?{item,id:item.id,preview:false}:null;
    }
    const selected=installationFromUrl(this.management,url);if(!selected)return null;const item=(await this.store.state()).installations[selected.id];
    if(!item)throw new BridgeError('PREVIEW_NOT_FOUND',404,'此主题版本不存在，请从后台重新打开预览。');
    return {item,...selected};}
  async websocket(request:Request):Promise<ProtocolApplication|null>{
    await this.syncSource();if(!this.config.baseUrl)return null;
    const url=new URL(request.url);
    if(authorize(request,this.config))return null;
    if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return null;
    const selected=await this.version(url);if(!selected)return null;
    const protocol=this.protocols[selected.item.protocolProfile];
    if(!protocol?.websocketPaths.includes(url.pathname))return null;
    const presentation=presentationContext(selected.item);
    return {...protocol,openRealtime:(client,connect,path)=>protocol.openRealtime(client,connect,path,presentation)};
  }
  async fetch(request:Request):Promise<Response>{
    const url=new URL(request.url);
    const single=this.management.routing==='single';
    if(single&&url.searchParams.has(PREVIEW_PARAMETER)&&(url.pathname.startsWith('/admin')||url.pathname.startsWith('/manage')))return new Response('预览不提供管理接口。',{status:404});
    if(url.origin===this.management.adminOrigin&&(!single||url.pathname==='/admin'||url.pathname.startsWith('/admin/'))){
      const response=await this.admin.handle(request);
      if(request.method==='POST'&&response.ok&&url.pathname.endsWith('/source/save'))await this.syncSource();
      if(single&&request.method==='POST'&&response.ok&&['/admin/api/activate','/admin/api/rollback'].includes(url.pathname))this.onActiveThemeChange();
      return response;
    }
    try{
      if(single&&url.origin===this.management.displayOrigin){
        const denied=authorize(request,this.config);if(denied)return denied;
        const redirect=previewRedirect(request);if(redirect)return redirect;
      }
      await this.syncSource();const sourceVersion=this.sourceVersion;
      const isRoot=url.origin===this.management.displayOrigin;
      const selected=isRoot&&!single?null:await this.version(url);
      if(!isRoot&&!selected)return new Response('Not found',{status:404});
      const denied=authorize(request,this.config);if(denied)return denied;
      if(!this.config.baseUrl){
        if(url.pathname==='/')return this.setupResponse(request,true);
        throw new BridgeError('SOURCE_NOT_CONFIGURED',503,'请管理员在后台配置数据源。');
      }
      if(isRoot&&!single){
        const state=await this.store.state();if(!state.active)return this.setupResponse(request);
        const target=new URL(installationUrl(this.management,state.active));target.pathname=url.pathname;target.search=url.search;
        return new Response(null,{status:307,headers:{Location:target.href,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
      }
      if(!selected)return this.setupResponse(request);
      const {item}=selected;const protocol=this.protocols[item.protocolProfile];
      if(!protocol)throw new BridgeError('PROTOCOL_UNSUPPORTED',409,'此主题协议尚未实现。');
      if(url.pathname.startsWith('/manage')||url.pathname.startsWith('/admin'))return new Response('主题不能访问管理后台。',{status:404});
      if(url.pathname==='/__bridge/version')return json({id:item.id,ecosystem:item.ecosystem,protocolProfile:item.protocolProfile,preview:selected!.preview});
      if(protocol.websocketPaths.includes(url.pathname)&&request.headers.get('upgrade')?.toLowerCase()==='websocket')return new Response('WebSocket runtime upgrade required',{status:426});
      const result=await protocol.fetch(request,presentationContext(item));
      if(((await this.store.state()).source?.version??0)!==sourceVersion)throw new BridgeError('SOURCE_CHANGED',409,'数据源已变更，请刷新后重试。');
      if(result)return result;
      if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405});
      let path:string;try{path=decodeURIComponent(url.pathname).slice(1)||item.entry;}catch{return new Response('Not found',{status:404});}
      let defaultOnly=false;
      if(item.ecosystem==='komari'&&path.startsWith('themes/')&&!this.resources.has(item,path)){
        const match=/^themes\/([^/]+)\/(.+)$/.exec(path);
        if(!match||![item.themeId,'default'].includes(match[1]))return new Response('Theme not found',{status:404});
        defaultOnly=match[1]==='default'&&item.themeId!=='default';
        path=match[2]!;
        if(path==='komari-theme.json'&&!defaultOnly&&item.manifest)return json(item.manifest);
        path=path.startsWith('dist/')?path.slice(5):Object.hasOwn(item.files,`.komari/${path}`)?`.komari/${path}`:path;
      }
      let asset=!defaultOnly&&Object.hasOwn(item.files,path)?await this.store.asset(item.id,path):null;
      if(!asset&&(this.resources.has(item,path)||path.split('/').at(-1)?.includes('.')))asset=await this.resources.get(item,path,defaultOnly);
      if(!asset&&request.headers.get('accept')?.includes('text/html')&&!path.split('/').at(-1)?.includes('.'))asset=await this.store.asset(item.id,item.entry);
      if(!asset)return new Response('Theme asset not found',{status:404});
      await this.resources.observe(item,path,asset);
      return this.assetResponse(request,item,asset,single&&isRoot&&selected.preview);
    }catch(error){return errorResponse(error);}
  }
  private setupResponse(request:Request,sourceMissing=false){
    if(new URL(request.url).pathname!=='/')return new Response('尚未启用展示主题。',{status:404});
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
    const adminUrl=this.management.routing==='single'?'/admin/':this.management.adminOrigin;
    const href=adminUrl.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
    const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>LeoBridge · 初始化</title><body><main><h1>LeoBridge</h1><p>${sourceMissing?'尚未配置数据源。请管理员登录后台，填写主控地址和探针 Token，检查连接并确认节点绑定。':'尚未启用展示主题。请管理员登录后台，从 CFSM 或 Komari 商店按需安装主题，完成预览后启用。'}</p><p>本项目默认不内置第三方主题。</p><a href="${href}">进入管理后台</a></main></body></html>`;
    return new Response(request.method==='HEAD'?null:html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
  }
  private assetResponse(request:Request,item:Installation,asset:{bytes:Uint8Array;contentType:string},preview=false){
    const url=new URL(request.url),wsOrigin=url.origin.replace(/^http/,'ws');
    let body:BodyInit=asset.bytes as BodyInit;
    if(preview&&asset.contentType.startsWith('text/html'))body=previewHtml(new TextDecoder().decode(asset.bytes),item.id);
    const response=new Response(request.method==='HEAD'?null:body,{headers:{'Content-Type':asset.contentType,'Cache-Control':(this.management.routing==='single'&&url.origin===this.management.displayOrigin)||asset.contentType.startsWith('text/html')?'no-store':'private, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Referrer-Policy':preview?'same-origin':'no-referrer','Vary':'Referer','Cross-Origin-Resource-Policy':'same-origin','X-Frame-Options':'DENY'}});
    response.headers.set('Content-Security-Policy',`default-src 'none'; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' https: data: blob:; font-src 'self' https: data:; media-src 'self' https: data: blob:; connect-src 'self' ${wsOrigin} https:; frame-src https:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'`);
    return response;
  }
}
