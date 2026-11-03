import type { Config } from '../../core/config.ts';
import { BridgeError } from '../../core/errors.ts';
import type { UnifiedServer } from '../../core/model.ts';
import type { HistoricalSeries, HistoryPoint } from '../../upstream/series.ts';

export const KOMARI_PROFILE='komari-adhesive-8ac4fd2';
export type Transport='websocket'|'poll';
export function bridgeMetadata(input:UnifiedServer,staleMs:number,transport:Transport,now=Date.now()) {
  return {observed_at:input.observedAt,source_last_seen:input.sourceLastSeen,stale:now-input.observedAt>staleMs,stale_ms:staleMs,transport,timestamp_source:'bridge_observation'};
}
function countryFlag(code:string|null):string {
  return code&&/^[A-Z]{2}$/.test(code)?Array.from(code).map(char=>String.fromCodePoint(char.charCodeAt(0)-65+0x1f1e6)).join(''):'';
}
export function komariNode(input:UnifiedServer,id:string,staleMs:number,transport:Transport,now=Date.now()) {
  return {
    uuid:id,name:input.metadata.name??'服务器',cpu_name:input.metadata.cpuModel??'',virtualization:'',arch:input.metadata.architecture??'',
    cpu_cores:input.metadata.logicalCpuCount,cpu_physical_cores:null,os:input.metadata.operatingSystem??'',kernel_version:input.metadata.kernel??'',
    gpu_name:'',region:countryFlag(input.metadata.regionCode),mem_total:input.memoryTotalBytes,swap_total:null,disk_total:input.diskTotalBytes,
    weight:0,price:null,billing_cycle:null,auto_renewal:null,currency:'',expired_at:null,group:'',tags:'',hidden:false,
    traffic_limit:null,traffic_limit_type:'',created_at:null,updated_at:new Date(input.observedAt).toISOString(),
    bridge:bridgeMetadata(input,staleMs,transport,now),
  };
}
const unavailable={gpu:null,swap:null,swap_total:null,temp:null,net_total_up:null,net_total_down:null,process:null};
function connectionTotal(tcp:number|null|undefined,udp:number|null|undefined):number|null {return typeof tcp==='number'&&typeof udp==='number'?tcp+udp:null;}
export function komariStatus(input:UnifiedServer,id:string,staleMs:number,transport:Transport,now=Date.now()) {
  const bridge=bridgeMetadata(input,staleMs,transport,now);
  return {
    ...unavailable,client:id,time:new Date(input.observedAt).toISOString(),cpu:input.cpuPercent,ram:input.memoryUsedBytes,ram_total:input.memoryTotalBytes,
    load:input.loadAverages?.[0]??null,load5:input.loadAverages?.[1]??null,load15:input.loadAverages?.[2]??null,
    disk:input.diskUsedBytes,disk_total:input.diskTotalBytes,net_in:input.downloadBytesPerSecond,net_out:input.uploadBytesPerSecond,
    connections:connectionTotal(input.tcpConnections,input.udpConnections),connections_udp:input.udpConnections,connections_tcp:input.tcpConnections,
    online:bridge.stale?null:input.online,uptime:input.uptimeSeconds,ping:{},bridge,
  };
}
export function komariRecent(input:UnifiedServer,id:string,staleMs:number,transport:Transport,now=Date.now()) {
  return {
    uuid:id,cpu:{usage:input.cpuPercent},ram:{total:input.memoryTotalBytes,used:input.memoryUsedBytes},swap:{total:null,used:null},
    load:{load1:input.loadAverages?.[0]??null,load5:input.loadAverages?.[1]??null,load15:input.loadAverages?.[2]??null},
    disk:{total:input.diskTotalBytes,used:input.diskUsedBytes},
    network:{up:input.uploadBytesPerSecond,down:input.downloadBytesPerSecond,totalUp:null,totalDown:null},
    connections:{tcp:input.tcpConnections,udp:input.udpConnections},uptime:input.uptimeSeconds,process:null,
    updated_at:new Date(input.observedAt).toISOString(),bridge:bridgeMetadata(input,staleMs,transport,now),
  };
}
export function komariRecord(point:HistoryPoint,id:string) {
  return {
    ...unavailable,client:id,time:new Date(point.timestamp).toISOString(),cpu:point.cpuPercent??null,
    ram:point.memoryUsedBytes??null,ram_total:point.memoryTotalBytes??null,disk:point.diskUsedBytes??null,disk_total:point.diskTotalBytes??null,
    load:null,net_in:point.downloadBytesPerSecond??null,net_out:point.uploadBytesPerSecond??null,
    connections:connectionTotal(point.tcpConnections,point.udpConnections),connections_udp:point.udpConnections??null,connections_tcp:point.tcpConnections??null,
  };
}
/** Deterministic task identity follows the configured source key, never slot/order. */
export function pingTaskId(key:string):number {
  let hash=0x811c9dc5;
  for(const byte of new TextEncoder().encode(key)){hash^=byte;hash=Math.imul(hash,0x01000193);}
  return (hash>>>0)||1;
}
export function komariTargets(targets:Config['pingTargets']) {
  const ids=new Set<number>();
  return Object.values(targets).map(target=>{
    const id=pingTaskId(target.key);
    if(ids.has(id))throw new BridgeError('PING_ID_COLLISION',503,'Ping目标身份冲突，请检查配置。');
    ids.add(id);return {id,key:target.key,name:target.label};
  });
}
function avg(values:number[]):number|null {return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;}
export function komariPingRecords(series:HistoricalSeries,id:string,targets:Config['pingTargets'],taskId?:number) {
  const selected=komariTargets(targets).filter(target=>taskId===undefined||target.id===taskId);
  const map=new Map(selected.map(target=>[target.key,target]));
  const pings=series.pings.filter(point=>map.has(point.targetKey)&&(point.latencyMs!==null||point.lossPercent!==null));
  const records=pings.map(point=>({task_id:map.get(point.targetKey)!.id,client:id,time:new Date(point.timestamp).toISOString(),
    value:point.latencyMs??(point.state==='timeout'?-1:null),loss_percent:point.lossPercent,aggregation:'source_bucket'}));
  const tasks=selected.map(target=>{
    const points=pings.filter(point=>point.targetKey===target.key);
    const latency=points.flatMap(point=>point.latencyMs===null?[]:[point.latencyMs]);
    const losses=points.flatMap(point=>point.lossPercent===null?[]:[point.lossPercent]);
    return {id:target.id,name:target.name,type:'aggregate',interval:series.bucketSeconds,default_on:true,total:points.length,
      loss:avg(losses),min:latency.length?Math.min(...latency):null,max:latency.length?Math.max(...latency):null,avg:avg(latency),
      aggregation:'source_bucket',loss_aggregation:'mean_of_available_bucket_percentages'};
  });
  return {count:records.length,records,tasks,bridge:{aggregation:'source_bucket',bucket_seconds:series.bucketSeconds,packet_counts_available:false}};
}
