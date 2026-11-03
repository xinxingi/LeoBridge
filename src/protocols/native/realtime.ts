import type { Socket,Connect } from '../../core/socket.ts';
import type { NativeService } from './service.ts';
/** The upstream frontend already polls every five seconds. Send only complete
 * native snapshots over WS, never a protocol status object mistaken for data. */
export function nativeRealtime(service:NativeService,client:Socket,connect:Connect){
  let stopped=false,source:Socket|undefined,generation=0,lastFrame=0,retry=1000;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const lifetime=setTimeout(()=>stop(1012,'connection renewal'),600_000);
  const watchdog=setInterval(()=>{if(source&&Date.now()-lastFrame>service.config.staleMs)lose();},5000);
  function stop(code=1000,reason='closed'){
    if(stopped)return;stopped=true;generation++;clearTimeout(timer);clearTimeout(lifetime);clearInterval(watchdog);
    const old=source;source=undefined;old?.close(1000,'viewer closed');client.close(code,reason);
  }
  function lose(){
    if(stopped)return;generation++;const old=source;source=undefined;old?.close(1000,'reconnect');
    if(!timer){timer=setTimeout(()=>{timer=undefined;void start();},retry);retry=Math.min(30_000,retry*2);}
  }
  async function start(){
    const version=++generation;
    try{
      const socket=await connect();if(stopped||version!==generation){socket.close(1000,'cancelled');return;}
      source=socket;lastFrame=Date.now();
      socket.onMessage(data=>{
        if(stopped||version!==generation)return;
        try{
          if(data.length>12_000_000)throw new Error('Oversized frame');
          const snapshot=service.upstream.accept(JSON.parse(data));
          client.send(JSON.stringify(service.snapshot(snapshot)));lastFrame=Date.now();retry=1000;
        }catch{service.upstream.invalidate();stop(1013,'source data unavailable');}
      });
      socket.onClose(()=>{if(version===generation)lose();});socket.onError(()=>{if(version===generation)lose();});
    }catch{if(!stopped&&version===generation)lose();}
  }
  client.onClose(()=>stop());client.onError(()=>stop());client.onMessage(()=>stop(1008,'read only'));
  void start();return {close:()=>stop()};
}
