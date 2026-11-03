import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from './helpers/config.ts';
import { Upstream,type Fetcher } from '../src/upstream/client.ts';
import { KomariService,type RpcResponse } from '../src/protocols/komari/service.ts';
const now=Date.parse('2026-11-02T12:00:00Z');
const snapshot={enabled:true,show_name:false,history_days:7,servers:[{name:'synthetic-private-name',online:true,cpu_pct:0,mem_used:0,mem_total:1073741824,upload_speed:0}]};
function service(fetcher:Fetcher=async()=>Response.json(snapshot)){
  const config=readConfig({MMWX_BASE_URL:'https://source.invalid',MMWX_PROBE_TOKEN:'SENSITIVE',BRIDGE_BINDINGS:JSON.stringify([{id:'opaque',match:{name:'synthetic-private-name'}}])});
  return new KomariService(config,new Upstream(config,fetcher,()=>now),()=>now);
}
const rpc=(method:string,params:unknown={},id=1)=>({jsonrpc:'2.0',id,method,params});
test('actual Adhesive Note RPC2 methods return genuine Komari node/status/settings shapes without secrets',async()=>{
  const app=service();
  const nodes=await app.rpc(rpc('public:getNodesInformation')) as RpcResponse;
  assert.ok(Array.isArray(nodes.result));const node=(nodes.result as Record<string,unknown>[])[0]!;
  assert.equal(node.uuid,'opaque');assert.equal(node.mem_total,1073741824);assert.equal(node.name,'服务器');
  const latest=await app.rpc(rpc('common:getNodesLatestStatus')) as RpcResponse;
  const status=(latest.result as Record<string,Record<string,unknown>>).opaque!;
  assert.equal(status.cpu,0);assert.equal(status.ram,0);assert.equal(status.online,true);assert.equal(status.net_in,null);
  const settings=await app.rpc(rpc('public:getPublicSettings')) as RpcResponse;
  assert.equal((settings.result as Record<string,unknown>).record_preserve_time,168);
  for(const secret of ['SENSITIVE','source.invalid','synthetic-private-name'])assert.equal(JSON.stringify([nodes,latest,settings]).includes(secret),false);
});
test('RPC2 method permissions, malformed requests, notifications and batches follow request-response semantics',async()=>{
  const app=service();
  for(const method of ['admin:exec','agent.report','public:unknown'])assert.equal((await app.rpc(rpc(method)) as RpcResponse).error?.code,-32601);
  assert.equal((await app.rpc(null) as RpcResponse).error?.code,-32600);
  assert.equal((await app.rpc(rpc('common:getNodesLatestStatus',[])) as RpcResponse).error?.code,-32602);
  assert.equal(await app.rpc({jsonrpc:'2.0',method:'rpc.ping'}),null);
  const batch=await app.rpc([{jsonrpc:'2.0',method:'rpc.ping'},rpc('public:getVersion',{},7)]) as RpcResponse[];
  assert.equal(batch.length,1);assert.equal(batch[0]?.id,7);assert.equal(batch[0]?.jsonrpc,'2.0');
  assert.equal((await app.rpc([]) as RpcResponse).error?.code,-32600);
});
test('RPC and REST current/recent never invent historical samples or conflate single-node and map forms',async()=>{
  const app=service();
  const recent=await app.method('public:getClientRecentRecords',{uuid:'opaque'}) as Record<string,unknown>[];
  assert.equal(recent.length,1);assert.equal(recent[0]?.updated_at,new Date(now).toISOString());
  const again=await app.method('public:getClientRecentRecords',{uuid:'opaque'}) as unknown[];assert.equal(again.length,1);
  const single=await app.method('common:getNodesLatestStatus',{uuid:'opaque'}) as Record<string,unknown>;
  assert.equal(single.client,'opaque');assert.equal('opaque' in single,false);
  const response=await app.handle(new Request('http://localhost/api/nodes'));assert.equal(response?.status,200);
  const body=await response!.json();assert.equal(body.status,'success');assert.ok(Array.isArray(body.data));
  const missing=await app.rpc(rpc('public:getClientRecentRecords',{uuid:'other'})) as RpcResponse;
  assert.equal((missing.error?.data as Record<string,unknown>).status,404);
});
test('Komari history uses source facts directly and unsupported metric requests fail explicitly',async()=>{
  const app=service(async input=>{
    const url=new URL(String(input));
    return Response.json(url.pathname.endsWith('probe-servers')?snapshot:{success:true,bucket_sec:600,series:{cpu_pct:[{t:now/1000,value:0}],mem_used:[{t:now/1000,value:1073741824}]}});
  });
  const result=await app.rpc(rpc('public:getRecordsByUUID',{uuid:'opaque',hours:'4',load_type:'all'})) as RpcResponse;
  const records=(result.result as {records:Record<string,unknown>[]}).records;
  assert.equal(records[0]?.ram,1073741824);assert.equal(records[0]?.ram_total,null);assert.equal(records[0]?.time,new Date(now).toISOString());
  assert.equal(records[0]?.cpu,0);assert.equal(records[0]?.swap,null);
  const unsupported=await app.rpc(rpc('public:getRecordsByUUID',{uuid:'opaque',hours:'4',load_type:'gpu'})) as RpcResponse;
  assert.equal((unsupported.error?.data as Record<string,unknown>).status,501);
});
test('HTTP RPC2 protects display access, rejects foreign Origin, and reports parse errors without executing methods',async()=>{
  const app=service();
  assert.equal((await app.handle(new Request('https://public.invalid/api/rpc2',{method:'POST',body:JSON.stringify(rpc('public:getVersion'))})))?.status,403);
  assert.equal((await app.handle(new Request('http://localhost/api/rpc2',{method:'POST',headers:{Origin:'https://other.invalid'},body:'{}'})))?.status,403);
  const bad=await app.handle(new Request('http://localhost/api/rpc2',{method:'POST',body:'{bad'}));assert.equal((await bad!.json()).error.code,-32700);
  const notification=await app.handle(new Request('http://localhost/api/rpc2',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',method:'rpc.ping'})}));assert.equal(notification?.status,204);
  assert.equal((await app.handle(new Request('http://localhost/api/admin/exec')))?.status,404);
});
test('source outage and identity ambiguity remain RPC errors rather than fake offline data',async()=>{
  for(const [fetcher,code]of [
    [async()=>{throw new Error('SENSITIVE source.invalid');},'UPSTREAM_UNAVAILABLE'],
    [async()=>Response.json({...snapshot,servers:[...snapshot.servers,...snapshot.servers]}),'IDENTITY_CONFLICT'],
    [async()=>Response.json({enabled:false}),'PROBE_DISABLED'],
  ] as [Fetcher,string][]) {
    const result=await service(fetcher).rpc(rpc('common:getNodesLatestStatus')) as RpcResponse;
    assert.equal('result' in result,false);assert.equal((result.error?.data as Record<string,unknown>).bridge_code,code);
    assert.equal(JSON.stringify(result).includes('SENSITIVE'),false);assert.equal(JSON.stringify(result).includes('source.invalid'),false);
  }
});

test('native common methods retain request-scoped settings and single-node response forms',async()=>{
  const app=service(),context={theme:'UpstreamTheme',settings:{refreshSeconds:3}};
  const settings=await app.rpc(rpc('common:getPublicInfo'),context) as RpcResponse;
  assert.equal((settings.result as {theme:string}).theme,'UpstreamTheme');
  assert.deepEqual((settings.result as {theme_settings:unknown}).theme_settings,context.settings);
  assert.equal((await app.method('public:getPublicSettings') as {theme:string}).theme,'default');
  const single=await app.method('common:getNodes',{uuid:'opaque'}) as Record<string,unknown>;
  assert.equal(single.uuid,'opaque');assert.equal(single.cpu_cores,null);assert.equal('opaque' in single,false);
  await assert.rejects(app.method('common:getNodes',{uuid:'absent'}),{code:-32602});
  const recent=await app.method('common:getNodeRecentStatus',{uuid:'opaque'}) as {count:number;records:Record<string,unknown>[]};
  assert.equal(recent.count,1);assert.equal(recent.records[0]?.client,'opaque');assert.equal(recent.records[0]?.cpu,0);
  assert.equal(recent.records[0]?.net_in,null);assert.equal(recent.records[0]?.time,new Date(now).toISOString());
  assert.equal((await app.method('common:getMe') as {logged_in:boolean}).logged_in,false);
  assert.deepEqual(await app.method('common:getBackendVersion'),await app.method('public:getVersion'));
});

test('common load records use native grouped form; supported-but-absent metrics remain null',async()=>{
  const app=service(async input=>Response.json(String(input).includes('probe-servers')?snapshot:{success:true,bucket_sec:300,series:{cpu_pct:[{t:now/1000,value:0}]}}));
  const result=await app.method('common:getRecords',{uuid:'opaque',type:'load',hours:1}) as {count:number;records:Record<string,Record<string,unknown>[]>};
  assert.equal(result.count,1);assert.deepEqual(Object.keys(result.records),['opaque']);assert.equal(result.records.opaque?.[0]?.cpu,0);
  assert.equal(result.records.opaque?.[0]?.swap,null);
  const absent=await app.method('public:getRecordsByUUID',{uuid:'opaque',hours:1,load_type:'swap'}) as {records:Record<string,unknown>[]};
  assert.equal(absent.records[0]?.swap,null);
  await assert.rejects(app.method('common:getRecords',{uuid:'not-public',type:'load'}),{code:-32602});
  await assert.rejects(app.method('common:getRecords',{type:'exec'}),{code:-32602});
});

test('common Ping records without uuid cover only bound public nodes and preserve source buckets',async()=>{
  const config=readConfig({MMWX_BASE_URL:'https://source.invalid',BRIDGE_BINDINGS:JSON.stringify([{id:'a',match:{name:'A'}},{id:'b',match:{name:'B'}}]),BRIDGE_PING_TARGETS:JSON.stringify({ct:{key:'t',label:'Target'}})});
  const source={enabled:true,show_name:false,history_days:7,servers:[{name:'A',online:true},{name:'B',online:false}]};
  const upstream=new Upstream(config,async input=>{
    const url=new URL(String(input));
    return Response.json(url.pathname.endsWith('probe-servers')?source:url.searchParams.get('metric')==='system'?{success:true,bucket_sec:300,series:{cpu_pct:[{t:now/1000,value:0}]}}:
      {success:true,bucket_sec:300,generated_at:now/1000,all_series:[{key:'t',buckets:[{ms:0,loss:0},{ms:-1,loss:100}]}]});
  },()=>now);
  const app=new KomariService(config,upstream,()=>now);
  const result=await app.method('common:getRecords',{type:'ping',hours:1}) as {count:number;records:{client:string;value:number}[];tasks:{id:number}[]};
  assert.equal(result.count,4);assert.deepEqual([...new Set(result.records.map(row=>row.client))].sort(),['a','b']);
  assert.deepEqual(result.records.map(row=>row.value).sort(),[-1,-1,0,0]);assert.equal(result.tasks.length,1);
  const byTask=await app.method('public:getPingRecords',{task_id:result.tasks[0]!.id,hours:1}) as {count:number};
  assert.equal(byTask.count,4);
  const summary=await app.method('public:getPingMetricStats',{entity_id:'a',hours:1}) as {stats:Record<string,unknown>[]};
  assert.equal(summary.stats.length,1);assert.equal(summary.stats[0]?.loss,50);assert.equal(summary.stats[0]?.avg,0);
  assert.equal(summary.stats[0]?.total,null);assert.equal(summary.stats[0]?.valid,null);assert.equal(Object.hasOwn(summary.stats[0]!, 'p99'),false);
  assert.equal(Object.hasOwn(summary.stats[0]!, 'latest'),false);assert.equal(summary.stats[0]?.sample_buckets,2);

});

test('history concurrency is shared across RPC batches and failed all-node reads stop scheduling',async()=>{
  const names=Array.from({length:12},(_,index)=>`node-${index}`);
  const config=readConfig({MMWX_BASE_URL:'https://source.invalid',BRIDGE_BINDINGS:JSON.stringify(names.map(id=>({id,match:{name:id}})))});
  const source={enabled:true,show_name:true,history_days:7,servers:names.map(name=>({name,online:true}))};
  const app=new KomariService(config,new Upstream(config,async()=>Response.json(source),()=>now),()=>now);
  let active=0,peak=0;
  app.series.get=async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,2));active--;return {points:[],pings:[],bucketSeconds:300};};
  const replies=await app.rpc(Array.from({length:8},(_,index)=>rpc('common:getRecords',{hours:1+index},index))) as RpcResponse[];
  assert.equal(replies.length,8);assert.ok(replies.every(reply=>!reply.error));assert.equal(peak,4);assert.equal(active,0);
  const started:string[]=[];
  app.series.get=async(id)=>{started.push(id);if(id==='node-0')throw new Error('synthetic outage');active++;await new Promise(resolve=>setTimeout(resolve,2));active--;return {points:[],pings:[],bucketSeconds:300};};
  await assert.rejects(app.method('common:getRecords',{hours:1}),/synthetic outage/);
  assert.deepEqual(started,['node-0','node-1','node-2','node-3']);assert.equal(active,0);
  // A failure releases the shared permits for subsequent requests.
  app.series.get=async()=>({points:[],pings:[],bucketSeconds:300});
  assert.ok(await app.method('common:getRecords',{uuid:'node-1',hours:1}));
});

