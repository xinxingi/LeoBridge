import type { PresentationContext } from '../../core/presentation.ts';
import { authorize,type Config } from '../../core/config.ts';
import { BridgeError,safeError } from '../../core/errors.ts';
import { resolveBindings } from '../../core/identity.ts';
import { isRecord,normalizeServer,type Snapshot,type UnifiedServer } from '../../core/model.ts';
import { Upstream } from '../../upstream/client.ts';
import { Series } from '../../upstream/series.ts';
import { KOMARI_PROFILE,komariNode,komariStatus,komariRecent,komariRecord,komariTargets,komariPingRecords,komariFlatRecent,type Transport } from './adapter.ts';
import { metricDefinitions,queryMetrics } from './metrics.ts';

type RpcId=string|number|null;
export interface RpcResponse {jsonrpc:'2.0';id:RpcId;result?:unknown;error?:{code:number;message:string;data?:unknown};}
export class RpcError extends Error {constructor(readonly code:number,message:string,readonly data?:unknown){super(message);}}
const invalidParams=()=>new RpcError(-32602,'Invalid parameters');
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export const KOMARI_WS_PATHS=['/api/rpc2','/api/clients'] as const;
export class KomariService {
  readonly upstream:Upstream;
  readonly series:Series;
  private websocketSnapshot?:Snapshot;
  private historyActive=0;
  private historyWaiting:(()=>void)[]=[];
  private recent=new Map<string,ReturnType<typeof komariRecent>[]>();
  constructor(readonly config:Config,upstream?:Upstream,private now=Date.now) {
    this.upstream=upstream??new Upstream(config);this.series=new Series(this.upstream,config,now);
    komariTargets(config.pingTargets);
  }
  private entries(snapshot:Snapshot) {
    const entries=resolveBindings(snapshot,this.config.bindings).map(server=>({id:server.id,model:normalizeServer(server.raw,snapshot.observedAt,snapshot.showName)}));
    const available=new Set(entries.map(entry=>entry.id));
    for(const id of this.recent.keys())if(!available.has(id))this.recent.delete(id);
    for(const entry of entries) {
      const rows=(this.recent.get(entry.id)??[]).filter(row=>Date.parse(row.updated_at)>=this.now()-600_000);
      if(entry.model.online===true&&(!rows.length||Date.parse(rows[rows.length-1]!.updated_at)<snapshot.observedAt))rows.push(komariRecent(entry.model,entry.id,this.config.staleMs,this.transport(snapshot),this.now()));
      this.recent.set(entry.id,rows.slice(-60));
    }
    return entries;
  }
  private transport(snapshot:Snapshot):Transport{return snapshot===this.websocketSnapshot?'websocket':'poll';}
  acceptRealtime(raw:unknown):Snapshot {
    const snapshot=this.upstream.accept(raw);
    this.websocketSnapshot=snapshot;
    try{this.entries(snapshot);}catch(error){this.upstream.invalidate();throw error;}
    return snapshot;
  }
  private async current() {const snapshot=await this.upstream.snapshot();return {snapshot,entries:this.entries(snapshot)};}
  /** Bound history work across HTTP batches, websocket calls and individual methods. */
  private async history(id:string,hours:number) {
    if(this.historyActive>=4)await new Promise<void>(resolve=>this.historyWaiting.push(resolve));
    else this.historyActive++;
    try{return await this.series.get(id,hours);}
    finally{const next=this.historyWaiting.shift();if(next)next();else this.historyActive--;}
  }
  private uuid(params:Record<string,unknown>):string {if(typeof params.uuid!=='string'||!params.uuid)throw invalidParams();return params.uuid;}
  private hours(params:Record<string,unknown>):number {
    const value=params.hours===undefined?4:params.hours;
    if(typeof value!=='string'&&typeof value!=='number')throw invalidParams();
    const hours=Number(value);if(!Number.isFinite(hours)||hours<=0||hours>168)throw invalidParams();return hours;
  }
  async method(method:string,params:unknown={},presentation?:PresentationContext):Promise<unknown> {
    if(!isRecord(params))throw invalidParams();
    if(method==='common:getVersion'||method==='common:getBackendVersion')method='public:getVersion';
    if(method==='common:getPublicInfo')method='public:getPublicSettings';
    if(method==='common:getMe')return {'2fa_enabled':false,logged_in:false,sso_id:'',sso_type:'',username:'Guest',uuid:''};
    if(method==='common:getRecords')return this.records(params);

    if(method==='public:queryMetrics'||method==='public:getPingMetricStats') {
      if(typeof params.entity_id!=='string'||!params.entity_id)throw invalidParams();
      // The source exposes relative ranges only. Do not pretend to support arbitrary dates or aggregations.
      if(['start','end','start_time','end_time'].some(key=>params[key]!==undefined))throw new BridgeError('UNSUPPORTED_RANGE',422,'上游仅支持相对历史范围。');
      if(params.aggregation!==undefined&&params.aggregation!=='avg')throw new BridgeError('UNSUPPORTED_AGGREGATION',422,'仅提供上游原始聚合桶。');
      if(method==='public:queryMetrics'&&(!Array.isArray(params.metric_keys)||params.metric_keys.length>32||params.metric_keys.some(key=>typeof key!=='string')))throw invalidParams();
      const hours=this.hours(params),end=this.now(),start=end-hours*3_600_000;
      const series=await this.history(params.entity_id,hours);
      if(method==='public:getPingMetricStats'){
        if(params.task_ids!==undefined&&(!Array.isArray(params.task_ids)||params.task_ids.length>500))throw invalidParams();
        const filters=[params.task_id,...(params.task_ids as unknown[]??[])].filter(value=>value!==null&&value!==undefined);
        if(filters.some(value=>typeof value!=='string'&&(typeof value!=='number'||!Number.isInteger(value))))throw invalidParams();
        const taskIds=new Set(filters.map(value=>String(value).trim()).filter(Boolean));
        const summaries=komariPingRecords(series,params.entity_id,this.config.pingTargets).tasks.filter(task=>task.total>0&&task.loss!==null&&(!taskIds.size||taskIds.has(String(task.id))));
        const stats=summaries.map(summary=>{
          const target=komariTargets(this.config.pingTargets).find(target=>target.id===summary.id)!;
          const latest=series.pings.filter(point=>point.targetKey===target.key).at(-1);
          return {entity_id:params.entity_id,task_id:String(summary.id),name:summary.name,type:summary.type,interval:summary.interval,
            total:null,valid:null,loss:summary.loss,loss_approximate:true,
            ...Object.fromEntries(Object.entries({min:summary.min,max:summary.max,avg:summary.avg,latest:latest?.latencyMs}).filter(([,value])=>value!==null&&value!==undefined)),
            aggregation:'source_bucket',sample_buckets:summary.total};
        });
        return {start:new Date(start).toISOString(),end:new Date(end).toISOString(),stats,count:stats.length,interval_seconds:series.bucketSeconds,
          bridge:{unsupported:'packet_counts_and_percentiles',aggregation:'source_bucket',note:'仅源桶RTT和丢包率摘要，不代表逐包统计或分位数。'}};
      }
      return queryMetrics(series,params.entity_id,[...new Set(params.metric_keys as string[])],this.config.pingTargets,start,end);
    }
    if(method==='rpc.ping')return 'pong';
    if(method==='public:getVersion')return {version:'LeoBridge 0.1.0',hash:KOMARI_PROFILE};
    if(method==='public:getMe')return {username:'Guest',logged_in:false};
    if(method==='public:getRecordsByUUID'||method==='public:getPingRecords') {
      const hours=this.hours(params);
      if(method==='public:getPingRecords'&&(params.uuid===undefined||params.uuid==='')){
        if(params.task_id===undefined)throw invalidParams();
        return this.records({...params,type:'ping',hours});
      }
      const id=this.uuid(params);
      if(method==='public:getRecordsByUUID') {
        const loadType=params.load_type??'all';
        if(typeof loadType!=='string')throw invalidParams();
        const supported=['all','','cpu','ram','swap','load','temp','disk','network','process','connections'];
        if(!supported.includes(loadType))throw new BridgeError('UNSUPPORTED_METRIC',501,'上游未提供该历史指标。');
        const series=await this.history(id,hours);
        return {count:series.points.length,records:series.points.map(point=>komariRecord(point,id)),has_gpu_data:false,
          bridge:{aggregation:'source_bucket',bucket_seconds:series.bucketSeconds,unsupported:['gpu','swap','load','temp','process','traffic']}};
      }
      let taskId:number|undefined;
      if(params.task_id!==undefined) {
        if(typeof params.task_id!=='string'&&typeof params.task_id!=='number')throw invalidParams();
        taskId=Number(params.task_id);if(!Number.isInteger(taskId)||taskId < -1||(taskId>0&&!komariTargets(this.config.pingTargets).some(task=>task.id===taskId)))throw invalidParams();
        if(taskId<=0)taskId=undefined;
      }
      return komariPingRecords(await this.history(id,hours),id,this.config.pingTargets,taskId);
    }
    const allowed=['common:getNodes','public:listMetricDefinitions','public:getNodesInformation','public:getPublicSettings','public:getClientRecentRecords','common:getNodeRecentStatus','public:getPublicPingTasks','common:getNodesLatestStatus'];
    if(!allowed.includes(method))throw new RpcError(-32601,'Method not found');
    const {snapshot,entries}=await this.current();
    const transport=this.transport(snapshot);
    if(method==='common:getNodes'){
      if(params.uuid!==undefined){const id=this.uuid(params),entry=entries.find(entry=>entry.id===id);if(!entry)throw new RpcError(-32602,'Node not found');return komariNode(entry.model,id,this.config.staleMs,transport,this.now());}
      return Object.fromEntries(entries.map(({id,model})=>[id,komariNode(model,id,this.config.staleMs,transport,this.now())]));
    }
    if(method==='public:listMetricDefinitions')return metricDefinitions(this.series.maxHours(snapshot));
    if(method==='public:getNodesInformation')return entries.map(({id,model})=>komariNode(model,id,this.config.staleMs,transport,this.now()));
    if(method==='public:getPublicSettings') {
      const hours=this.series.maxHours(snapshot);
      return {sitename:this.config.title,description:'LeoBridge · 妙妙屋X数据展示',theme:presentation?.theme??'default',theme_settings:presentation?.settings??{},private_site:false,metric_retention_days:hours/24,
        record_enabled:true,record_preserve_time:hours,ping_record_preserve_time:hours,custom_head:'',custom_body:'',oauth_enable:false,oauth_provider:'',
        disable_password_login:true,cors_origin_check_enabled:true,visitor_audit_enabled:false,
        bridge:{profile:KOMARI_PROFILE,stale_ms:this.config.staleMs,history_hours:[1,6,24,...(hours>=168?[48,96,168]:[])],
          recent_note:'仅桥接进程实际观察到的短时样本；不回填历史。',aggregation:'source_bucket',unsupported:['管理','Agent','远程控制','GPU','Swap','磁盘IO','进程数','流量累计']}};
    }
    if(method==='public:getPublicPingTasks')return komariTargets(this.config.pingTargets).map(target=>({id:target.id,name:target.name,weight:0,clients:entries.map(entry=>entry.id),default_on:true,type:'aggregate',interval:null}));
    if(method==='public:getClientRecentRecords'||method==='common:getNodeRecentStatus') {
      const id=this.uuid(params);if(!entries.some(entry=>entry.id===id))throw new BridgeError('NOT_FOUND',404,'服务器不在当前公开列表中。');
      const rows=(this.recent.get(id)??[]).map(row=>({...row,bridge:{...row.bridge,stale:this.now()-Date.parse(row.updated_at)>this.config.staleMs}}));
      if(method==='public:getClientRecentRecords')return rows;
      if(params.limit!==undefined&&(!Number.isInteger(params.limit)||Number(params.limit)<1||Number(params.limit)>10000))throw invalidParams();
      const records=rows.slice(-Number(params.limit??60)).map(komariFlatRecent);
      return {count:records.length,records};
    }
    const status=(entry:{id:string;model:UnifiedServer})=>komariStatus(entry.model,entry.id,this.config.staleMs,transport,this.now());
    if(params.uuid!==undefined){const id=this.uuid(params),entry=entries.find(entry=>entry.id===id);if(!entry)throw new BridgeError('NOT_FOUND',404,'服务器不在当前公开列表中。');return status(entry);}
    let selected=entries;
    if(params.uuids!==undefined){if(!Array.isArray(params.uuids)||params.uuids.length>500||params.uuids.some(id=>typeof id!=='string'))throw invalidParams();const ids=new Set(params.uuids as string[]);selected=entries.filter(entry=>ids.has(entry.id));}
    return Object.fromEntries(selected.map(entry=>[entry.id,status(entry)]));
  }
  /** Native common:getRecords groups load rows by client, but Ping rows remain flat. */
  private async records(params:Record<string,unknown>) {
    const type=params.type??'load';if(type!=='load'&&type!=='ping')throw invalidParams();
    if(['start','end','start_time','end_time'].some(key=>params[key]!==undefined))throw new BridgeError('UNSUPPORTED_RANGE',422,'上游仅支持相对历史范围。');
    const hours=this.hours({...params,hours:params.hours??1}),end=this.now(),start=end-hours*3_600_000;
    const {entries}=await this.current();
    const id=params.uuid===undefined||params.uuid===''?undefined:this.uuid(params);
    const selected=entries.filter(entry=>!id||entry.id===id);
    if(id&&!selected.length)throw new RpcError(-32602,'Node not found');
    const task=Number(params.task_id??-1);
    if(type==='ping'&&(!Number.isInteger(task)||task < -1))throw invalidParams();
    const taskId=task>0?task:undefined;
    if(taskId!==undefined&&!komariTargets(this.config.pingTargets).some(target=>target.id===taskId))throw invalidParams();
    const known=['all','','cpu','ram','swap','load','temp','disk','network','process','connections'];
    const loadType=params.load_type??'all';
    if(type==='load'&&(typeof loadType!=='string'||!known.includes(loadType)))throw invalidParams();
    // The source contains already-aggregated buckets. Keep them intact; maxCount is advisory.
    const values:Awaited<ReturnType<Series['get']>>[]=new Array(selected.length);
    let cursor=0,failed=false,failure:unknown;
    await Promise.all(Array.from({length:Math.min(4,selected.length)},async()=>{
      while(!failed&&cursor<selected.length){
        const index=cursor++;
        try{values[index]=await this.history(selected[index]!.id,hours);}
        catch(error){if(!failed){failed=true;failure=error;}}
      }
    }));
    if(failed)throw failure;
    const bridge={aggregation:'source_bucket',packet_counts_available:false,max_count_applied:false};
    if(type==='load'){
      const records=Object.fromEntries(selected.map((entry,index)=>[entry.id,values[index]!.points.map(point=>komariRecord(point,entry.id))]));
      return {count:Object.values(records).reduce((count,rows)=>count+rows.length,0),records,load_type:loadType,from:new Date(start).toISOString(),to:new Date(end).toISOString(),bridge};
    }
    const records=selected.flatMap((entry,index)=>komariPingRecords(values[index]!,entry.id,this.config.pingTargets,taskId).records).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
    const tasks=komariPingRecords({points:[],pings:values.flatMap(value=>value.pings),bucketSeconds:values[0]?.bucketSeconds??300},'',this.config.pingTargets,taskId).tasks;
    return {count:records.length,records,tasks,from:new Date(start).toISOString(),to:new Date(end).toISOString(),bridge};
  }
  async rpc(payload:unknown,presentation?:PresentationContext):Promise<RpcResponse|RpcResponse[]|null> {
    if(Array.isArray(payload)) {
      if(payload.length===0||payload.length>32)return {jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid Request'}};
      const replies=await Promise.all(payload.map(item=>this.one(item,presentation)));const visible=replies.filter((reply):reply is RpcResponse=>reply!==null);return visible.length?visible:null;
    }
    return this.one(payload,presentation);
  }
  private async one(payload:unknown,presentation?:PresentationContext):Promise<RpcResponse|null> {
    if(!isRecord(payload)||payload.jsonrpc!=='2.0'||typeof payload.method!=='string'||(payload.id!==undefined&&payload.id!==null&&typeof payload.id!=='string'&&typeof payload.id!=='number'))return {jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid Request'}};
    const id=(payload.id??null) as RpcId,notification=payload.id===undefined;
    try{const result=await this.method(payload.method,payload.params??{},presentation);return notification?null:{jsonrpc:'2.0',id,result};}
    catch(error){if(notification)return null;
      if(error instanceof RpcError)return {jsonrpc:'2.0',id,error:{code:error.code,message:error.message,...(error.data===undefined?{}:{data:error.data})}};
      const safe=safeError(error);return {jsonrpc:'2.0',id,error:{code:-32000,message:safe.message,data:{bridge_code:safe.code,status:safe.status}}};
    }
  }
  async legacySnapshot(id?:string) {
    const {snapshot,entries}=await this.current();
    if(id&&!entries.some(entry=>entry.id===id))throw new BridgeError('NOT_FOUND',404,'服务器不在当前公开列表中。');
    const selected=entries.filter(entry=>!id||entry.id===id);
    return {status:'success',data:{online:selected.filter(entry=>entry.model.online===true).map(entry=>entry.id),
      data:Object.fromEntries(selected.map(entry=>[entry.id,komariRecent(entry.model,entry.id,this.config.staleMs,this.transport(snapshot),this.now())]))}};
  }
  async handle(request:Request,presentation?:PresentationContext):Promise<Response|null> {
    const denied=authorize(request,this.config);if(denied)return denied;
    const url=new URL(request.url);if(!url.pathname.startsWith('/api/'))return null;
    try {
      if(url.pathname==='/api/rpc2') {
        if(request.method!=='POST')return json({error:'WebSocket upgrade or POST required'},426);
        const origin=request.headers.get('origin');if(origin&&origin!==url.origin)return json({error:'Forbidden'},403);
        const text=await request.text();if(text.length>131072)return json({error:'Request too large'},413);
        let payload:unknown;try{payload=JSON.parse(text);}catch{return json({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}});}
        const response=await this.rpc(payload,presentation);return response===null?new Response(null,{status:204}):json(response);
      }
      if(request.method!=='GET')return json({status:'error',error:'Read-only protocol'},405);
      const methods:Record<string,string>={'/api/nodes':'public:getNodesInformation','/api/public':'public:getPublicSettings','/api/me':'public:getMe','/api/version':'public:getVersion','/api/records/load':'public:getRecordsByUUID','/api/records/ping':'public:getPingRecords','/api/task/ping':'public:getPublicPingTasks'};
      let method=methods[url.pathname];const params:Record<string,unknown>=Object.fromEntries(url.searchParams);
      if(url.pathname.startsWith('/api/recent/')){method='public:getClientRecentRecords';params.uuid=decodeURIComponent(url.pathname.slice('/api/recent/'.length));}
      if(!method)return json({status:'error',error:'Not found'},404);
      const result=await this.method(method,params,presentation);return json(url.pathname==='/api/me'?result:{status:'success',data:result});
    }catch(error){
      if(error instanceof RpcError)return json({status:'error',error:error.message},error.code===-32602?400:404);
      const safe=safeError(error);return json({status:'error',error:safe.message,code:safe.code},safe.status);
    }
  }
  api(request:Request){return this.handle(request);}
}
