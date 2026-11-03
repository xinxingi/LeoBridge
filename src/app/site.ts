import { authorize,type Config } from '../core/config.ts';
import { Admin } from '../management/admin.ts';
import { installationFromUrl,installationUrl,type ManagementConfig } from '../management/config.ts';
import { protocolApplications,type ProtocolApplication } from './protocols.ts';
import type { ThemeStore,Installation } from '../themes/store.ts';
import { errorResponse,json } from '../core/http.ts';
import { BridgeError } from '../core/errors.ts';
export class Site {
  readonly admin:Admin;
  onActiveThemeChange:()=>void=()=>{};
  readonly protocols:Record<string,ProtocolApplication>;
  constructor(readonly config:Config,readonly management:ManagementConfig,readonly store:ThemeStore,loadUi:(path:string)=>Promise<Response>){
    this.admin=new Admin(management,store,loadUi);this.protocols=protocolApplications(config);
  }
  private async version(url:URL){
    if(this.management.routing==='single'&&url.origin===this.management.displayOrigin){
      const state=await this.store.state(),item=state.active?state.installations[state.active]:undefined;
      return item?{item,id:item.id,preview:false}:null;
    }
    const selected=installationFromUrl(this.management,url);if(!selected)return null;const item=(await this.store.state()).installations[selected.id];return item?{item,...selected}:null;}
  async websocket(request:Request):Promise<ProtocolApplication|null>{
    const url=new URL(request.url);
    if(authorize(request,this.config))return null;
    if(request.headers.get('origin')&&request.headers.get('origin')!==url.origin)return null;
    const selected=await this.version(url);if(!selected)return null;
    const protocol=this.protocols[selected.item.protocolProfile];return protocol?.websocketPaths.includes(url.pathname)?protocol:null;
  }
  async fetch(request:Request):Promise<Response>{
    const url=new URL(request.url);
    const single=this.management.routing==='single';
    if(url.origin===this.management.adminOrigin&&(!single||url.pathname==='/admin'||url.pathname.startsWith('/admin/'))){
      const response=await this.admin.handle(request);
      if(single&&request.method==='POST'&&response.ok&&['/admin/api/activate','/admin/api/rollback'].includes(url.pathname))this.onActiveThemeChange();
      return response;
    }
    try{
      const isRoot=url.origin===this.management.displayOrigin;
      const selected=isRoot&&!single?null:await this.version(url);
      if(!isRoot&&!selected)return new Response('Not found',{status:404});
      const denied=authorize(request,this.config);if(denied)return denied;
      if(isRoot&&!single){
        const state=await this.store.state();if(!state.active)return new Response('尚未启用展示主题。',{status:503});
        const target=new URL(installationUrl(this.management,state.active));target.pathname=url.pathname;target.search=url.search;
        return new Response(null,{status:307,headers:{Location:target.href,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
      }
      if(!selected)return new Response('尚未启用展示主题。',{status:503});
      const {item}=selected;const protocol=this.protocols[item.protocolProfile];
      if(!protocol)throw new BridgeError('PROTOCOL_UNSUPPORTED',409,'此主题协议尚未实现。');
      if(url.pathname.startsWith('/manage')||url.pathname.startsWith('/admin'))return new Response('主题不能访问管理后台。',{status:404});
      if(url.pathname==='/__bridge/version')return json({id:item.id,ecosystem:item.ecosystem,protocolProfile:item.protocolProfile,preview:selected!.preview});
      if(protocol.websocketPaths.includes(url.pathname)&&request.headers.get('upgrade')?.toLowerCase()==='websocket')return new Response('WebSocket runtime upgrade required',{status:426});
      const result=await protocol.fetch(request);if(result)return result;
      if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405});
      let path:string;try{path=decodeURIComponent(url.pathname).slice(1)||item.entry;}catch{return new Response('Not found',{status:404});}
      let asset=item.files[path]?await this.store.asset(item.id,path):null;
      if(!asset&&request.headers.get('accept')?.includes('text/html')&&!path.split('/').at(-1)?.includes('.'))asset=await this.store.asset(item.id,item.entry);
      if(!asset)return new Response('Theme asset not found',{status:404});
      return this.assetResponse(request,item,asset);
    }catch(error){return errorResponse(error);}
  }
  private assetResponse(request:Request,item:Installation,asset:{bytes:Uint8Array;contentType:string}){
    const url=new URL(request.url),wsOrigin=url.origin.replace(/^http/,'ws');
    const response=new Response(request.method==='HEAD'?null:asset.bytes as BodyInit,{headers:{'Content-Type':asset.contentType,'Cache-Control':(this.management.routing==='single'&&url.origin===this.management.displayOrigin)||asset.contentType.startsWith('text/html')?'no-store':'private, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin','X-Frame-Options':'DENY'}});
    response.headers.set('Content-Security-Policy',`default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ${wsOrigin}; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'`);
    return response;
  }
}
