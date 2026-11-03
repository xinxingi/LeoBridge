import { BridgeError } from './errors.ts';
export interface StoreProxySettings { enabled:boolean; url:string; }
export interface SavedStoreProxy extends StoreProxySettings { version:number; }
export function parseStoreProxy(enabled:unknown,value:unknown):StoreProxySettings {
  const invalid=()=>new BridgeError('STORE_PROXY_INPUT',400,'请填写有效的 HTTP/HTTPS 代理地址，不支持路径、查询参数或 SOCKS 地址。');
  if(typeof enabled!=='boolean'||typeof value!=='string'||value.length>4096||/[\u0000-\u001f\u007f]/.test(value))throw invalid();
  if(!value.trim()){if(enabled)throw invalid();return {enabled:false,url:''};}
  let url:URL;try{url=new URL(value.trim());}catch{throw invalid();}
  if(!['http:','https:'].includes(url.protocol)||!url.hostname||url.pathname!=='/'||url.search||url.hash)throw invalid();
  // Validate percent encoding before the runtime constructs proxy authentication.
  try{decodeURIComponent(url.username);decodeURIComponent(url.password);}catch{throw invalid();}
  return {enabled,url:url.href};
}
export function publicProxyUrl(value:string){if(!value)return '';const url=new URL(value);url.username='';url.password='';return url.origin;}
