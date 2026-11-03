/** Node-only development transport. Never imported by the production Worker. */
import { Agent, ProxyAgent } from 'undici';
import { HttpsProxyAgent } from 'https-proxy-agent';
export function createDevTransport(value:string|undefined,timeoutMs:number) {
  if(!value)return {http:new Agent({connect:{timeout:Math.min(10000,timeoutMs)}}),webSocket:undefined,proxied:false};
  let url:URL;
  try{url=new URL(value);}catch{throw new Error('Invalid local development proxy');}
  if(!['http:','https:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Development proxy must be a loopback HTTP(S) CONNECT origin');
  return {http:new ProxyAgent({uri:url.origin,connect:{timeout:Math.min(10000,timeoutMs)}}),webSocket:new HttpsProxyAgent(url),proxied:true};
}
