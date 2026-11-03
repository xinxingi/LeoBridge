import type { Config } from '../core/config.ts';
import { BridgeError } from '../core/errors.ts';
import { identityVector, resolveBindings } from '../core/identity.ts';
import { finiteNumber, isRecord, type Snapshot } from '../core/model.ts';
import type { Upstream } from './client.ts';

/** Ecological-neutral facts: capacities in bytes, rates in bytes/s. */
export interface HistoryPoint {
  timestamp: number;
  cpuPercent?: number|null; memoryUsedBytes?: number|null; memoryTotalBytes?: number|null;
  diskUsedBytes?: number|null; diskTotalBytes?: number|null;
  downloadBytesPerSecond?: number|null; uploadBytesPerSecond?: number|null;
  tcpConnections?: number|null; udpConnections?: number|null;
}
export interface PingSample {
  timestamp:number; targetKey:string; latencyMs:number|null; lossPercent:number|null;
  state:'measurement'|'timeout'|'missing';
}
export interface HistoricalSeries { points:HistoryPoint[]; pings:PingSample[]; bucketSeconds:number; }
const fields = {
  cpu_pct:'cpuPercent',mem_used:'memoryUsedBytes',mem_total:'memoryTotalBytes',
  disk_used:'diskUsedBytes',disk_total:'diskTotalBytes',download_speed:'downloadBytesPerSecond',
  upload_speed:'uploadBytesPerSecond',tcp_connections:'tcpConnections',udp_connections:'udpConnections',
} as const;
function bucketWidth(raw:Record<string,unknown>):number {
  const width=finiteNumber(raw.bucket_sec,Number.MIN_VALUE);
  if(raw.success!==true||width===null)throw new BridgeError('UPSTREAM_HISTORY',502,'上游历史结构无效或查询失败。');
  return width;
}
export function normalizeSystemSeries(raw:unknown,start:number,end:number):HistoryPoint[] {
  if(!isRecord(raw)||!isRecord(raw.series))throw new BridgeError('UPSTREAM_HISTORY',502,'上游系统历史结构无效。');
  bucketWidth(raw);
  const rows=new Map<number,HistoryPoint>();
  for(const [source,target]of Object.entries(fields)) {
    const points=raw.series[source];if(points===undefined)continue;
    if(!Array.isArray(points))throw new BridgeError('UPSTREAM_HISTORY',502,'上游系统历史序列无效。');
    for(const point of points) {
      if(!isRecord(point)||typeof point.t!=='number'||!Number.isFinite(point.t)||point.t<1e9||point.t>1e11)throw new BridgeError('UPSTREAM_HISTORY',502,'上游历史时间格式无效。');
      const timestamp=point.t*1000;if(timestamp<start||timestamp>end)continue;
      const row=rows.get(timestamp)||{timestamp};
      if(target in row)throw new BridgeError('UPSTREAM_HISTORY',502,'上游历史含重复时间点。');
      const value=finiteNumber(point.value);
      row[target]=target==='cpuPercent'&&value!==null&&value>100?null:value;
      rows.set(timestamp,row);
    }
  }
  return [...rows.values()].sort((a,b)=>a.timestamp-b.timestamp);
}
export function normalizePingValue(ms:unknown,loss:unknown):Pick<PingSample,'latencyMs'|'lossPercent'|'state'> {
  const latencyMs=finiteNumber(ms),numericLoss=finiteNumber(loss);
  const lossPercent=numericLoss!==null&&numericLoss<=100?numericLoss:null;
  return {latencyMs,lossPercent,state:latencyMs!==null?'measurement':lossPercent===100?'timeout':'missing'};
}
/** Source frontend aligns its most recent bucket to generated_at. */
export function normalizePingSeries(raw:unknown,targetKeys:string[],start:number,end:number):PingSample[] {
  if(!isRecord(raw)||typeof raw.generated_at!=='number'||!Number.isFinite(raw.generated_at)||raw.generated_at<1e9||raw.generated_at>1e11||!Array.isArray(raw.all_series))throw new BridgeError('UPSTREAM_HISTORY',502,'上游 Ping 历史结构无效。');
  const width=bucketWidth(raw),aligned=Math.floor(raw.generated_at/width)*width;
  const rows:PingSample[]=[];
  for(const targetKey of [...new Set(targetKeys)]) {
    const matches=raw.all_series.filter(item=>isRecord(item)&&item.key===targetKey);
    if(matches.length>1)throw new BridgeError('UPSTREAM_HISTORY',502,'上游 Ping 目标键不唯一。');
    if(matches.length===0)continue;
    const series=matches[0];
    if(!isRecord(series)||!Array.isArray(series.buckets))throw new BridgeError('UPSTREAM_HISTORY',502,'上游 Ping 桶结构无效。');
    const count=series.buckets.length;
    series.buckets.forEach((bucket:unknown,index:number)=>{
      if(!isRecord(bucket))throw new BridgeError('UPSTREAM_HISTORY',502,'上游 Ping 桶无效。');
      const timestamp=(aligned-count*width+width+index*width)*1000;
      if(timestamp<start||timestamp>end)return;
      rows.push({timestamp,targetKey,...normalizePingValue(bucket.ms,bucket.loss)});
    });
  }
  return rows.sort((a,b)=>a.timestamp-b.timestamp||a.targetKey.localeCompare(b.targetKey));
}
/** Source-side access and identity guard, independent of either output protocol. */
export class Series {
  private cache=new Map<string,{at:number;vector:string;value:HistoricalSeries}>();
  private inflight=new Map<string,Promise<HistoricalSeries>>();
  constructor(private upstream:Upstream,private config:Config,private now=Date.now){}
  maxHours(snapshot:Snapshot) {return snapshot.historyDays!==null&&snapshot.historyDays>=7?168:24;}
  get(id:string,hours:number):Promise<HistoricalSeries> {
    const key=`${id}:${hours}`,pending=this.inflight.get(key);if(pending)return pending;
    const task=this.load(id,hours,key);this.inflight.set(key,task);
    void task.finally(()=>this.inflight.delete(key)).catch(()=>{});return task;
  }
  private async load(id:string,hours:number,key:string):Promise<HistoricalSeries> {
    if(!Number.isFinite(hours)||hours<=0||hours>168)throw new BridgeError('HISTORY_RANGE',400,'不支持的历史范围。');
    const before=await this.upstream.snapshot(true);
    if(hours>this.maxHours(before))throw new BridgeError('HISTORY_RANGE',400,'上游未声明支持该历史范围。');
    const target=resolveBindings(before,this.config.bindings).find(server=>server.id===id);
    if(!target)throw new BridgeError('NOT_FOUND',404,'服务器不在当前公开列表中。');
    const vector=JSON.stringify(identityVector(before,this.config.bindings));
    const cached=this.cache.get(key);if(cached&&cached.vector===vector&&this.now()-cached.at<30000)return cached.value;
    const range=hours<=1?'1h':hours<=6?'6h':hours<=24?'24h':'7d',params={server:String(target.index),range};
    const targetKeys=Object.values(this.config.pingTargets).map(target=>target.key);
    const [system,ping]=await Promise.all([
      this.upstream.json('/api/public/probe-series',{...params,metric:'system'}),
      targetKeys.length?this.upstream.json('/api/public/probe-series',{...params,metric:'ping',all:'1'}):Promise.resolve(null),
    ]);
    const bucketSeconds={'1h':300,'6h':600,'24h':1800,'7d':7200}[range];
    if(!isRecord(system)||system.bucket_sec!==bucketSeconds||(ping!==null&&(!isRecord(ping)||ping.bucket_sec!==bucketSeconds)))throw new BridgeError('UPSTREAM_HISTORY_RANGE',502,'上游历史范围响应与已核实协议不符。');
    const after=await this.upstream.snapshot(true);
    if(vector!==JSON.stringify(identityVector(after,this.config.bindings)))throw new BridgeError('IDENTITY_CHANGED',409,'查询期间公开服务器顺序变化，请重试。');
    const end=this.now(),start=end-hours*3600000;
    const value:HistoricalSeries={points:normalizeSystemSeries(system,start,end),pings:ping===null?[]:normalizePingSeries(ping,targetKeys,start,end),bucketSeconds};
    this.cache.set(key,{at:end,vector,value});if(this.cache.size>100)this.cache.delete(this.cache.keys().next().value!);
    return value;
  }
}
