import { PING_SLOTS, type Config } from './config.ts';
import { BridgeError } from './errors.ts';
import { parseBindings, type Binding } from './identity.ts';

/** Private server-side settings. Never include these in theme/public state. */
export interface SourceSettings {
  baseUrl:string; token:string; bindings:Binding[]; pingTargets:Config['pingTargets'];
}
export interface SavedSource extends SourceSettings {version:number;}
export interface SourceReview {
  id:string; expires:number; expectedVersion:number; settings:SourceSettings;
  candidates:{match:Binding['match']; newId:string; suggestedId:string}[];
  previous:Binding[]; targets:{key:string;label:string}[];
}
export function sourceConfig(base:Config,source:SourceSettings):Config {
  let url:URL;
  try { url=new URL(source.baseUrl); } catch { throw new BridgeError('CONFIGURATION',503,'未配置有效的上游地址。'); }
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new BridgeError('CONFIGURATION',503,'上游地址必须为不含凭据、路径和查询参数的 HTTP(S) 源。');
  if(typeof source.token!=='string'||source.token.length>4096||/[\u0000-\u001f\u007f]/.test(source.token))throw new BridgeError('CONFIGURATION',503,'数据源Token无效。');
  const pingTargets=source.pingTargets;
  if(!pingTargets||Array.isArray(pingTargets)||typeof pingTargets!=='object')throw new BridgeError('CONFIGURATION',503,'Ping目标配置无效。');
  const keys=new Set<string>();
  for(const [slot,target]of Object.entries(pingTargets)){
    if(!(PING_SLOTS as readonly string[]).includes(slot)||!target||typeof target.key!=='string'||!target.key||typeof target.label!=='string'||!target.label||keys.has(target.key))throw new BridgeError('CONFIGURATION',503,'Ping目标配置无效。');
    keys.add(target.key);
  }
  return {...base,baseUrl:url.origin,token:source.token,bindings:parseBindings(JSON.stringify(source.bindings)),pingTargets};
}
