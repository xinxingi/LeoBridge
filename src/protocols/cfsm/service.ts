import { json,errorResponse } from '../../core/http.ts';
export { json,errorResponse } from '../../core/http.ts';
import { authorize, type Config } from '../../core/config.ts';
import { BridgeError } from '../../core/errors.ts';
import { resolveBindings } from '../../core/identity.ts';
import type { Snapshot } from '../../core/model.ts';
import { toServer } from './adapter.ts';
import { Upstream } from '../../upstream/client.ts';
import { History } from './history.ts';
import { applyPing } from './ping.ts';
export class Bridge {
  readonly upstream: Upstream;
  readonly history: History;
  constructor(readonly config:Config, upstream?:Upstream) {
    this.upstream=upstream||new Upstream(config); this.history=new History(this.upstream,config);
  }
  servers(snapshot:Snapshot) {
    return resolveBindings(snapshot,this.config.bindings).map(({raw,id})=>{
      const server=toServer(raw,id,snapshot.observedAt,snapshot.showName);
      applyPing(server,raw.ping,this.config.pingTargets);
      return server;
    });
  }
  async api(request:Request):Promise<Response | null> {
    const denied=authorize(request,this.config); if(denied)return denied;
    const url=new URL(request.url);
    if(!url.pathname.startsWith('/api/'))return null;
    try {
      if(request.method!=='GET')throw new BridgeError('METHOD_NOT_ALLOWED',405,'仅支持只读接口。');
      if(!['/api/config','/api/servers','/api/server','/api/history/all'].includes(url.pathname))throw new BridgeError('NOT_FOUND',404,'接口不存在。');
      if(url.pathname==='/api/history/all') {
        const id=url.searchParams.get('id'); const hours=Number(url.searchParams.get('hours')||'1');
        if(!id)throw new BridgeError('BAD_REQUEST',400,'缺少服务器 ID。');
        return json(await this.history.get(id,hours));
      }
      const snapshot=await this.upstream.snapshot();
      const config={
        version:'LeoBridge 0.1.0',site_title:this.config.title,is_public:true,authorization:false,
        turnstile_enabled:false,turnstile_login_enabled:false,display_mode:'bar',preferred_theme:'auto',default_language:'zh',
        show_price:false,show_expire:false,show_tf:false,show_three_net_details:Object.keys(this.config.pingTargets).length>0,
        frontend_ws_timeout_minutes:0,long_history_points:120,
        bridge:{stale_ms:this.config.staleMs,history_hours:this.history.hours(snapshot),history_bucket_seconds:Object.fromEntries(this.history.hours(snapshot).map(hours=>[hours,hours<=1?300:hours<=6?600:hours<=24?1800:7200])),history_note:'源端聚合采样；空缺不补点。部分指标不受支持。',identityMode:'explicit-bindings',unsupported:['管理后台','GPU','Swap','磁盘IO','进程数','计费及月流量']},
        ...Object.fromEntries(Object.entries(this.config.pingTargets).map(([slot,t])=>[`custom_${slot}_name`,t.label])),
      };
      if(url.pathname==='/api/config')return json(config);
      const servers=this.servers(snapshot);
      if(url.pathname==='/api/server') {
        const id=url.searchParams.get('id'); if(!id)throw new BridgeError('BAD_REQUEST',400,'缺少服务器 ID。');
        const server=servers.find(s=>s.id===id); if(!server)throw new BridgeError('NOT_FOUND',404,'服务器不在当前公开列表中。');
        return json({...server,sysConfig:config,latestReportUpdates:[]});
      }
      return json({servers,latestReportUpdates:[],sysConfig:config,stats:{total:servers.length,online:servers.filter(s=>s.online===true).length,offline:servers.filter(s=>s.online===false).length,unknown:servers.filter(s=>s.online===null).length,globalNetRx:null,globalNetTx:null,globalSpeedIn:sumKnown(servers,'net_in_speed'),globalSpeedOut:sumKnown(servers,'net_out_speed')},regionStats:servers.reduce<Record<string,number>>((out,s)=>{if(s.region)out[String(s.region)]=(out[String(s.region)]||0)+1;return out;},{})});
    } catch(error){return errorResponse(error);}
  }
}
function sumKnown(servers:Record<string,unknown>[],key:string) {
  const online=servers.filter(s=>s.online===true);
  return online.every(s=>typeof s[key]==='number')?online.reduce((n,s)=>n+Number(s[key]),0):null;
}
