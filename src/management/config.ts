import { BridgeError } from '../core/errors.ts';
import type { Env } from '../core/config.ts';
export interface ManagementConfig {adminOrigin:string;displayOrigin:string;displayDomain:string;previewOrigin:string;username:string;password:string;}
export function managementConfig(env:Env):ManagementConfig {
  const config={adminOrigin:env.BRIDGE_ADMIN_ORIGIN||'http://admin.localhost:8786',displayOrigin:env.BRIDGE_DISPLAY_ORIGIN||`http://127.0.0.1:${env.PORT||8787}`,displayDomain:env.BRIDGE_DISPLAY_DOMAIN||'display.localhost',previewOrigin:env.BRIDGE_PREVIEW_ORIGIN||'http://preview.localhost:8789',username:env.BRIDGE_ADMIN_USERNAME||'admin',password:env.BRIDGE_ADMIN_PASSWORD||''};
  const local=(host:string)=>host==='localhost'||host.endsWith('.localhost')||host==='127.0.0.1';
  for(const key of ['adminOrigin','displayOrigin','previewOrigin'] as const){
    const url=new URL(config[key]);if(url.origin!==config[key]||url.username||url.password||(!local(url.hostname)&&url.protocol!=='https:'))throw new BridgeError('MANAGEMENT_CONFIGURATION',503,'管理和展示源必须是独立HTTPS源，本机可使用HTTP。');
  }
  const admin=new URL(config.adminOrigin),display=new URL(config.displayOrigin),preview=new URL(config.previewOrigin);
  if(admin.hostname===display.hostname||admin.hostname===preview.hostname||admin.hostname===config.displayDomain||admin.hostname.endsWith(`.${config.displayDomain}`)||admin.hostname.endsWith(`.${preview.hostname}`)||preview.hostname===config.displayDomain||!/^[a-z0-9.-]+$/.test(config.displayDomain))throw new BridgeError('ORIGIN_ISOLATION',503,'后台、展示与预览必须使用不同主机名，不能仅分端口或路径。');
  if(config.password&&config.password.length<20)throw new BridgeError('ADMIN_PASSWORD',503,'独立管理密码至少20字符。');
  return config;
}
export function installationUrl(config:ManagementConfig,id:string,preview=false){
  const url=new URL(preview?config.previewOrigin:config.displayOrigin);
  url.hostname=`${preview?'p':'t'}-${id}.${preview?url.hostname:config.displayDomain}`;return url.origin;
}
export function installationFromUrl(config:ManagementConfig,url:URL):{id:string;preview:boolean}|null{
  for(const preview of [false,true]){
    const base=new URL(preview?config.previewOrigin:config.displayOrigin),domain=preview?base.hostname:config.displayDomain;
    if(url.protocol!==base.protocol||url.port!==base.port)continue;
    const match=url.hostname.match(new RegExp(`^${preview?'p':'t'}-([a-f0-9]{32})\\.${domain.replaceAll('.','\\.')}$`));
    if(match)return {id:match[1],preview};
  }
  return null;
}
