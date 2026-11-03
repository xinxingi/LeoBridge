import { safeError } from '../../core/errors.ts';
import type { Connect,Socket } from '../../core/socket.ts';
import type { KomariService } from './service.ts';

/** Real Komari RPC2 request/response transport, independent of CFSM subscribe/batchUpdate. */
export function komariRealtime(service:KomariService,client:Socket,connect:Connect,path='/api/rpc2') {
  let stopped=false,source:Socket|undefined,connecting=false,generation=0,retry=1000,lastFrame=0,inflight=0;
  let reconnectTimer:ReturnType<typeof setTimeout>|undefined;
  const safeClose=(socket:Socket|undefined,code=1000,reason='closed')=>{try{socket?.close(code,reason);}catch{/* already closed */}};
  const send=(value:unknown)=>{if(!stopped){try{client.send(JSON.stringify(value));}catch{stop();}}};
  const lifetime=setTimeout(()=>stop(1012,'connection renewal'),600_000);
  const watchdog=setInterval(()=>{if(lastFrame&&Date.now()-lastFrame>service.config.staleMs)lose();},5000);
  function stop(code=1000,reason='closed') {
    if(stopped)return;stopped=true;generation++;
    clearTimeout(lifetime);clearInterval(watchdog);clearTimeout(reconnectTimer);
    const previous=source;source=undefined;safeClose(previous,1000,'viewer closed');safeClose(client,code,reason);
  }
  function lose() {
    if(stopped)return;generation++;connecting=false;lastFrame=0;
    const previous=source;source=undefined;safeClose(previous,1000,'reconnect');
    // A local transport loss must not invalidate another viewer's fresh data
    // or pending history reads. Rejected source payloads still fail closed.
    if(!reconnectTimer){reconnectTimer=setTimeout(()=>{reconnectTimer=undefined;void start();},retry);retry=Math.min(retry*2,30_000);}
  }
  async function start() {
    if(stopped||connecting)return;connecting=true;const version=++generation;
    try {
      const socket=await connect();
      if(stopped||version!==generation){safeClose(socket,1000,'cancelled');return;}
      source=socket;connecting=false;lastFrame=Date.now();
      socket.onMessage(data=>{
        if(stopped||version!==generation)return;
        try{service.acceptRealtime(JSON.parse(data));lastFrame=Date.now();retry=1000;}catch{service.upstream.invalidate();lose();}
      });
      socket.onClose(()=>{if(!stopped&&version===generation)lose();});
      socket.onError(()=>{if(!stopped&&version===generation)lose();});
    }catch{if(!stopped&&version===generation)lose();}
  }
  async function receive(text:string) {
    if(stopped)return;
    if(text.length>131072){stop(1009,'message too large');return;}
    if(inflight>=8){stop(1008,'too many pending requests');return;}
    inflight++;
    try {
      if(path==='/api/clients') {
        if(text!=='get'&&!/^get [A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(text)){send({status:'error',error:'Invalid message'});return;}
        try{send(await service.legacySnapshot(text==='get'?undefined:text.slice(4)));}
        catch(error){const safe=safeError(error);send({status:'error',error:safe.message,code:safe.code});}
        return;
      }
      let payload:unknown;
      try{payload=JSON.parse(text);}catch{send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}});return;}
      const response=await service.rpc(payload);
      if(response!==null)send(response);
    }finally{inflight--;}
  }
  client.onMessage(text=>{void receive(text).catch(()=>stop(1011,'request failed'));});
  client.onClose(()=>stop());client.onError(()=>stop());
  void start();
  return {close:()=>stop()};
}
