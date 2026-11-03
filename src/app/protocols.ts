import { Bridge } from '../protocols/cfsm/service.ts';
import { realtime, type Connect, type Socket } from '../protocols/cfsm/realtime.ts';
import { KomariService,KOMARI_WS_PATHS } from '../protocols/komari/service.ts';
import { komariRealtime } from '../protocols/komari/realtime.ts';
import type { Config } from '../core/config.ts';
import { Upstream } from '../upstream/client.ts';
export interface ProtocolApplication {
  fetch(request:Request):Promise<Response|null>;
  websocketPaths:readonly string[];
  openRealtime(client:Socket,connect:Connect,path:string):{close():void};
}
/** Both adapters share upstream facts/cache, never each other's wire formats. */
export function protocolApplications(config:Config):Record<string,ProtocolApplication>{
  const upstream=new Upstream(config),cfsm=new Bridge(config,upstream),komari=new KomariService(config,upstream);
  return {
    'cfsm-609cc0b':{fetch:r=>cfsm.api(r),websocketPaths:['/api/ws'],openRealtime:(client,connect)=>realtime(cfsm,client,connect)},
    'komari-adhesive-v1':{fetch:r=>komari.handle(r),websocketPaths:KOMARI_WS_PATHS,openRealtime:(client,connect,path)=>komariRealtime(komari,client,connect,path)},
    'komari-default-bed58b5':{fetch:r=>komari.handle(r),websocketPaths:KOMARI_WS_PATHS,openRealtime:(client,connect,path)=>komariRealtime(komari,client,connect,path)},
  };
}