test('native absolute-time aliases fail explicitly instead of returning recent history',async()=>{
  const app=service();let reads=0;
  app.series.get=async()=>{reads++;return {points:[],pings:[],bucketSeconds:300};};
  for(const method of ['common:getRecords','public:queryMetrics','public:getPingMetricStats']){
    for(const key of ['start','end','start_time','end_time']){
      await assert.rejects(app.method(method,{entity_id:'opaque',metric_keys:['cpu.usage_percent'],[key]:'2020-01-01T00:00:00Z'}),{code:'UNSUPPORTED_RANGE'});
    }
  }
  assert.equal(reads,0);
});

test('Ping statistics honor native task_id and task_ids filters without conflating task data',async()=>{
  const config=readConfig({MMWX_BASE_URL:'https://source.invalid',BRIDGE_BINDINGS:JSON.stringify([{id:'a',match:{name:'A'}}]),BRIDGE_PING_TARGETS:JSON.stringify({ct:{key:'one',label:'One'},cu:{key:'two',label:'Two'}})});
  const app=new KomariService(config,undefined,()=>now);
  app.series.get=async()=>({points:[],bucketSeconds:300,pings:[
    {timestamp:now,targetKey:'one',latencyMs:10,lossPercent:0,state:'measurement'},
    {timestamp:now,targetKey:'two',latencyMs:20,lossPercent:50,state:'measurement'},
  ]});
  const all=await app.method('public:getPingMetricStats',{entity_id:'a'}) as {stats:{task_id:string;avg:number}[]};
  assert.equal(all.stats.length,2);
  const first=all.stats[0]!,second=all.stats[1]!;
  for(const selection of [{task_id:first.task_id},{task_ids:[Number(first.task_id)]}]){
    const selected=await app.method('public:getPingMetricStats',{entity_id:'a',...selection}) as typeof all;
    assert.deepEqual(selected.stats,[first]);
  }
  const both=await app.method('public:getPingMetricStats',{entity_id:'a',task_id:first.task_id,task_ids:[second.task_id]}) as typeof all;
  assert.deepEqual(both.stats,all.stats);
  const missing=await app.method('public:getPingMetricStats',{entity_id:'a',task_ids:['999999']}) as typeof all;
  assert.deepEqual(missing.stats,[]);
  await assert.rejects(app.method('public:getPingMetricStats',{entity_id:'a',task_ids:'bad'}),{code:-32602});
});


