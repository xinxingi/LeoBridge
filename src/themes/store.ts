import { parseStoreProxy,type SavedStoreProxy,type StoreProxySettings } from '../core/store-proxy.ts';
import { BridgeError } from '../core/errors.ts';
import type { LicenseRecord } from './package.ts';
import type { SavedSource, SourceReview, SourceSettings } from '../core/source.ts';
export const INSTALL_NOTICE_VERSION='2026-11-03.1';
export const INSTALL_NOTICE_TEXT='我已查看上游来源及可用的许可说明，了解 LeoBridge 不提供授权判断，并决定安装此主题。';
export interface InstallReview {id:string;expires:number;ecosystem:ThemeEcosystem;themeId:string;catalogRevision:string;pinnedVersion:string;digest:string;noticeVersion:string;}
export interface InstallConfirmation {at:string;noticeVersion:string;noticeText:string;source:string;pinnedVersion:string;digest:string;licenseStatus:'found'|'missing';}


export type ThemeEcosystem='cfsm'|'komari';
export type Compatibility='unverified'|'verified'|'incompatible';
export interface Installation {
  id:string; title:string; ecosystem:ThemeEcosystem; source:string; pinnedVersion:string;
  protocolProfile:string; license:LicenseRecord;
  packageDigest?:string; confirmation?:InstallConfirmation;
  entry:string; installedAt:string; compatibility:Compatibility; evidence?:string;
  catalogRevision?:string;
  files:Record<string,{contentType:string;size:number;offset?:number}>; bundled:boolean;
}
export interface AdminSession {expires:number;csrf:string;credentialVersion?:number;review?:InstallReview;sourceReview?:SourceReview;}
export interface AdminCredential {version:number;algorithm:'PBKDF2-SHA256';salt:string;iterations:number;hash:string;}
export interface ThemeState {
  schema:1; generation:number; active:string|null; previous:string|null;
  installations:Record<string,Installation>; sessions:Record<string,AdminSession>;
  adminCredential?:AdminCredential;
  source?:SavedSource;
  storeProxy?:SavedStoreProxy;
  events:{at:string;action:string;installationId:string;generation:number}[];
}
export type ThemeCommand=
  |{type:'store-proxy';sessionId:string;expectedVersion:number;settings:StoreProxySettings}
  |{type:'source-review';sessionId:string;review:SourceReview}
  |{type:'source';sessionId:string;reviewId:string;expectedVersion:number;settings:SourceSettings}
  |{type:'install';installation:Installation;activateIfEmpty?:boolean;review?:{sessionId:string;id:string}}
  |{type:'review';sessionId:string;review:InstallReview}
  |{type:'activate';id:string;expectedGeneration:number;acknowledgeUnverified?:boolean}
  |{type:'rollback';expectedGeneration:number}
  |{type:'bundled-evidence';id:string;compatibility:Compatibility;evidence:string}
  |{type:'session';id:string;session:AdminSession}
  |{type:'password';sessionId:string;expectedVersion:number;credential:AdminCredential}
  |{type:'logout';id:string};
