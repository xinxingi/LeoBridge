import type { HistoricalSeries, HistoryPoint } from '../../upstream/series.ts';
import type { Config } from '../../core/config.ts';
import { komariTargets } from './adapter.ts';

/** Official komari-web metric names. Values retain source units and sample times. */
export const metricFields = {
  'cpu.usage': ['cpuPercent', '%'],
  'memory.used': ['memoryUsedBytes', 'bytes'],
  'memory.total': ['memoryTotalBytes', 'bytes'],
  'disk.used': ['diskUsedBytes', 'bytes'],
  'disk.total': ['diskTotalBytes', 'bytes'],
  'net.in.rate': ['downloadBytesPerSecond', 'bytes/s'],
  'net.out.rate': ['uploadBytesPerSecond', 'bytes/s'],
  'connections.tcp': ['tcpConnections', 'count'],
  'connections.udp': ['udpConnections', 'count'],
} as const satisfies Record<string, readonly [keyof HistoryPoint, string]>;

export function metricDefinitions(hours: number) {
  return [...Object.entries(metricFields).map(([name, [,unit]]) => ({name, unit})),
    {name:'ping.latency_ms',unit:'ms'}, {name:'ping.loss',unit:'ratio'}, {name:'ping.loss_percent',unit:'%'}]
    .map(item => ({...item,type:'gauge',retention_days:hours/24}));
}

export function queryMetrics(series: HistoricalSeries, id: string, keys: string[], targets: Config['pingTargets'], start: number, end: number) {
  type Point = {time:string;value:number|null};
  type Output = {metric_key:string;entity_id:string;unit:string;interval_seconds:number;count:number;points:Point[];tags?:Record<string,string>};
  const output:Output[]=[];
  for (const key of keys) {
    if (Object.hasOwn(metricFields,key)) {
      const [field,unit]=metricFields[key as keyof typeof metricFields];
      const points=series.points.filter(point=>point.timestamp>=start&&point.timestamp<=end)
        .map(point=>({time:new Date(point.timestamp).toISOString(),value:point[field]??null}));
      output.push({metric_key:key,entity_id:id,unit,interval_seconds:series.bucketSeconds,count:points.length,points});
    } else if (key==='ping.latency_ms'||key==='ping.loss_percent'||key==='ping.loss') {
      for (const target of komariTargets(targets)) {
        const points=series.pings.filter(point=>point.targetKey===target.key&&point.timestamp>=start&&point.timestamp<=end)
          .map(point=>({time:new Date(point.timestamp).toISOString(),value:key==='ping.latency_ms'?point.latencyMs:key==='ping.loss'?(point.lossPercent===null?null:point.lossPercent/100):point.lossPercent}));
        output.push({metric_key:key,entity_id:id,unit:key==='ping.latency_ms'?'ms':key==='ping.loss'?'ratio':'%',tags:{task_id:String(target.id)},
          interval_seconds:series.bucketSeconds,count:points.length,points});
      }
    }
  }
  return {start:new Date(start).toISOString(),end:new Date(end).toISOString(),series:output,count:output.length,
    bridge:{aggregation:'source_bucket',unsupported:keys.filter(key=>!Object.hasOwn(metricFields,key)&&key!=='ping.latency_ms'&&key!=='ping.loss_percent'&&key!=='ping.loss'),
      note:'原始源桶；不重采样、不补点。丢包率为源桶百分比，不推算发包数或分位数。'}};
}
