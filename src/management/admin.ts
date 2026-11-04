import { isNativeTheme, type NativeTheme } from '../core/presentation.ts';
import { BridgeError } from '../core/errors.ts';
import { errorResponse,json } from '../core/http.ts';
import { commitInstallation,publicThemeState,sha256,INSTALL_NOTICE_VERSION,INSTALL_NOTICE_TEXT,type ThemeStore,type Installation,type InstallReview } from '../themes/store.ts';
import { installationUrl,type ManagementConfig } from './config.ts';
import { fetchCatalog,ThemePackageError } from '../themes/catalog.ts';
import { StoreNetwork } from './store-network.ts';
import { CatalogStars } from '../themes/stars.ts';
import type { SourceManagement } from './source.ts';

import { DEFAULT_ADMIN_PASSWORD,constantEqual,hashPassword,validatePassword,verifyPassword } from './password.ts';
const token=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');
export class Admin {
  private attempts=new Map<string,{count:number;until:number}>();
  private installing=false;
  private stars=new CatalogStars();
  constructor(readonly config:ManagementConfig,readonly store:ThemeStore,private loadUi:(path:string)=>Promise<Response>,private source?:SourceManagement,private network=new StoreNetwork(store)){ }
  private cookieName(){return this.config.routing==='single'?(this.config.adminOrigin.startsWith('https:')?'__Secure-leobridge_admin_path':'leobridge_admin_path'):(this.config.adminOrigin.startsWith('https:')?'__Host-leobridge_admin':'leobridge_admin_local');}
  private cookie(value:string,maxAge=14400){return `${this.cookieName()}=${value}; Path=${this.config.routing==='single'?'/admin':'/'}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${this.config.adminOrigin.startsWith('https:')?'; Secure':''}`;}
  private async session(request:Request){
    const raw=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${this.cookieName()}=`))?.split('=')[1]||'';
    if(!/^[a-f0-9]{64}$/.test(raw))return null;
    const id=await sha256(raw),state=await this.store.state(),session=state.sessions[id],credentialVersion=state.adminCredential?.version??0;
    return session&&session.expires>Date.now()&&(session.credentialVersion??0)===credentialVersion?{id,...session,credentialVersion,mustChangePassword:!state.adminCredential}:null;
  }
  async handle(request:Request):Promise<Response>{
    const url=new URL(request.url);
    try{
      if(url.origin!==this.config.adminOrigin)return new Response('Not found',{status:404});
      if(this.config.routing==='single'){
        if(url.pathname==='/admin')return this.secure(new Response(null,{status:308,headers:{Location:'/admin/'}}));
        if(!url.pathname.startsWith('/admin/'))return new Response('Not found',{status:404});
        url.pathname=url.pathname.startsWith('/admin/api/')?url.pathname.replace('/admin/api/','/manage/api/'):url.pathname.slice('/admin'.length);
      }
      if(!url.pathname.startsWith('/manage/api/')){
        if(request.method!=='GET')throw new BridgeError('METHOD_NOT_ALLOWED',405,'请求方法不支持。');
        if(!['/','/app.js','/data-interfaces.js','/appearance.js','/styles.css','/logo.svg'].includes(url.pathname))return new Response('Not found',{status:404});
        return this.secure(await this.loadUi(url.pathname==='/'?'index.html':url.pathname.slice(1)));
      }
      if(request.method!=='GET'&&request.headers.get('origin')!==this.config.adminOrigin)throw new BridgeError('ORIGIN_REJECTED',403,'管理操作必须来自管理站本身。');
      if(request.method==='POST'&&request.headers.get('content-type')?.split(';')[0]!=='application/json')throw new BridgeError('CONTENT_TYPE',415,'管理请求必须为JSON。');
      let body:Record<string,unknown>={};
      if(request.method==='POST'){
        const text=await request.text();if(text.length>(url.pathname.startsWith('/manage/api/source')?131072:8192))throw new BridgeError('REQUEST_TOO_LARGE',413,'请求过大。');
        try{body=JSON.parse(text);if(!body||typeof body!=='object'||Array.isArray(body))throw new Error();}catch{throw new BridgeError('BAD_REQUEST',400,'请求JSON无效。');}
      }
      if(url.pathname==='/manage/api/login-info'&&request.method==='GET'){
        const credentialSource=(await this.store.state()).adminCredential?'saved':'default';
        return this.secure(json({showInitialPasswordHint:credentialSource==='default',credentialSource}));
      }
      if(url.pathname==='/manage/api/login'&&request.method==='POST'){
        const client=request.headers.get('cf-connecting-ip')||'local';const now=Date.now();
        if(this.attempts.size>1000)this.attempts.clear();
        let attempt=this.attempts.get(client);if(!attempt||attempt.until<now){attempt={count:0,until:now+60000};this.attempts.set(client,attempt);}
        if(++attempt.count>10)throw new BridgeError('LOGIN_THROTTLED',429,'尝试过于频繁，请稍后重试。');
        const credential=(await this.store.state()).adminCredential;
        if(!constantEqual(String(body.username||''),this.config.username)||typeof body.password!=='string'||!(credential?await verifyPassword(body.password,credential):constantEqual(body.password,DEFAULT_ADMIN_PASSWORD)))throw new BridgeError('LOGIN_FAILED',401,'用户名或密码错误。');
        const raw=token(),csrf=token();await this.store.command({type:'session',id:await sha256(raw),session:{csrf,expires:now+4*3600000,credentialVersion:credential?.version??0}});
        this.attempts.delete(client);const response=json({ok:true,csrf,mustChangePassword:!credential});response.headers.set('Set-Cookie',this.cookie(raw));return this.secure(response);
      }
      const session=await this.session(request);if(!session)throw new BridgeError('LOGIN_REQUIRED',401,'请登录LeoBridge管理站。');
      if(request.method!=='GET'&&!constantEqual(request.headers.get('x-csrf-token')||'',session.csrf))throw new BridgeError('CSRF_REJECTED',403,'管理会话校验失败。');
      if(url.pathname==='/manage/api/session'&&request.method==='GET')return this.secure(json({csrf:session.csrf,username:this.config.username,mustChangePassword:session.mustChangePassword}));
      if(url.pathname==='/manage/api/logout'&&request.method==='POST'){
        await this.store.command({type:'logout',id:session.id});const response=json({ok:true});response.headers.set('Set-Cookie',this.cookie('',0));return this.secure(response);
      }
      if(url.pathname==='/manage/api/password'&&request.method==='POST'){
        const key=`password:${session.id}`,now=Date.now();
        let attempt=this.attempts.get(key);if(!attempt||attempt.until<now){attempt={count:0,until:now+60000};this.attempts.set(key,attempt);}
        if(++attempt.count>10)throw new BridgeError('LOGIN_THROTTLED',429,'尝试过于频繁，请稍后重试。');
        const credential=(await this.store.state()).adminCredential;
        if((credential?.version??0)!==session.credentialVersion)throw new BridgeError('LOGIN_REQUIRED',401,'密码已变更，请重新登录。');
        if(typeof body.currentPassword!=='string'||!(credential?await verifyPassword(body.currentPassword,credential):constantEqual(body.currentPassword,DEFAULT_ADMIN_PASSWORD)))throw new BridgeError('CURRENT_PASSWORD',400,'当前密码错误。');
        validatePassword(body.newPassword);
        if(body.newPassword!==body.confirmPassword)throw new BridgeError('PASSWORD_MISMATCH',400,'两次输入的新密码不一致。');
        if(constantEqual(body.newPassword,body.currentPassword)||constantEqual(body.newPassword,DEFAULT_ADMIN_PASSWORD))throw new BridgeError('PASSWORD_UNCHANGED',400,'新密码不能与当前密码或初始密码相同。');
        await this.store.command({type:'password',sessionId:session.id,expectedVersion:session.credentialVersion,credential:await hashPassword(body.newPassword,session.credentialVersion+1)});
        this.attempts.delete(key);const response=json({ok:true});response.headers.set('Set-Cookie',this.cookie('',0));return this.secure(response);
      }
      if(session.mustChangePassword)throw new BridgeError('PASSWORD_CHANGE_REQUIRED',403,'首次登录必须先设置高强度密码。');
      if(url.pathname==='/manage/api/store-proxy'&&request.method==='GET')return this.secure(json(await this.network.status()));
      if(url.pathname==='/manage/api/store-proxy'&&request.method==='POST')return this.secure(json(await this.network.save(body,session.id)));
      if(this.source){
        if(url.pathname==='/manage/api/source'&&request.method==='GET')return this.secure(json(await this.source.status()));
        if(url.pathname==='/manage/api/source/check'&&request.method==='POST')return this.secure(json(await this.source.check(body,session.id)));
        if(url.pathname==='/manage/api/source/save'&&request.method==='POST')return this.secure(json(await this.source.save(body,session.id)));
      }
      if(url.pathname==='/manage/api/state'&&request.method==='GET'){
        const state=publicThemeState(await this.store.state());
        return this.secure(json({...state,supportsUninstall:this.store.supportsUninstall===true,displayOrigin:this.config.displayOrigin,links:Object.fromEntries(Object.keys(state.installations).map(id=>[id,{display:this.config.routing==='single'&&id===state.active?this.config.displayOrigin:installationUrl(this.config,id),preview:installationUrl(this.config,id,true)}]))}));
      }
      if(url.pathname==='/manage/api/catalog'&&request.method==='GET'){
        const ecosystem=url.searchParams.get('ecosystem');if(ecosystem!=='cfsm'&&ecosystem!=='komari'&&ecosystem!=='native')throw new BridgeError('ECOSYSTEM',400,'请选择原生、CFSM或Komari主题。');
        return this.secure(json(await this.network.run(async fetcher=>this.stars.enrich(await fetchCatalog(ecosystem,fetcher,{latest:true,refresh:url.searchParams.get('refresh')==='1'}),fetcher,url.searchParams.get('refresh')==='1'))));
      }
      if(url.pathname==='/manage/api/prepare-update'&&request.method==='POST'){
        if(typeof body.id!=='string')throw new BridgeError('BAD_REQUEST',400,'请选择已安装版本。');
        const state=await this.store.state(),item=state.installations[body.id];
        if(!item)throw new BridgeError('THEME_NOT_INSTALLED',404,'该版本已不存在，请刷新。');
        if(!item.themeId||item.bundled)throw new BridgeError('UPDATE_SOURCE_UNKNOWN',409,'此历史安装没有可核对的商店标识，请从对应商店选择并安装新版。');
        if(this.installing)throw new BridgeError('INSTALL_BUSY',409,'当前有下载或删除任务，请稍后重试。');
        this.installing=true;
        try{
          const catalog=await this.network.run(fetcher=>fetchCatalog(item.ecosystem,fetcher,{latest:true,refresh:true}));
          const entry=catalog.entries.find(entry=>entry.id===item.themeId);
          if(!entry)throw new BridgeError('UPDATE_NOT_LISTED',404,'官方目录已不再收录此主题，请保留现有版本或查看上游来源。');
          if(!entry.canAttemptInstall)throw new BridgeError('UPDATE_UNAVAILABLE',409,'官方目录中的此主题当前不可安装，请查看商店说明。');
          if(item.ecosystem==='native'&&item.pinnedVersion===catalog.catalogRevision)return this.secure(json({status:'current',message:'已是上游最新原生主题版本。'}));
          const pkg=await this.network.install(item.ecosystem,item.themeId,{expectedCatalogRevision:catalog.catalogRevision});
          if(pkg.digest===item.packageDigest)return this.secure(json({status:'current',message:'当前安装与商店提供的版本及内容一致，无需更新。'}));
          const review:InstallReview={id:token(),expires:Date.now()+15*60_000,ecosystem:item.ecosystem,themeId:item.themeId,catalogRevision:catalog.catalogRevision,pinnedVersion:pkg.pinnedVersion,digest:pkg.digest,noticeVersion:INSTALL_NOTICE_VERSION,updateOf:item.id};
          await this.store.command({type:'review',sessionId:session.id,review});
          return this.secure(json({status:'available',reviewId:review.id,expires:review.expires,name:pkg.name,source:pkg.source,catalogSource:pkg.catalogSource,pinnedVersion:pkg.pinnedVersion,previousVersion:item.pinnedVersion,license:pkg.license,digest:pkg.digest,noticeVersion:INSTALL_NOTICE_VERSION,noticeText:INSTALL_NOTICE_TEXT,resourceNotices:pkg.audit.notices}));
        }finally{this.installing=false;}
      }
      if(url.pathname==='/manage/api/prepare-install'&&request.method==='POST'){
        const ecosystem=body.ecosystem;
        if((ecosystem!=='cfsm'&&ecosystem!=='komari'&&ecosystem!=='native')||typeof body.id!=='string')throw new BridgeError('BAD_REQUEST',400,'主题选择无效。');
        if(typeof body.catalogRevision!=='string'||!/^[a-f0-9]{40}$/.test(body.catalogRevision))throw new BridgeError('CATALOG_REVISION',400,'请刷新商店目录后选择固定版本。');
        if(this.installing)throw new BridgeError('INSTALL_BUSY',409,'当前有下载任务，请稍后重试。');
        this.installing=true;
        try{
          const pkg=await this.network.install(ecosystem,body.id as string,{expectedCatalogRevision:body.catalogRevision as string});
          const review:InstallReview={id:token(),expires:Date.now()+15*60_000,ecosystem,themeId:body.id,catalogRevision:body.catalogRevision,pinnedVersion:pkg.pinnedVersion,digest:pkg.digest,noticeVersion:INSTALL_NOTICE_VERSION};
          await this.store.command({type:'review',sessionId:session.id,review});
          return this.secure(json({reviewId:review.id,expires:review.expires,name:pkg.name,source:pkg.source,catalogSource:pkg.catalogSource,pinnedVersion:pkg.pinnedVersion,license:pkg.license,digest:pkg.digest,noticeVersion:INSTALL_NOTICE_VERSION,noticeText:INSTALL_NOTICE_TEXT,resourceNotices:pkg.audit.notices}));
        }finally{this.installing=false;}
      }
      if(url.pathname==='/manage/api/install'&&request.method==='POST'){
        if(body.acknowledge!==true||body.noticeVersion!==INSTALL_NOTICE_VERSION)throw new BridgeError('INSTALL_CONFIRMATION_REQUIRED',400,'请先查看来源与许可信息，并主动勾选安装确认。');
        const review=session.review;
        if(!review||body.reviewId!==review.id||review.expires<=Date.now())throw new BridgeError('INSTALL_REVIEW_EXPIRED',409,'安装确认已失效，请重新查看来源与许可信息。');
        if(this.installing)throw new BridgeError('INSTALL_BUSY',409,'当前有安装任务，请稍后重试。');
        this.installing=true;
        try{
          const ecosystem=review.ecosystem;
          const pkg=await this.network.install(ecosystem,review.themeId,{expectedCatalogRevision:review.catalogRevision,...(ecosystem==='cfsm'?{expectedBuildRevision:review.pinnedVersion}:{})});
          if(pkg.digest!==review.digest)throw new BridgeError('INSTALL_PACKAGE_CHANGED',409,'主题内容与确认时不一致，请重新查看。');
          const protocolProfile=ecosystem==='native'?'mmwx-native-v1':ecosystem==='cfsm'?'cfsm-609cc0b':'komari-adhesive-v1';
          const id=(await sha256(`${ecosystem}:${protocolProfile}:${pkg.id}`)).slice(0,32);
          const item:Installation={id,title:pkg.name,ecosystem,source:pkg.source,pinnedVersion:pkg.pinnedVersion,catalogRevision:review.catalogRevision,themeId:pkg.themeId,manifest:pkg.manifest,configuration:pkg.configuration,resourceNotices:pkg.audit.notices,remoteFiles:pkg.remoteFiles,dependencySources:pkg.dependencySources,protocolProfile,license:pkg.license,packageDigest:pkg.digest,entry:pkg.entry,installedAt:new Date().toISOString(),compatibility:'unverified',files:Object.fromEntries(pkg.files.map(f=>[f.path,{contentType:f.contentType,size:f.bytes.byteLength}])),bundled:false};
          await commitInstallation(this.store,item,pkg.files,false,{sessionId:session.id,id:review.id});return this.secure(json({ok:true,id}));
        }finally{this.installing=false;}
      }
      if(url.pathname==='/manage/api/native-theme'&&request.method==='POST'){
        if(typeof body.id!=='string'||!Number.isSafeInteger(body.generation)||!isNativeTheme(body.theme))throw new BridgeError('BAD_REQUEST',400,'原生外观或版本信息无效。');
        const state=await this.store.command({type:'native-theme',id:body.id,theme:body.theme as NativeTheme,expectedGeneration:body.generation as number,sessionId:session.id});
        return this.secure(json(publicThemeState(state)));
      }
      if(url.pathname==='/manage/api/uninstall'&&request.method==='POST'){
        if(typeof body.id!=='string'||!Number.isSafeInteger(body.generation)||body.confirmed!==true)throw new BridgeError('BAD_REQUEST',400,'请确认要删除的主题版本。');
        if(!this.store.supportsUninstall)throw new BridgeError('UNINSTALL_UNSUPPORTED',409,'当前运行环境尚不支持删除主题资源，请使用Node运行包或Docker。');
        if(this.installing)throw new BridgeError('INSTALL_BUSY',409,'当前有下载或删除任务，请稍后重试。');
        this.installing=true;
        try{
          const state=await this.store.command({type:'uninstall',id:body.id,expectedGeneration:body.generation as number,sessionId:session.id,acknowledgePrevious:body.acknowledgePrevious===true});
          return this.secure(json({ok:true,cleanupPending:state.pendingAssetCleanup?.includes(body.id)===true}));
        }finally{this.installing=false;}
      }
      if(url.pathname==='/manage/api/activate'&&request.method==='POST'){
        if(typeof body.id!=='string'||!Number.isSafeInteger(body.generation))throw new BridgeError('BAD_REQUEST',400,'版本信息无效。');
        const state=await this.store.command({type:'activate',id:body.id,expectedGeneration:body.generation as number,acknowledgeUnverified:body.acknowledgeUnverified===true});return this.secure(json(publicThemeState(state)));
      }
      if(url.pathname==='/manage/api/rollback'&&request.method==='POST'){
        if(!Number.isSafeInteger(body.generation))throw new BridgeError('BAD_REQUEST',400,'版本信息无效。');
        return this.secure(json(publicThemeState(await this.store.command({type:'rollback',expectedGeneration:body.generation as number}))));
      }
      throw new BridgeError('NOT_FOUND',404,'管理接口不存在。');
    }catch(error){
      return this.secure(error instanceof ThemePackageError?json({code:error.code,message:error.message,error:error.message},error.status):errorResponse(error));
    }
  }
  private secure(response:Response){
    response.headers.set('Cache-Control','no-store');response.headers.set('X-Content-Type-Options','nosniff');response.headers.set('Referrer-Policy','no-referrer');response.headers.set('X-Frame-Options','DENY');
    response.headers.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    response.headers.set('Cross-Origin-Resource-Policy','same-origin');return response;
  }
}
