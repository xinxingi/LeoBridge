import test from 'node:test';
import assert from 'node:assert/strict';
import { komariRealtime } from '../src/protocols/komari/realtime.ts';
import { KomariService } from '../src/protocols/komari/service.ts';
import { readConfig } from './helpers/config.ts';
import { Upstream,type Fetcher } from '../src/upstream/client.ts';
import type { Socket } from '../src/protocols/cfsm/realtime.ts';
class MockSocket implements Socket {
  sent:Record<string,unknown>[]=[];closed:{code?:number;reason?:string}[]=[];
  message?:(data:string)=>void;closing?:()=>void;error?:()=>void;
  send(data:string){this.sent.push(JSON.parse(data));}
  close(code?:number,reason?:string){this.closed.push({code,reason});this.closing?.();}
  onMessage(callback:(data:string)=>void){this.message=callback;}
  onClose(callback:()=>void){this.closing=callback;}
  onError(callback:()=>void){this.error=callback;}
  receive(data:unknown){this.message?.(JSON.stringify(data));}
}
const raw={enabled:true,show_name:true,servers:[{name:'A',online:true,cpu_pct:0},{name:'B',online:false}]};
function service(fetcher:Fetcher=async()=>Response.json(raw)) {
  const config=readConfig({MMWX_BASE_URL:'https://synthetic.invalid',MMWX_PROBE_TOKEN:'PRIVATE',BRIDGE_BINDINGS:JSON.stringify([{id:'a',match:{name:'A'}},{id:'b',match:{name:'B'}}])});
  return new KomariService(config,new Upstream(config,fetcher));
}
const settle=()=>new Promise<void>(resolve=>setImmediate(resolve));
const request=(id:number,method='common:getNodesLatestStatus')=>({jsonrpc:'2.0',id,method,params:{}});
test('Komari RPC socket answers request IDs with flat status and never emits CFSM messages',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:100_000});
  const client=new MockSocket(),source=new MockSocket(),app=service();
  const session=komariRealtime(app,client,async()=>source);t.after(()=>session.close());await settle();
  source.receive(raw);client.receive(request(10));await settle();
  assert.equal(client.sent.length,1);assert.equal(client.sent[0]?.id,10);assert.equal(client.sent[0]?.jsonrpc,'2.0');
  const latest=client.sent[0]?.result as Record<string,Record<string,unknown>>;
  assert.equal(latest.a?.cpu,0);assert.equal(latest.a?.online,true);assert.equal(latest.b?.online,false);
  assert.equal((latest.a?.bridge as Record<string,unknown>).transport,'websocket');
  client.receive({jsonrpc:'2.0',method:'rpc.ping'});await settle();assert.equal(client.sent.length,1);
  client.receive(request(11,'admin:exec'));await settle();assert.equal((client.sent.at(-1)?.error as Record<string,unknown>).code,-32601);
  assert.equal(client.sent.some(message=>'type' in message),false);assert.equal(JSON.stringify(client.sent).includes('PRIVATE'),false);
});
test('Komari source disconnection falls back through genuine HTTP reads and resumes the native stream after reconnect',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:100_000});
  let reads=0,connects=0;
  const first=new MockSocket(),second=new MockSocket(),client=new MockSocket();
  const app=service(async()=>{reads++;return Response.json(raw);});
  const session=komariRealtime(app,client,async()=>++connects===1?first:second);t.after(()=>session.close());await settle();
  first.receive(raw);client.receive(request(1));await settle();assert.equal(reads,0);
  first.close();client.receive(request(2));await settle();assert.equal(reads,0,'a transport loss retains the recent native observation until cache expiry');
  t.mock.timers.tick(app.config.cacheMs+1);await settle();
  client.receive(request(20));await settle();assert.equal(reads,1);
  const poll=client.sent.at(-1)?.result as Record<string,{online:boolean;bridge:{transport:string}}>;assert.equal(poll.a?.online,true);assert.equal(poll.a?.bridge.transport,'poll');
  assert.equal(connects,2);
  second.receive(raw);client.receive(request(3));await settle();
  const resumed=client.sent.at(-1)?.result as Record<string,{bridge:{transport:string}}>;
  assert.equal(resumed.a?.bridge.transport,'websocket');assert.equal(reads,1);
  session.close();t.mock.timers.tick(100_000);await settle();assert.equal(connects,2);assert.ok(second.closed.length>0);
});
test('malformed source data plus failed fallback yields a sanitized RPC error, never offline fabrication',async t=>{
  const client=new MockSocket(),source=new MockSocket();
  const app=service(async()=>{throw new Error('PRIVATE synthetic.invalid');});
  const session=komariRealtime(app,client,async()=>source);t.after(()=>session.close());await settle();
  source.message?.('{PRIVATE bad JSON');client.receive(request(1));await settle();
  assert.equal(client.sent.length,1);assert.equal('result' in client.sent[0]!,false);
  const error=client.sent[0]?.error as {data:{bridge_code:string}};
  assert.equal(error.data.bridge_code,'UPSTREAM_UNAVAILABLE');assert.equal(JSON.stringify(client.sent).includes('PRIVATE'),false);
  assert.ok(source.closed.length>0);
});
test('closing Komari viewer cancels retries, late upstream handshake and pending RPC responses',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:100_000});
  let connect!: (socket:Socket)=>void,complete!: (response:Response)=>void;
  const app=service(()=>new Promise(resolve=>{complete=resolve;}));
  const client=new MockSocket(),source=new MockSocket();
  const session=komariRealtime(app,client,()=>new Promise(resolve=>{connect=resolve;}));
  client.receive(request(1));await settle();
  session.close();complete(Response.json(raw));connect(source);await settle();
  assert.equal(client.sent.length,0);assert.deepEqual(source.closed,[{code:1000,reason:'cancelled'}]);
  t.mock.timers.tick(1_000_000);await settle();assert.equal(client.sent.length,0);
});
test('Komari source identity ambiguity fails closed and legacy get uses nested reports instead of RPC or CFSM envelopes',async t=>{
  const source=new MockSocket(),client=new MockSocket();
  const app=service(async()=>Response.json({...raw,servers:[raw.servers[0],raw.servers[0]]}));
  const session=komariRealtime(app,client,async()=>source);t.after(()=>session.close());await settle();
  source.receive({...raw,servers:[raw.servers[0],raw.servers[0]]});client.receive(request(1));await settle();
  assert.equal((client.sent[0]?.error as {data:{bridge_code:string}}).data.bridge_code,'IDENTITY_CONFLICT');
  const legacy=new MockSocket();const legacySession=komariRealtime(service(),legacy,async()=>new MockSocket(),'/api/clients');t.after(()=>legacySession.close());
  legacy.message?.('get b');await settle();
  const response=legacy.sent[0] as {status:string;data:{online:string[];data:Record<string,{cpu:{usage:number|null}}>}};
  assert.equal(response.status,'success');assert.deepEqual(response.data.online,[]);assert.deepEqual(Object.keys(response.data.data),['b']);
  assert.equal(response.data.data.b?.cpu.usage,null);
});
test('idle source reconnects after stale threshold and excessive pending RPC closes the viewer',async t=>{
  t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:100_000});
  const source=new MockSocket(),client=new MockSocket();let reads=0,complete!:(response:Response)=>void;
  const app=service(()=>{reads++;return new Promise(resolve=>{complete=resolve;});});
  const session=komariRealtime(app,client,async()=>source);t.after(()=>session.close());await settle();
  t.mock.timers.tick(50_001);assert.ok(source.closed.length>0);
  for(let id=0;id<9;id++)client.receive(request(id));
  assert.equal(client.closed.at(-1)?.code,1008);assert.equal(reads,1);
  complete(Response.json(raw));await settle();assert.equal(client.sent.length,0);
});
