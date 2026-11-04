import type { PresentationContext } from '../../core/presentation.ts';
import type { Config } from '../../core/config.ts';
import { BridgeError } from '../../core/errors.ts';
import { identityVector, resolveBindings } from '../../core/identity.ts';
import { isRecord, type Snapshot } from '../../core/model.ts';
import { json } from '../../core/http.ts';
import { Upstream } from '../../upstream/client.ts';

const topFields='enabled show_globe show_daily_trend show_traffic_hotspots show_traffic_7d show_resource_heatmap show_traffic_quota show_renewal_timeline show_health_score history_days title logo icon'.split(' ');
const serverFields='region region_country region_name region_city online last_seen upload_speed download_speed traffic_used traffic_used_up traffic_used_down traffic_used_total traffic_limit traffic_source traffic_stats_mode traffic_adjustment traffic_used_scope period_start period_end daily_traffic_scope daily_traffic_start daily_traffic_end boot_traffic_up boot_traffic_down boot_traffic_scope cumulative_up cumulative_down cumulative_traffic_scope cpu_pct loadavg mem_used mem_total disk_used disk_total uptime cpu_model cpu_cores cpu_threads os kernel arch tcp_connections udp_connections expires_at renewal_price renewal_price_cny renewal_cycle renewal_currency provider_name provider_url telecom_paid_peer'.split(' ');
function pick(raw:Record<string,unknown>,keys:readonly string[]){return Object.fromEntries(keys.filter(key=>Object.hasOwn(raw,key)).map(key=>[key,raw[key]]));}
function rows(raw:unknown,keys:string[]){return Array.isArray(raw)?raw.filter(isRecord).map(row=>pick(row,keys)):undefined;}
function ping(raw:unknown){return Array.isArray(raw)?raw.filter(isRecord).map(row=>({...pick(row,['key','label','isp','current_ms','loss_pct','tri_fallback']),...(Array.isArray(row.buckets)?{buckets:rows(row.buckets,['ms','loss'])}:{})})):undefined;}
function forward(raw:unknown){
  return Array.isArray(raw)?raw.filter(isRecord).map(chain=>({
    ...pick(chain,['name','end_to_end_ms','loss_pct','route_hop','route_policy','failover_ms','bucket_sec','availability_24h','jitter_ms','cells']),
    ...(Array.isArray(chain.groups)?{groups:chain.groups.filter(isRecord).map(group=>({...pick(group,['name','role','to_next_ms','loss_pct']),servers:rows(group.servers,['name','to_next_ms','healthy','loss_pct','route'])}))}:{}),
    ...(Array.isArray(chain.routes)?{routes:rows(chain.routes,['name','via','latency_ms','loss_pct','selected','selected_by'])}:{}),
    ...(Array.isArray(chain.trend)?{trend:rows(chain.trend,['ts','e2e_ms','loss'])}:{}),
    ...(chain.traffic===null?{traffic:null}:isRecord(chain.traffic)?{traffic:{...pick(chain.traffic,['days','total_gb']),servers:rows(chain.traffic.servers,['name','group','role','daily_gb','total_gb'])}}:{}),
  })):undefined;
}
/** Native public wire format: no CFSM/Komari units or synthesized metrics.
 * Project known public fields only; never expose arbitrary source fields. */
