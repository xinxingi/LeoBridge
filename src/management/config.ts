import { BridgeError } from '../core/errors.ts';
import type { Env } from '../core/config.ts';
export interface ManagementConfig {routing?:'single'|'isolated';adminOrigin:string;displayOrigin:string;displayDomain:string;previewOrigin:string;username:string;}
export function managementConfig(env:Env):ManagementConfig {
  // Existing explicit multi-origin configurations remain valid; new installations use one origin.
  const routing = env.BRIDGE_ROUTING || (env.BRIDGE_ADMIN_ORIGIN || env.BRIDGE_PREVIEW_ORIGIN || env.BRIDGE_DISPLAY_DOMAIN ? 'isolated' : 'single');
  if (routing !== 'single' && routing !== 'isolated') throw new BridgeError('MANAGEMENT_CONFIGURATION',503,'无效路由模式。');
  const displayOrigin = env.BRIDGE_ORIGIN || env.BRIDGE_DISPLAY_ORIGIN || `http://127.0.0.1:${env.BRIDGE_LISTEN_PORT || env.PORT || 8787}`;
  const config: ManagementConfig = {routing,adminOrigin:routing === 'single' ? displayOrigin : env.BRIDGE_ADMIN_ORIGIN || 'http://admin.localhost:8786',displayOrigin,displayDomain:env.BRIDGE_DISPLAY_DOMAIN || 'display.localhost',previewOrigin:env.BRIDGE_PREVIEW_ORIGIN || (routing === 'single' ? displayOrigin : 'http://preview.localhost:8789'),username:env.BRIDGE_ADMIN_USERNAME || 'admin'};
  const local=(host:string)=>host==='localhost'||host.endsWith('.localhost')||host==='127.0.0.1';
  for(const key of ['adminOrigin','displayOrigin','previewOrigin'] as const){
    const url=new URL(config[key]);if(url.origin!==config[key]||url.username||url.password||(!local(url.hostname)&&url.protocol!=='https:'&&!(routing==='single'&&env.BRIDGE_NODE_MODE==='direct'&&url.protocol==='http:')))throw new BridgeError('MANAGEMENT_CONFIGURATION',503,'管理和展示源必须是独立HTTPS源，本机可使用HTTP。');
  }
  const admin=new URL(config.adminOrigin),display=new URL(config.displayOrigin),preview=new URL(config.previewOrigin);
  if((routing!=='single'&&admin.hostname===display.hostname)||(admin.hostname===preview.hostname&&!(routing==='single'&&preview.origin===display.origin))||admin.hostname===config.displayDomain||admin.hostname.endsWith(`.${config.displayDomain}`)||admin.hostname.endsWith(`.${preview.hostname}`)||preview.hostname===config.displayDomain||!/^[a-z0-9.-]+$/.test(config.displayDomain))throw new BridgeError('ORIGIN_ISOLATION',503,'后台、展示与预览必须使用不同主机名，不能仅分端口或路径。');
  return config;
}
export const PREVIEW_PARAMETER='__preview';
export function installationUrl(config:ManagementConfig,id:string,preview=false){
  if(config.routing==='single')return `${config.displayOrigin}/?${PREVIEW_PARAMETER}=${id}`;
  const url=new URL(preview?config.previewOrigin:config.displayOrigin);
  url.hostname=`${preview?'p':'t'}-${id}.${preview?url.hostname:config.displayDomain}`;return url.origin;
}
export function installationFromUrl(config:ManagementConfig,url:URL):{id:string;preview:boolean}|null{
  if(config.routing==='single'&&url.origin===config.displayOrigin&&url.searchParams.has(PREVIEW_PARAMETER)){
    const ids=url.searchParams.getAll(PREVIEW_PARAMETER);
    if(ids.length!==1||! /^[a-f0-9]{32}$/.test(ids[0]!))throw new BridgeError('INVALID_PREVIEW',400,'预览版本标识无效。');
    return {id:ids[0]!,preview:true};
  }
  for(const preview of [false,true]){
    const base=new URL(preview?config.previewOrigin:config.displayOrigin),domain=preview?base.hostname:config.displayDomain;
    if(url.protocol!==base.protocol||url.port!==base.port)continue;
    const match=url.hostname.match(new RegExp(`^${preview?'p':'t'}-([a-f0-9]{32})\\.${domain.replaceAll('.','\\.')}$`));
    if(match)return {id:match[1],preview};
  }
  return null;
}
