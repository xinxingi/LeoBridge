import { BridgeError } from '../core/errors.ts';

export type ThemeEcosystem='cfsm'|'komari';
export type Compatibility='unverified'|'verified'|'incompatible';
export interface Installation {
  id:string; title:string; ecosystem:ThemeEcosystem; source:string; pinnedVersion:string;
  protocolProfile:string; license:{spdx:string;text:string;source:string;sha256:string};
  entry:string; installedAt:string; compatibility:Compatibility; evidence?:string;
  catalogRevision?:string;
  files:Record<string,{contentType:string;size:number;offset?:number}>; bundled:boolean;
}
export interface AdminSession {expires:number;csrf:string;}
export interface ThemeState {
  schema:1; generation:number; active:string|null; previous:string|null;
  installations:Record<string,Installation>; sessions:Record<string,AdminSession>;
  events:{at:string;action:string;installationId:string;generation:number}[];
}
export type ThemeCommand=
  |{type:'install';installation:Installation;activateIfEmpty?:boolean}
  |{type:'activate';id:string;expectedGeneration:number;acknowledgeUnverified?:boolean}
  |{type:'rollback';expectedGeneration:number}
  |{type:'bundled-evidence';id:string;compatibility:Compatibility;evidence:string}
  |{type:'session';id:string;session:AdminSession}
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
  if(command.type==='session'){
    if(Object.keys(next.sessions).length>=100)throw new BridgeError('SESSION_LIMIT',429,'管理会话数量已达上限。');
    next.sessions[command.id]=command.session;return next;
  }
  if(command.type==='logout'){delete next.sessions[command.id];return next;}
  if(command.type==='bundled-evidence'){
    const item=next.installations[command.id];if(!item?.bundled)throw new BridgeError('EVIDENCE_SCOPE',409,'只能更新当前内置包的验收记录。');
    item.compatibility=command.compatibility;item.evidence=command.evidence;return next;
  }
  if(command.type==='install'){
    const item=command.installation;
    if(!validInstallationId(item.id)||!validAssetPath(item.entry)||!item.files[item.entry])throw new BridgeError('INVALID_PACKAGE',400,'主题包入口无效。');
    if(next.installations[item.id])return next;
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
export function publicThemeState(state:ThemeState){const {sessions,...publicState}=state;return publicState;}

/** Complete immutable files before publishing metadata; failures leave active untouched. */
export async function commitInstallation(store:ThemeStore,item:Installation,files:{path:string;bytes:Uint8Array;contentType:string}[],activateIfEmpty=false){
  const paths=files.map(file=>file.path),declared=Object.keys(item.files);
  if(!validInstallationId(item.id)||!validAssetPath(item.entry)||!declared.includes(item.entry)||new Set(paths).size!==paths.length||paths.length!==declared.length||files.some(file=>!validAssetPath(file.path)||!Object.hasOwn(item.files,file.path)||item.files[file.path].size!==file.bytes.length||item.files[file.path].contentType!==file.contentType)||declared.some(path=>!paths.includes(path)))throw new BridgeError('INVALID_PACKAGE',400,'主题资源清单不完整或与内容不符。');
  if((await store.state()).installations[item.id])return;
  let offset=0;
  for(const file of files){
    if(!validAssetPath(file.path))throw new BridgeError('INVALID_PATH',400,'主题资源路径无效。');
    item.files[file.path]={...item.files[file.path],offset};offset+=file.bytes.length;
  }
  if(store.putAssets)await store.putAssets(item.id,files);
  else for(const file of files)await store.putAsset(item.id,file.path,file.bytes,file.contentType);
  await store.command({type:'install',installation:item,activateIfEmpty});
}

export async function sha256(value:string|Uint8Array){
  const bytes=typeof value==='string'?new TextEncoder().encode(value):value;
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
