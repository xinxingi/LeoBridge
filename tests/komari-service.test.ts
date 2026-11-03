import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from '../src/core/config.ts';
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
