import { readConfig,type Env } from '../core/config.ts';
import { managementConfig } from '../management/config.ts';
import { errorResponse } from '../core/http.ts';
import type { Socket } from '../core/socket.ts';
import { BridgeError } from '../core/errors.ts';
import { WorkerThemeStore,type CoordinatorBinding,type R2Binding } from './worker-theme-store.ts';
import { Site } from '../app/site.ts';
import { seedBundled } from '../themes/bundled.ts';
export { ThemeCoordinator } from './worker-theme-store.ts';
interface WorkerSocket {accept():void;send(s:string):void;close(c?:number,r?:string):void;addEventListener(type:string,fn:(event:{data:unknown})=>void):void;}
declare const WebSocketPair:{new():{0:WorkerSocket;1:WorkerSocket}};
interface Bindings {ASSETS:{fetch(request:Request):Promise<Response>};THEME_ASSETS:R2Binding;THEME_COORDINATOR:CoordinatorBinding;[key:string]:unknown;}
let cached:{key:string;site:Site;ready:Promise<void>}|undefined;
function adapt(ws:WorkerSocket):Socket{return {send:d=>ws.send(d),close:(c,r)=>ws.close(c,r),onMessage:f=>ws.addEventListener('message',e=>f(typeof e.data==='string'?e.data:'')),onClose:f=>ws.addEventListener('close',f),onError:f=>ws.addEventListener('error',f)};}
export default {
  async fetch(request:Request,env:Bindings):Promise<Response>{
    try{
      if(!env.THEME_ASSETS||!env.THEME_COORDINATOR)throw new BridgeError('STORAGE_CONFIGURATION',503,'请配置主题R2与元数据Durable Object绑定。');
      const values=Object.fromEntries(Object.entries(env).filter(([,v])=>typeof v==='string')) as Env;
      const key=JSON.stringify(values);
      if(!cached||cached.key!==key){
        const store=new WorkerThemeStore(env.THEME_ASSETS,env.THEME_COORDINATOR),config=readConfig(values);
        const site=new Site(config,managementConfig(values),store,async path=>env.ASSETS.fetch(new Request(`https://assets/_management/${path}`)));
        const ready=seedBundled(store,async path=>{const response=await env.ASSETS.fetch(new Request(`https://assets/${path}`));if(!response.ok)throw new Error('Missing bundled assets');return new Uint8Array(await response.arrayBuffer());});
        cached={key,site,ready};ready.catch(()=>{cached=undefined;});
      }
      const current=cached;await current.ready;
      const site=current.site;
      if(request.headers.get('upgrade')?.toLowerCase()==='websocket'){
        const protocol=await site.websocket(request);if(!protocol)return new Response('Forbidden',{status:403});
        const pair=new WebSocketPair();pair[1].accept();
        protocol.openRealtime(adapt(pair[1]),async()=>{
          const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),site.config.timeoutMs);
          try{
            const response=await fetch(new URL('/api/public/probe-ws',site.config.baseUrl),{headers:{Upgrade:'websocket','X-MMwx-Probe-Token':site.config.token},redirect:'manual',signal:controller.signal});
            const ws=(response as Response&{webSocket?:WorkerSocket}).webSocket;if(response.status!==101||!ws)throw new BridgeError('UPSTREAM_WS',502,'上游实时连接失败。');ws.accept();return adapt(ws);
          }finally{clearTimeout(timer);}
        },new URL(request.url).pathname);
        return new Response(null,{status:101,webSocket:pair[0]} as ResponseInit);
      }
      return site.fetch(request);
    }catch(error){return errorResponse(error);}
  }
};