export class NativeService {
  constructor(readonly config:Config,readonly upstream=new Upstream(config)){}
  snapshot(snapshot:Snapshot,presentation?:PresentationContext):Record<string,unknown>{
    if(!snapshot.enabled)return {enabled:false};
    const resolved=resolveBindings(snapshot,this.config.bindings),byId=new Map(resolved.map(row=>[row.id,row]));
    const raw=snapshot.raw,result=pick(raw,topFields);
    if(isRecord(raw.appearance))result.appearance=pick(raw.appearance,['theme','color_mode','revision']);
    if(presentation?.nativeTheme&&presentation.nativeTheme!=='source')result.appearance={...(isRecord(result.appearance)?result.appearance:{}),theme:presentation.nativeTheme};
    if(isRecord(raw.license_badge))result.license_badge=pick(raw.license_badge,['name','display_name']);
    if(isRecord(raw.tri_isp))result.tri_isp={...pick(raw.tri_isp,['enabled']),targets:rows(raw.tri_isp.targets,['isp','key','label'])};
    if(snapshot.showName&&Array.isArray(raw.forward))result.forward=forward(raw.forward);
    // Index is a native view slot, resolved via explicit bindings on each read.
    result.servers=this.config.bindings.map(binding=>{
      const raw=byId.get(binding.id)!.raw,server=pick(raw,serverFields);
      if(snapshot.showName&&Object.hasOwn(raw,'name'))server.name=raw.name;
      if(Array.isArray(raw.ping))server.ping=ping(raw.ping);
      if(isRecord(raw.conn_history))server.conn_history=pick(raw.conn_history,['tcp','udp']);
      if(Array.isArray(raw.daily_traffic))server.daily_traffic=rows(raw.daily_traffic,['date','uplink','downlink','total']);
      if(Array.isArray(raw.return_routes))server.return_routes=rows(raw.return_routes,['carrier','region','route_type','tested_at']);
      if(Array.isArray(raw.unlocks))server.unlocks=rows(raw.unlocks,['service','status','region','tested_at']);
      return server;
    });
    return result;
  }
  async handle(request:Request,presentation?:PresentationContext):Promise<Response|null>{
    const url=new URL(request.url);
    if(!['/api/probe','/api/series','/api/forward'].includes(url.pathname))return null;
    if(request.method!=='GET')throw new BridgeError('METHOD_NOT_ALLOWED',405,'原生探针仅提供只读接口。');
    if(url.pathname==='/api/probe'){
      try{return json(this.snapshot(await this.upstream.snapshot(),presentation));}
      catch(error){if(error instanceof BridgeError&&error.code==='PROBE_DISABLED')return json({enabled:false});throw error;}
    }
    if(url.pathname==='/api/forward'){
      const snapshot=await this.upstream.snapshot();resolveBindings(snapshot,this.config.bindings);
      if(!snapshot.showName)return json({chains:[]});
      const data=await this.upstream.json('/api/public/probe-forward');
      if(!isRecord(data))throw new BridgeError('UPSTREAM_SCHEMA',502,'上游转发链响应无效。');
      const after=await this.upstream.snapshot(true);
      if(!after.showName)return json({chains:[]});
      resolveBindings(after,this.config.bindings);
      return json({...pick(data,['enabled','success']),chains:forward(data.chains)});
    }
    return json(await this.series(url));
  }
  async series(url:URL){
    const slot=url.searchParams.get('server'),range=url.searchParams.get('range')??'1h',metric=url.searchParams.get('metric')??'ping';
    if(!slot||!/^\d+$/.test(slot)||!Number.isSafeInteger(Number(slot))||!this.config.bindings[Number(slot)])throw new BridgeError('NOT_FOUND',404,'服务器不在当前展示列表中。');
    if(!['1h','6h','24h','2d','3d','4d','5d','6d','7d'].includes(range)||!['ping','system'].includes(metric))throw new BridgeError('HISTORY_RANGE',400,'不支持的原生历史查询。');
    const before=await this.upstream.snapshot(true),id=this.config.bindings[Number(slot)]!.id;
    if(range.endsWith('d')&&Number(range.slice(0,-1))>(before.historyDays??1))throw new BridgeError('HISTORY_RANGE',400,'上游未声明此历史范围。');
    const target=resolveBindings(before,this.config.bindings).find(row=>row.id===id)!;
    const vector=JSON.stringify(identityVector(before,this.config.bindings));
    const params={server:String(target.index),range,metric,...(metric==='ping'?{all:'1'}:{})};
    const raw=await this.upstream.json('/api/public/probe-series',params);
    const width=range==='1h'?300:range==='6h'?600:range==='24h'?1800:Number(range.slice(0,-1))<=3?3600:7200;
    if(!isRecord(raw)||raw.success!==true||raw.bucket_sec!==width)throw new BridgeError('UPSTREAM_HISTORY',502,'上游原生历史结构或桶宽无效。');
    const after=await this.upstream.snapshot(true);
    if(before.showName!==after.showName||vector!==JSON.stringify(identityVector(after,this.config.bindings)))throw new BridgeError('IDENTITY_CHANGED',409,'查询期间公开节点发生变化，请重试。');
    const result=pick(raw,['success','bucket_sec','buckets','generated_at']);
    if(metric==='system'){
      if(!isRecord(raw.series))throw new BridgeError('UPSTREAM_HISTORY',502,'上游系统历史结构无效。');
      const fields=[...serverFields.filter(key=>!['name','provider_url'].includes(key))];
      result.series=Object.fromEntries(fields.filter(key=>Array.isArray((raw.series as Record<string,unknown>)[key])).map(key=>[key,rows((raw.series as Record<string,unknown>)[key],['t','value'])]));
    }else{
      if(!Array.isArray(raw.all_series))throw new BridgeError('UPSTREAM_HISTORY',502,'上游延迟历史结构无效。');
      result.all_series=ping(raw.all_series);if(isRecord(raw.series))result.series=ping([raw.series])![0];
    }
    return result;
  }
}
