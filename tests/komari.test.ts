import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeServer } from '../src/core/model.ts';
import { komariNode,komariStatus,komariRecent,komariRecord,komariPingRecords,pingTaskId } from '../src/protocols/komari/adapter.ts';
import { normalizeSystemSeries,normalizePingSeries,Series } from '../src/upstream/series.ts';
import { readConfig } from '../src/core/config.ts';
import { Upstream } from '../src/upstream/client.ts';

const now=Date.parse('2026-11-02T12:00:00Z');
test('Komari node, flat status and recent report consume neutral byte units without CFSM JSON',()=>{
  const model=normalizeServer({name:'synthetic',online:true,cpu_pct:0,mem_used:2**30,mem_total:2**31,disk_used:0,disk_total:2**40,
    upload_speed:0,download_speed:1048576,cpu_threads:8,region_country:'US',uptime:300,tcp_connections:2,udp_connections:3},now);
  const node=komariNode(model,'stable',45_000,'websocket',now);
  assert.equal(node.uuid,'stable');assert.equal(node.mem_total,2**31);assert.equal(node.disk_total,2**40);assert.equal(node.region,'🇺🇸');
  assert.equal(node.price,null);assert.equal(node.traffic_limit,null);assert.equal(node.swap_total,null);
  const status=komariStatus(model,'stable',45_000,'websocket',now);
  assert.equal(status.cpu,0);assert.equal(status.ram,2**30);assert.equal(status.net_in,1048576);assert.equal(status.net_out,0);
  assert.equal(status.connections,5);assert.equal(status.online,true);assert.equal(status.time,new Date(now).toISOString());
  assert.equal(status.net_total_up,null);assert.equal('last_updated' in status,false);assert.equal('ram_used' in status,false);
  const recent=komariRecent(model,'stable',45_000,'websocket',now);
  assert.deepEqual(recent.cpu,{usage:0});assert.deepEqual(recent.ram,{used:2**30,total:2**31});assert.equal(recent.network.down,1048576);
});
test('Komari preserves source offline, unknown values and hidden names; stale is not invented offline',()=>{
  const model=normalizeServer({name:'private-person-name',online:false,last_seen:new Date(now-1000).toISOString(),cpu_pct:0},now,false);
  const node=komariNode(model,'stable',45_000,'poll',now);
  assert.equal(node.name,'服务器');assert.equal(JSON.stringify(node).includes('private-person-name'),false);
  assert.equal(node.hidden,false);
  const status=komariStatus(model,'stable',45_000,'poll',now);
  assert.equal(status.online,false);assert.equal(status.ram,null);assert.equal(status.cpu,0);assert.equal(status.net_in,null);
  const stale=komariStatus(model,'stable',45_000,'poll',now+45_001);
  assert.equal(stale.online,null);assert.equal(stale.bridge.stale,true);assert.equal(stale.bridge.observed_at,now);
  assert.equal(komariStatus(normalizeServer({},now),'stable',45_000,'poll',now).online,null);
});
test('neutral history keeps bytes and exact timestamps; Komari uses per-point totals without backfill',()=>{
  const rows=normalizeSystemSeries({success:true,bucket_sec:300,series:{cpu_pct:[{t:now/1000,value:0}],mem_used:[{t:now/1000,value:2**30}],mem_total:[{t:now/1000-300,value:2**31}]}},now-600_000,now);
  assert.equal(rows[1]?.memoryUsedBytes,2**30);
  const first=komariRecord(rows[0]!,'stable'),second=komariRecord(rows[1]!,'stable');
  assert.equal(first.ram_total,2**31);assert.equal(first.ram,null);assert.equal(second.ram_total,null);assert.equal(second.ram,2**30);
  assert.equal(second.cpu,0);assert.equal(second.net_total_up,null);assert.equal('traffic_up' in second,false);
});
test('Komari Ping IDs follow target keys; source bucket zero, missing and full loss stay distinct',()=>{
  const pings=normalizePingSeries({success:true,bucket_sec:300,generated_at:now/1000,all_series:[{key:'target-a',buckets:[{ms:-1,loss:-1},{ms:-1,loss:100},{ms:0,loss:0},{ms:12,loss:25}]}]},['target-a'],now-3600_000,now);
  const targets={ct:{key:'target-a',label:'Explicit target'}};
  const result=komariPingRecords({points:[],pings,bucketSeconds:300},'stable',targets);
  assert.equal(result.records.length,3);assert.deepEqual(result.records.map(point=>point.value),[-1,0,12]);
  assert.deepEqual(result.records.map(point=>point.loss_percent),[100,0,25]);assert.equal(result.tasks[0]?.loss,125/3);
  assert.equal(result.tasks[0]?.total,3);assert.equal(result.bridge.packet_counts_available,false);
  const remapped=komariPingRecords({points:[],pings,bucketSeconds:300},'stable',{node_4:{key:'target-a',label:'Renamed'}});
  assert.equal(remapped.tasks[0]?.id,result.tasks[0]?.id);assert.equal(pingTaskId('target-a'),result.tasks[0]?.id);
});
test('neutral history supports a real Komari four-hour request using six-hour source buckets and preserves ID guard',async()=>{
  const config=readConfig({MMWX_BASE_URL:'https://synthetic.invalid',BRIDGE_BINDINGS:JSON.stringify([{id:'a',match:{name:'A'}}])});
  const requests:URL[]=[];
  const upstream=new Upstream(config,async input=>{
    const url=new URL(String(input));requests.push(url);
    return Response.json(url.pathname.endsWith('probe-servers')?{enabled:true,history_days:7,servers:[{name:'A'}]}:{success:true,bucket_sec:600,series:{cpu_pct:[{t:now/1000,value:0}]}});
  },()=>now);
  const result=await new Series(upstream,config,()=>now).get('a',4);
  assert.equal(result.points[0]?.cpuPercent,0);assert.equal(result.bucketSeconds,600);
  assert.equal(requests.find(url=>url.pathname.endsWith('probe-series'))?.searchParams.get('range'),'6h');
});