test('Ping statistics omit unknown optional metrics and do not create statistics for absent measurements',async()=>{
  const config=readConfig({MMWX_BASE_URL:'https://source.invalid',BRIDGE_PING_TARGETS:JSON.stringify({ct:{key:'zero',label:'Zero'},cu:{key:'timeout',label:'Timeout'},cm:{key:'missing',label:'Missing'},bd:{key:'unknown-loss',label:'Unknown loss'}})});
  const app=new KomariService(config,undefined,()=>now);
  app.series.get=async()=>({points:[],bucketSeconds:300,pings:[
    {timestamp:now,targetKey:'zero',latencyMs:0,lossPercent:0,state:'measurement'},
    {timestamp:now,targetKey:'timeout',latencyMs:null,lossPercent:100,state:'timeout'},
    {timestamp:now,targetKey:'missing',latencyMs:null,lossPercent:null,state:'missing'},
    {timestamp:now,targetKey:'unknown-loss',latencyMs:8,lossPercent:null,state:'measurement'},
  ]});
  const result=await app.method('public:getPingMetricStats',{entity_id:'a'}) as {stats:Record<string,unknown>[]};
  assert.equal(result.stats.length,2);
  const zero=result.stats.find(row=>row.name==='Zero')!,timeout=result.stats.find(row=>row.name==='Timeout')!;
  assert.equal(zero.avg,0);assert.equal(zero.min,0);assert.equal(zero.max,0);assert.equal(zero.latest,0);assert.equal(zero.loss,0);
  assert.equal(timeout.loss,100);
  for(const row of result.stats)for(const field of ['p50','p99','stddev','p99_p50_ratio'])assert.equal(Object.hasOwn(row,field),false);
  for(const field of ['avg','min','max','latest'])assert.equal(Object.hasOwn(timeout,field),false);
  // A consumer can use presence checks before formatting every optional numeric value.
  for(const row of result.stats)for(const field of ['avg','min','max','latest','p50','p99','stddev','p99_p50_ratio'])if(row[field]!==undefined)assert.doesNotThrow(()=>(row[field] as number).toFixed(2));
  app.series.get=async()=>({points:[],pings:[],bucketSeconds:300});
  assert.deepEqual((await app.method('public:getPingMetricStats',{entity_id:'a'}) as typeof result).stats,[]);
});
