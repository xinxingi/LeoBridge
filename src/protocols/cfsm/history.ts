import type { Config } from '../../core/config.ts';
import { BridgeError } from '../../core/errors.ts';
import type { Snapshot } from '../../core/model.ts';
import type { Upstream } from '../../upstream/client.ts';
import { Series,normalizeSystemSeries,normalizePingSeries,sourceCounterData,type HistoryPoint,type PingSample } from '../../upstream/series.ts';
export type HistoryRow=Record<string,number|null|boolean|{sourceCounters:ReturnType<typeof sourceCounterData>}>&{timestamp:number};
const fields:Record<string,[string,number]>={cpuPercent:['cpu',1],memoryUsedBytes:['ram_used',1024**2],memoryTotalBytes:['ram_total',1024**2],diskUsedBytes:['disk_used',1024**2],diskTotalBytes:['disk_total',1024**2],downloadBytesPerSecond:['net_in_speed',1],uploadBytesPerSecond:['net_out_speed',1],tcpConnections:['tcp_conn',1],udpConnections:['udp_conn',1]};
function systemProjection(points:HistoryPoint[]):HistoryRow[] {
  return points.map(point=>{
    const row:HistoryRow={timestamp:point.timestamp};
    for(const[field,value]of Object.entries(point)){const mapping=fields[field];if(mapping)row[mapping[0]]=value===null?null:value/mapping[1];}
    if('cumulativeUploadBytes' in point || 'cumulativeDownloadBytes' in point)row.bridge={sourceCounters:sourceCounterData(point)};
    return row;
  });
}
function pingProjection(points:PingSample[],targets:Config['pingTargets']):HistoryRow[] {
  const rows=new Map<number,HistoryRow>();
  for(const point of points){
    const slot=Object.entries(targets).find(([,target])=>target.key===point.targetKey)?.[0];if(!slot)continue;
    const row=rows.get(point.timestamp)||{timestamp:point.timestamp};
    row[`ping_${slot}`]=point.latencyMs??(point.state==='timeout'?null:false);row[`loss_${slot}`]=point.lossPercent??false;
    rows.set(point.timestamp,row);
  }
  return [...rows.values()].sort((a,b)=>a.timestamp-b.timestamp);
}
export function systemRows(raw:unknown,start:number,end:number):HistoryRow[]{return systemProjection(normalizeSystemSeries(raw,start,end));}
export function pingRows(raw:unknown,targets:Config['pingTargets'],start:number,end:number):HistoryRow[]{return pingProjection(normalizePingSeries(raw,Object.values(targets).map(target=>target.key),start,end),targets);}
/** CFSM projection over the neutral history access service. */
export class History {
  private series:Series;
  private targets:Config['pingTargets'];
  private projected=new WeakMap<object,HistoryRow[]>();
  constructor(upstream:Upstream,config:Config,now=Date.now){this.series=new Series(upstream,config,now);this.targets=config.pingTargets;}
  hours(snapshot:Snapshot){return this.series.maxHours(snapshot)>=168?[0.167,0.5,1,6,12,24,48,96,168]:[0.167,0.5,1,6,12,24];}
  async get(id:string,hours:number):Promise<HistoryRow[]>{
    if(![0.167,0.5,1,6,12,24,48,96,168].includes(hours))throw new BridgeError('HISTORY_RANGE',400,'不支持的历史范围。');
    const value=await this.series.get(id,hours),cached=this.projected.get(value);if(cached)return cached;
    const merged=new Map<number,HistoryRow>();
    for(const row of [...systemProjection(value.points),...pingProjection(value.pings,this.targets)])merged.set(row.timestamp,{...merged.get(row.timestamp),...row});
    const rows=[...merged.values()].sort((a,b)=>a.timestamp-b.timestamp);this.projected.set(value,rows);return rows;
  }
}
