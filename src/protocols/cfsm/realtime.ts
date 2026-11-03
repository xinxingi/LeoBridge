import type { Bridge } from './service.ts';
import { safeError } from '../../core/errors.ts';
import type { Snapshot } from '../../core/model.ts';
import type { Socket,Connect } from '../../core/socket.ts';
export type { Socket,Connect } from '../../core/socket.ts';
/** One bounded upstream connection per active viewer. No retained history or idle sockets. */
export function realtime(bridge:Bridge, client:Socket, connect:Connect) {
  let stopped=false, subscribed=false, upstream:Socket|undefined, generation=0, retry=1000;
  let ids=new Set<string>(), all=false, lastSeen=0, connecting=false;
  let lastFrame=Date.now(), lastPublished=0, polling=false;
  let reconnectTimer:ReturnType<typeof setTimeout>|undefined;
  const send=(value:unknown)=>{if(!stopped){try{client.send(JSON.stringify(value));}catch{stop();}}};
  const status=(value:'ok'|'unavailable'|'stale',code?:string,transport?:string)=>send({type:'bridgeStatus',status:value,code,transport});
  const subscriptionTimer=setTimeout(()=>stop(1008,'subscription required'),10000);
  const lifetime=setTimeout(()=>stop(1012,'connection renewal'),10*60*1000);
  const watchdog=setInterval(()=>{
    if(!subscribed)return;
    if(lastSeen && Date.now()-lastSeen>bridge.config.staleMs){status('stale');lose();}
    // The source frontend also falls back to HTTP. Shared snapshot coalescing
    // limits concurrent viewers to one read per isolate while the socket stalls.
    if(Date.now()-lastFrame>=15000)void poll();
  },5000);
  function stop(code=1000,reason='closed') {
    if(stopped)return;stopped=true;generation++;
    clearTimeout(subscriptionTimer);clearTimeout(lifetime);clearInterval(watchdog);clearTimeout(reconnectTimer);
    upstream?.close(1000,'viewer closed');upstream=undefined;
    try{client.close(code,reason);}catch{/* already closed */}
  }
  function lose(code?:string) {
    if(stopped)return;
    generation++;connecting=false;lastSeen=0;
    const old=upstream;upstream=undefined;old?.close(1000,'reconnect');
    // This viewer's transport failure does not supersede observations or
    // pending HTTP reads shared with other viewers and protocol adapters.
    status('unavailable',code);
    if(!reconnectTimer){reconnectTimer=setTimeout(()=>{reconnectTimer=undefined;void start();},retry);retry=Math.min(retry*2,30000);}
  }
  function publishSnapshot(snapshot:Snapshot,transport:'websocket'|'poll') {
    const servers=bridge.servers(snapshot);
    const available=new Set(servers.map(s=>String(s.id)));
    if([...ids].some(id=>!available.has(id)))throw new Error('subscription no longer available');
    if(snapshot.observedAt<=lastPublished)return;
    lastPublished=snapshot.observedAt;
    status('ok',undefined,transport);
    send({type:'batchUpdate',transport,ts:snapshot.observedAt,updates:servers.filter(s=>all||ids.has(String(s.id))).map(s=>({serverId:s.id,samples:[{ts:snapshot.observedAt,data:s}]}))});
  }
  async function poll() {
    if(stopped||polling)return;polling=true;
    const previousFrame=lastFrame;
    try {
      const snapshot=await bridge.upstream.snapshot();
      if(!stopped&&lastFrame===previousFrame)publishSnapshot(snapshot,'poll');
    }catch(error){if(!stopped&&lastFrame===previousFrame)status('unavailable',safeError(error).code);}
    finally{polling=false;}
  }
  async function start() {
    if(stopped||connecting)return;connecting=true;const version=++generation;
    try {
      const source=await connect();
      if(stopped||generation!==version){source.close(1000,'cancelled');return;}
      upstream=source;connecting=false;lastSeen=Date.now();
      source.onMessage(data=>{
        if(stopped||generation!==version)return;
        try{
          const snapshot=bridge.upstream.accept(JSON.parse(data));
          publishSnapshot(snapshot,'websocket');lastSeen=Date.now();lastFrame=lastSeen;retry=1000;
        }catch(error){bridge.upstream.invalidate();lose(safeError(error).code);}
      });
      source.onClose(()=>{if(generation===version)lose();});
      source.onError(()=>{if(generation===version)lose();});
    } catch(error){if(!stopped&&generation===version){lose(safeError(error).code);}}
  }
  client.onMessage(data=>{
    if(data.length>8192){stop(1009,'message too large');return;}
    let message:Record<string,unknown>;
    try{message=JSON.parse(data);}catch{stop(1008,'invalid message');return;}
    if(!message || typeof message!=='object' || Array.isArray(message)){stop(1008,'invalid message');return;}
    if(message.type==='ping'){send({type:'pong',ts:Date.now()});return;}
    if(message.type!=='subscribe'||subscribed||!Array.isArray(message.ids)||message.ids.length>500||message.ids.some(id=>typeof id!=='string')){stop(1008,'invalid subscription');return;}
    const scope=String(message.scope||'');
    if(scope!=='all'&&!bridge.config.bindings.some(b=>b.id===scope)){stop(1008,'unknown scope');return;}
    ids=new Set(message.ids as string[]);all=scope==='all'&&ids.size===0;
    if(scope!=='all')ids=new Set([scope]);
    if([...ids].some(id=>!bridge.config.bindings.some(b=>b.id===id))){stop(1008,'unknown server');return;}
    subscribed=true;clearTimeout(subscriptionTimer);send({type:'subscribed',scope,ids:[...ids]});void start();
  });
  client.onClose(()=>stop());client.onError(()=>stop());
  send({type:'hello',ts:Date.now()});
  return {close:()=>stop()};
}