export interface ThemeStore {
  state():Promise<ThemeState>;
  command(command:ThemeCommand):Promise<ThemeState>;
  putAsset(id:string,path:string,bytes:Uint8Array,contentType:string):Promise<void>;
  putAssets?(id:string,files:{path:string;bytes:Uint8Array;contentType:string}[]):Promise<void>;
  asset(id:string,path:string):Promise<{bytes:Uint8Array;contentType:string}|null>;
}
export const emptyThemeState=():ThemeState=>({schema:1,generation:0,active:null,previous:null,installations:{},sessions:{},events:[]});
export function validInstallationId(id:string){return /^[a-f0-9]{32}$/.test(id);}
export function validAssetPath(path:string){return !!path&&!path.startsWith('/')&&!path.includes('\\')&&!/[\u0000-\u001f?#]/.test(path)&&path.split('/').every(part=>part!=='.'&&part!=='..'&&part!=='');}
export function applyThemeCommand(state:ThemeState,command:ThemeCommand,now=Date.now()):ThemeState {
  const next=structuredClone(state);
  for(const [id,session]of Object.entries(next.sessions))if(session.expires<=now)delete next.sessions[id];
  if(command.type==='store-proxy'){
    const session=next.sessions[command.sessionId];
    if(!session||!next.adminCredential||(session.credentialVersion??0)!==next.adminCredential.version)throw new BridgeError('LOGIN_REQUIRED',401,'请重新登录。');
    const version=next.storeProxy?.version??0;
    if(command.expectedVersion!==version)throw new BridgeError('STORE_PROXY_CONFLICT',409,'商店代理设置已变更，请重新载入后再保存。');
    next.storeProxy={...parseStoreProxy(command.settings.enabled,command.settings.url),version:version+1};return next;
  }
  if(command.type==='source-review'||command.type==='source'){
    const session=next.sessions[command.sessionId];
    if(!session||!next.adminCredential||(session.credentialVersion??0)!==next.adminCredential.version)throw new BridgeError('LOGIN_REQUIRED',401,'请重新登录。');
    const version=next.source?.version??0;
    if(command.type==='source-review'){
      if(command.review.expectedVersion!==version)throw new BridgeError('SOURCE_CONFLICT',409,'数据源已变更，请重新检查连接。');
      session.sourceReview=command.review;return next;
    }
    const review=session.sourceReview;
    if(!review||review.id!==command.reviewId||review.expires<=now||review.expectedVersion!==version||command.expectedVersion!==version)throw new BridgeError('SOURCE_CONFLICT',409,'数据源或连接检查已变更，请重新检查连接。');
    next.source={...command.settings,version:version+1};
    for(const current of Object.values(next.sessions))delete current.sourceReview;
    return next;
  }
  if(command.type==='session'){
    if((command.session.credentialVersion??0)!==(next.adminCredential?.version??0))throw new BridgeError('LOGIN_REQUIRED',401,'密码已变更，请重新登录。');
    if(Object.keys(next.sessions).length>=100)throw new BridgeError('SESSION_LIMIT',429,'管理会话数量已达上限。');
    next.sessions[command.id]=command.session;return next;
  }
  if(command.type==='review'){
    const session=next.sessions[command.sessionId];
    if(!session)throw new BridgeError('LOGIN_REQUIRED',401,'请重新登录。');
    session.review=command.review;return next;
  }
  if(command.type==='logout'){delete next.sessions[command.id];return next;}
  if(command.type==='password'){
    const session=next.sessions[command.sessionId],version=next.adminCredential?.version??0;
    if(!session||(session.credentialVersion??0)!==version||command.expectedVersion!==version||command.credential.version!==version+1)throw new BridgeError('LOGIN_REQUIRED',401,'会话或密码已变更，请重新登录。');
    next.adminCredential=command.credential;next.sessions={};return next;
  }
  if(command.type==='bundled-evidence'){
    const item=next.installations[command.id];if(!item?.bundled)throw new BridgeError('EVIDENCE_SCOPE',409,'只能更新当前内置包的验收记录。');
    item.compatibility=command.compatibility;item.evidence=command.evidence;return next;
  }
  if(command.type==='install'){
    const item=structuredClone(command.installation);
    if(command.review){
      const session=next.sessions[command.review.sessionId],review=session?.review;
      if(!review||review.id!==command.review.id||review.expires<=now||review.noticeVersion!==INSTALL_NOTICE_VERSION||review.digest!==item.packageDigest||review.pinnedVersion!==item.pinnedVersion||review.catalogRevision!==item.catalogRevision||review.ecosystem!==item.ecosystem)throw new BridgeError('INSTALL_REVIEW_EXPIRED',409,'安装确认已失效，请重新查看来源与许可信息。');
      item.confirmation={at:new Date(now).toISOString(),noticeVersion:INSTALL_NOTICE_VERSION,noticeText:INSTALL_NOTICE_TEXT,source:item.source,pinnedVersion:item.pinnedVersion,digest:review.digest,licenseStatus:item.license.status??(item.license.text?'found':'missing')};
      delete session.review;
    }
    if(!validInstallationId(item.id)||!validAssetPath(item.entry)||!item.files[item.entry])throw new BridgeError('INVALID_PACKAGE',400,'主题包入口无效。');
    if(next.installations[item.id]){if(item.confirmation)next.installations[item.id]!.confirmation=item.confirmation;return next;}
    next.installations[item.id]=item;
    if(command.activateIfEmpty&&!next.active){next.active=item.id;}
  }else{
    if(command.expectedGeneration!==next.generation)throw new BridgeError('REVISION_CONFLICT',409,'状态已变更，请刷新后重试。');
    const id=command.type==='rollback'?next.previous:command.id;
    const item=id?next.installations[id]:null;
    if(!item)throw new BridgeError('THEME_NOT_INSTALLED',404,'该版本尚未安装或没有可回退版本。');
    if(item.compatibility==='incompatible')throw new BridgeError('THEME_INCOMPATIBLE',409,'该版本不支持当前桥接协议。');
    if(command.type==='activate'&&item.compatibility!=='verified'&&!command.acknowledgeUnverified)throw new BridgeError('PREVIEW_REQUIRED',409,'该包未经实测兼容，请先预览并明确确认。');
    if(id===next.active)return next;
    next.previous=next.active;next.active=id;
  }
  next.generation++;
  next.events.push({at:new Date(now).toISOString(),action:command.type,installationId:command.type==='install'?command.installation.id:next.active!,generation:next.generation});
  next.events=next.events.slice(-30);return next;
}
export function publicThemeState(state:ThemeState){const {sessions,adminCredential,source,storeProxy,...publicState}=state;return publicState;}

/** Complete immutable files before publishing metadata; failures leave active untouched. */
export async function commitInstallation(store:ThemeStore,item:Installation,files:{path:string;bytes:Uint8Array;contentType:string}[],activateIfEmpty=false,review?:{sessionId:string;id:string}){
  const paths=files.map(file=>file.path),declared=Object.keys(item.files);
  if(!validInstallationId(item.id)||!validAssetPath(item.entry)||!declared.includes(item.entry)||new Set(paths).size!==paths.length||paths.length!==declared.length||files.some(file=>!validAssetPath(file.path)||!Object.hasOwn(item.files,file.path)||item.files[file.path].size!==file.bytes.length||item.files[file.path].contentType!==file.contentType)||declared.some(path=>!paths.includes(path)))throw new BridgeError('INVALID_PACKAGE',400,'主题资源清单不完整或与内容不符。');
  if((await store.state()).installations[item.id]){if(review)await store.command({type:'install',installation:item,review});return;}
  let offset=0;
  for(const file of files){
    if(!validAssetPath(file.path))throw new BridgeError('INVALID_PATH',400,'主题资源路径无效。');
    item.files[file.path]={...item.files[file.path],offset};offset+=file.bytes.length;
  }
  if(store.putAssets)await store.putAssets(item.id,files);
  else for(const file of files)await store.putAsset(item.id,file.path,file.bytes,file.contentType);
  await store.command({type:'install',installation:item,activateIfEmpty,review});
}

export async function sha256(value:string|Uint8Array){
  const bytes=typeof value==='string'?new TextEncoder().encode(value):value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
