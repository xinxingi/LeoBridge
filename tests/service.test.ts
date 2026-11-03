import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig, authorize } from '../src/core/config.ts';
import { Bridge } from '../src/protocols/cfsm/service.ts';
import { Upstream } from '../src/upstream/client.ts';
import { applyPing } from '../src/protocols/cfsm/ping.ts';
import { selectTheme } from '../src/themes/registry.ts';
const env={MMWX_BASE_URL:'https://source.invalid',MMWX_PROBE_TOKEN:'SENSITIVE-TOKEN',BRIDGE_BINDINGS:JSON.stringify([{id:'stable',match:{name:'synthetic'}}])};
const raw={enabled:true,show_name:false,history_days:7,servers:[{name:'synthetic',online:false,last_seen:new Date().toISOString(),cpu_pct:0,mem_used:0,mem_total:1048576,download_speed:0,upload_speed:0,private_key:'PRIVATE'}]};
function bridge(payload:unknown=raw){const config=readConfig(env);return new Bridge(config,new Upstream(config,async()=>Response.json(payload)));}
const req=(path:string)=>new Request(`http://localhost${path}`);
test('CFSM list/detail/config meet actual frontend shapes and preserve offline/zero/missing distinctions',async()=>{
  const app=bridge();const list=await (await app.api(req('/api/servers')))!.json();
  assert.equal(list.servers.length,1);assert.equal(list.servers[0].id,'stable');assert.equal(list.servers[0].name,'服务器');assert.equal(list.servers[0].online,false);assert.equal(list.servers[0].ram_used,0);assert.equal(list.servers[0].ram_total,1);assert.equal(list.servers[0].net_rx,null);assert.equal(list.stats.offline,1);
  const detail=await(await app.api(req('/api/server?id=stable')))!.json();assert.equal(detail.id,'stable');assert.equal(detail.sysConfig.show_tf,false);
  const config=await(await app.api(req('/api/config')))!.json();assert.ok(config.bridge.history_hours.includes(168));
  assert.equal(config.bridge.history_bucket_seconds[6],600);assert.equal(config.bridge.history_bucket_seconds[48],7200);
  const serialized=JSON.stringify([list,detail,config]);for(const value of ['SENSITIVE-TOKEN','source.invalid','PRIVATE','synthetic'])assert.ok(!serialized.includes(value));
});
test('unknown server, unsupported endpoint, write methods, disabled probe and identity ambiguity are explicit failures',async()=>{
  assert.equal((await bridge().api(req('/api/server?id=missing')))!.status,404);
  assert.equal((await bridge().api(req('/api/admin')))!.status,404);
  assert.equal((await bridge().api(new Request('http://localhost/api/config',{method:'POST'})))!.status,405);
  assert.equal((await bridge({enabled:false}).api(req('/api/servers')))!.status,503);
  assert.equal((await bridge({...raw,servers:[...raw.servers,...raw.servers]}).api(req('/api/servers')))!.status,409);
});
test('access is local by default, public explicit, private protects all routes separately from the upstream token',()=>{
  assert.equal(authorize(new Request('https://display.invalid/'),readConfig(env))!.status,403);
  assert.equal(authorize(new Request('https://display.invalid/'),readConfig({...env,BRIDGE_ACCESS:'public'})),null);
  const privateConfig=readConfig({...env,BRIDGE_ACCESS:'private',BRIDGE_USERNAME:'viewer',BRIDGE_PASSWORD:'a-private-password-123'});
  for(const route of ['/','/assets/app.js','/api/ws','/api/servers'])assert.equal(authorize(new Request(`https://display.invalid${route}`),privateConfig)!.status,401);
  assert.equal(authorize(new Request('https://display.invalid/api/ws',{headers:{Authorization:`Basic ${btoa('viewer:a-private-password-123')}`}}),privateConfig),null);
  assert.throws(()=>readConfig({...env,BRIDGE_ACCESS:'private'}));
});
test('configured upstream origin rejects embedded credentials/path/query, targets require explicit unique keys',()=>{
  for(const base of ['ftp://source.invalid','https://user:secret@source.invalid','https://source.invalid/path','https://source.invalid?token=x'])assert.throws(()=>readConfig({...env,MMWX_BASE_URL:base}));
  assert.throws(()=>readConfig({...env,BRIDGE_PING_TARGETS:JSON.stringify({ct:{key:'a',label:'A'},cu:{key:'a',label:'A'}})}));
});
test('private Basic Auth decodes UTF-8 consistently and rejects malformed bytes or absent scheme',()=>{
  const config=readConfig({...env,BRIDGE_ACCESS:'private',BRIDGE_USERNAME:'访客',BRIDGE_PASSWORD:'private-password-123'});
  const credential=Buffer.from('访客:private-password-123','utf8').toString('base64');
  assert.equal(authorize(new Request('https://display.invalid/',{headers:{Authorization:`Basic ${credential}`}}),config),null);
  assert.equal(authorize(new Request('https://display.invalid/',{headers:{Authorization:credential}}),config)!.status,401);
  assert.equal(authorize(new Request('https://display.invalid/',{headers:{Authorization:'Basic /w=='}}),config)!.status,401);
});
test('Ping mapping uses exact configured target keys; no-data/timeout/zero and duplicate targets differ',()=>{
  const targets={ct:{key:'a',label:'Explicit'}};const out:Record<string,unknown>={};
  applyPing(out,[{key:'a',current_ms:0,loss_pct:0}],targets);assert.equal(out.ping_ct,0);assert.equal(out.loss_ct,0);assert.equal(out.ping_cu,false);
  applyPing(out,[{key:'a',current_ms:-1,loss_pct:-1}],targets);assert.equal(out.ping_ct,false);assert.equal(out.loss_ct,false);
  applyPing(out,[{key:'a',current_ms:-1,loss_pct:100}],targets);assert.equal(out.ping_ct,null);assert.equal(out.loss_ct,100);
  applyPing(out,[{key:'a',current_ms:Infinity}],targets);assert.equal(out.ping_ct,false);
  applyPing(out,[{key:'a',current_ms:8},{key:'a',current_ms:9}],targets);assert.equal(out.ping_ct,false);
});
test('theme ecosystem is explicit and unimplemented themes never select the CFSM protocol silently',()=>{
  const theme=selectTheme();assert.equal(theme.ecosystem,'cfsm');assert.equal(theme.installed,true);assert.equal(theme.license,'MIT');assert.throws(()=>selectTheme('komari-default'));
});
