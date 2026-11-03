import test from 'node:test';
import assert from 'node:assert/strict';
import { queryMetrics,metricDefinitions } from '../src/protocols/komari/metrics.ts';
import { pingTaskId } from '../src/protocols/komari/adapter.ts';
import { KomariService } from '../src/protocols/komari/service.ts';
import { Upstream } from '../src/upstream/client.ts';
import { readConfig } from '../src/core/config.ts';

const now=Date.parse('2026-11-03T05:00:00Z');
test('official metric series preserve zero, missing capacity, units, timestamps and source gaps',()=>{
  const result=queryMetrics({bucketSeconds:300,points:[{timestamp:now-900000,cpuPercent:0,memoryUsedBytes:1048576},{timestamp:now,cpuPercent:12}],pings:[]},
    'stable',['cpu.usage','memory.used','memory.total','gpu.usage'],{},now-3600000,now);
  assert.equal(result.series.length,3);
  assert.deepEqual(result.series[0]?.points,[{time:new Date(now-900000).toISOString(),value:0},{time:new Date(now).toISOString(),value:12}]);
  assert.equal(result.series[1]?.unit,'bytes');assert.equal(result.series[1]?.points[0]?.value,1048576);
  assert.deepEqual(result.series[2]?.points.map(p=>p.value),[null,null]);
  assert.deepEqual(result.bridge.unsupported,['gpu.usage']);assert.equal(result.series[0]?.interval_seconds,300);
});
test('official Ping metrics keep keyed identity and do not invent packet loss for missing RTT',()=>{
  const result=queryMetrics({bucketSeconds:7200,points:[],pings:[{timestamp:now,targetKey:'target',latencyMs:null,lossPercent:25,state:'missing'}]},
    'stable',['ping.latency_ms','ping.loss_percent'],{ct:{key:'target',label:'same-name'}},now-7200000,now);
  assert.equal(result.series[0]?.tags?.task_id,String(pingTaskId('target')));
  assert.equal(result.series[0]?.points[0]?.value,null);assert.equal(result.series[1]?.points[0]?.value,25);
  assert.equal(result.series[1]?.unit,'%');assert.equal('count' in result.series[1]!.points[0]!,false);
});
test('official definitions advertise only supported histories and known retention',()=>{
  assert.ok(metricDefinitions(168).every(row=>row.retention_days===7));
  assert.ok(metricDefinitions(24).every(row=>row.retention_days===1));
  assert.equal(metricDefinitions(168).some(row=>row.name==='gpu.usage'),false);
});
test('official common node map respects privacy and unsupported date/aggregation requests fail',async()=>{
  const config=readConfig({MMWX_BASE_URL:'https://source.invalid',MMWX_PROBE_TOKEN:'secret',BRIDGE_BINDINGS:JSON.stringify([{id:'opaque',match:{name:'private'}}])});
  const upstream=new Upstream(config,async()=>Response.json({enabled:true,show_name:false,history_days:7,servers:[{name:'private',online:true,cpu_pct:0}]}),()=>now);
  const app=new KomariService(config,upstream,()=>now);
  const nodes=await app.method('common:getNodes') as Record<string,{name:string}>;
  assert.deepEqual(Object.keys(nodes),['opaque']);assert.equal(nodes.opaque?.name,'服务器');
  assert.equal((await app.method('public:getPublicSettings') as {theme:string}).theme,'default');
  for(const params of [{entity_id:'opaque',start:'2026-01-01',end:'2026-01-02'},{entity_id:'opaque',aggregation:'p95'}]) {
    await assert.rejects(()=>app.method('public:queryMetrics',params),/上游|聚合/);
  }
  await assert.rejects(()=>app.method('admin:queryMetrics',{}),/Method not found/);
});
