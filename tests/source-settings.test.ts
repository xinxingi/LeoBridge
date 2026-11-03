import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig, type Config } from '../src/core/config.ts';
import { normalizeSnapshot } from '../src/core/model.ts';
import { SourceManagement } from '../src/management/source.ts';
import { managementConfig } from '../src/management/config.ts';
import { Admin } from '../src/management/admin.ts';
import { Site } from '../src/app/site.ts';
import { FileThemeStore } from '../src/runtime/file-theme-store.ts';
import { applyThemeCommand, emptyThemeState, publicThemeState, type ThemeCommand } from '../src/themes/store.ts';
import { hashPassword } from '../src/management/password.ts';

class Store {
  value=emptyThemeState();
  async state(){return structuredClone(this.value)}
  async command(command:ThemeCommand){this.value=applyThemeCommand(this.value,command);return this.state()}
  async putAsset(){} async asset(){return null}
}
const credential=await hashPassword('Synthetic-source-2026!',1);
const base=()=>readConfig({});
const raw=()=>({enabled:true,show_name:true,servers:[{name:'alpha',arch:'amd64',ping:[{key:'edge',label:'Edge'}]},{name:'beta',arch:'arm64'}]});
async function fixture(initial=base()){
  const store=new Store();store.value.adminCredential=credential;store.value.sessions.s={csrf:'csrf',expires:Date.now()+60_000,credentialVersion:1};
  let snapshot=raw();const calls:Config[]=[];
  const manager=new SourceManagement(initial,store,async config=>{calls.push(config);return normalizeSnapshot(structuredClone(snapshot))});
  const check=(baseUrl='https://source.test',token='synthetic-secret',version=store.value.source?.version??0)=>manager.check({baseUrl,token,version},'s');
  const save=(review:Awaited<ReturnType<typeof check>>,assignments=review.candidates.map(item=>item.suggestedId))=>manager.save({reviewId:review.reviewId,assignments,pingKeys:['edge','','','','','','',''],confirmed:true},'s');
  return {store,manager,calls,check,save,set:(value:ReturnType<typeof raw>)=>{snapshot=value}};
}

test('empty configuration serves management and setup without environment source fallback',async()=>{
  assert.equal(base().baseUrl,'');assert.equal(readConfig({MMWX_BASE_URL:'https://ignored.test'}).baseUrl,'');
  const site=new Site(base(),managementConfig({}),new Store(),async()=>new Response('admin UI'));
  assert.equal(await (await site.fetch(new Request('http://127.0.0.1:8787/admin/'))).text(),'admin UI');
  assert.match(await (await site.fetch(new Request('http://127.0.0.1:8787/'))).text(),/尚未配置数据源/);
  assert.equal((await site.fetch(new Request('http://127.0.0.1:8787/api/servers'))).status,503);
  assert.equal(await site.websocket(new Request('http://127.0.0.1:8787/api/ws')),null);
});

test('check is read-only until explicit review; saving persists without returning secrets',async()=>{
  const f=await fixture();const review=await f.check();
  assert.equal(f.store.value.source,undefined);assert.equal(f.calls.length,1);
  assert.ok(!JSON.stringify(review).includes('synthetic-secret'));
  await assert.rejects(f.manager.save({reviewId:review.reviewId},'s'));
  await f.save(review);
  assert.equal((await f.store.state()).source?.version,1);assert.equal(f.calls.length,2);
  assert.equal((await f.store.state()).source?.token,'synthetic-secret');
  assert.ok(!JSON.stringify(await f.manager.status()).includes('synthetic-secret'));
  assert.ok(!JSON.stringify(publicThemeState(await f.store.state())).includes('synthetic-secret'));
  assert.equal(f.store.value.sessions.s?.sourceReview,undefined);
});

test('unchanged source and reorder preserve existing IDs; origin change never reuses the token or guesses IDs',async()=>{
  const f=await fixture();await f.save(await f.check());
  const old=f.store.value.source!;f.set({...raw(),servers:raw().servers.reverse()});
  const review=await f.check('https://source.test','');
  assert.equal(f.calls.at(-1)?.token,'synthetic-secret');
  assert.deepEqual(review.candidates.map(item=>item.suggestedId),old.bindings.map(item=>item.id).reverse());
  await f.save(review);const different=await f.check('https://other.test','');
  assert.equal(f.calls.at(-1)?.token,'');assert.ok(different.candidates.every(item=>!item.suggestedId));
  await assert.rejects(f.save(different));
});

test('ambiguous descriptions, duplicate assignments and stale node reviews cannot alter active settings',async()=>{
  const f=await fixture();await f.save(await f.check());const original=structuredClone(f.store.value.source);
  const review=await f.check();await assert.rejects(f.save(review,[review.candidates[0]!.suggestedId,review.candidates[0]!.suggestedId]));
  f.set({...raw(),servers:[{name:'changed',arch:'amd64'},raw().servers[1]!]});
  await assert.rejects(f.save(review));assert.deepEqual(f.store.value.source,original);
  f.set({...raw(),servers:[raw().servers[0]!,raw().servers[0]!]});await assert.rejects(f.check());
  assert.deepEqual(f.store.value.source,original);
});

test('name privacy applies to review output and save-time revalidation',async()=>{
  const f=await fixture();const first=await f.check();
  f.set({...raw(),show_name:false});await assert.rejects(f.save(first));
  const hidden=await f.check();assert.ok(!JSON.stringify(hidden).includes('alpha'));assert.ok(!JSON.stringify(hidden).includes('beta'));
  await f.save(hidden);
});

test('version conflicts, expired reviews and sessions revoked during probing fail atomically',async()=>{
  const f=await fixture();const review=await f.check();f.store.value.sessions.s!.sourceReview!.expires=0;await assert.rejects(f.save(review));
  const next=await f.check();await f.save(next);await assert.rejects(f.save(next));await assert.rejects(f.check('https://source.test','',0));
  let release!:()=>void;const pending=new Promise<void>(resolve=>release=resolve);
  const manager=new SourceManagement(base(),f.store,async()=>{await pending;return normalizeSnapshot(raw())});
  const checking=manager.check({baseUrl:'https://source.test',token:'',version:1},'s');
  delete f.store.value.sessions.s;release();await assert.rejects(checking);
});

test('source APIs require login, changed password, origin and CSRF',async()=>{
  const f=await fixture(),management=managementConfig({});
  const admin=new Admin(management,f.store,async()=>new Response('ui'),f.manager);
  const send=(path:string,body?:unknown,headers:Record<string,string>={})=>admin.handle(new Request(management.adminOrigin+'/admin/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:management.adminOrigin,...headers},...(body?{body:JSON.stringify(body)}:{})}));
  assert.equal((await send('source')).status,401);
  let login=await send('login',{username:'admin',password:'Synthetic-source-2026!'});const cookie=login.headers.get('set-cookie')!.split(';')[0]!,csrf=(await login.json()).csrf;
  const body={baseUrl:'https://source.test',token:'synthetic-secret',version:0};
  assert.equal((await send('source/check',body,{Cookie:cookie})).status,403);
  assert.equal((await send('source/check',body,{Cookie:cookie,'X-CSRF-Token':csrf,Origin:'https://bad.test'})).status,403);
  const response=await send('source/check',body,{Cookie:cookie,'X-CSRF-Token':csrf});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  delete f.store.value.adminCredential;f.store.value.sessions={};login=await send('login',{username:'admin',password:'admin'});
  assert.equal((await send('source',undefined,{Cookie:login.headers.get('set-cookie')!.split(';')[0]!})).status,403);
});

test('file state retains settings across restart with private permissions and supersedes environment source',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'leobridge-source-'));
  try{
    const store=new FileThemeStore(dir);await store.command({type:'session',id:'s',session:{csrf:'csrf',expires:Date.now()+60_000}});
    await store.command({type:'password',sessionId:'s',expectedVersion:0,credential});
    await store.command({type:'session',id:'s',session:{csrf:'csrf',expires:Date.now()+60_000,credentialVersion:1}});
    const manager=new SourceManagement(base(),store,async()=>normalizeSnapshot(raw()));const review=await manager.check({version:0,baseUrl:'https://source.test',token:'synthetic-secret'},'s');
    await manager.save({reviewId:review.reviewId,assignments:review.candidates.map(c=>c.newId),pingKeys:Array(8).fill(''),confirmed:true},'s');
    assert.equal((await stat(join(dir,'state.json'))).mode&0o777,0o600);
    const site=new Site(readConfig({MMWX_BASE_URL:'https://old.test'}),managementConfig({}),new FileThemeStore(dir),async()=>new Response('ui'));
    await site.fetch(new Request('http://127.0.0.1:8787/'));assert.equal(site.config.baseUrl,'https://source.test');assert.equal(site.config.token,'synthetic-secret');
  }finally{await rm(dir,{recursive:true,force:true})}
});

test('renamed nodes require explicit old-ID selection; hidden-name reviews do not expose previous names',async()=>{
  const f=await fixture();await f.save(await f.check());const old=(await f.store.state()).source!.bindings;
  f.set({...raw(),servers:[{...raw().servers[0]!,name:'renamed'},raw().servers[1]!]});
  const review=await f.check();assert.equal(review.candidates[0]!.suggestedId,'');
  await f.save(review,[old[0]!.id,old[1]!.id]);assert.equal((await f.store.state()).source!.bindings[0]!.id,old[0]!.id);
  f.set({...raw(),show_name:false});const hidden=await f.check();
  assert.ok(!JSON.stringify(hidden).includes('renamed'));assert.ok(!JSON.stringify(hidden).includes('beta'));
});

test('late protocol responses from a replaced source are discarded',async()=>{
  const f=await fixture();await f.save(await f.check());
  const id='f'.repeat(32);f.store.value.installations[id]={id,title:'Synthetic',ecosystem:'cfsm',protocolProfile:'cfsm-609cc0b',source:'fixture',pinnedVersion:'fixture',license:{spdx:'MIT',text:'fixture',source:'fixture',sha256:'0'.repeat(64)},entry:'index.html',installedAt:'fixture',compatibility:'verified',files:{},bundled:false};f.store.value.active=id;
  const site=new Site(base(),managementConfig({}),f.store,async()=>new Response('ui'));await site.websocket(new Request('http://127.0.0.1:8787/api/ws'));
  let release!:(r:Response)=>void,started!:()=>void;const ready=new Promise<void>(resolve=>started=resolve);
  site.protocols['cfsm-609cc0b']!.fetch=async()=>{started();return new Promise<Response>(resolve=>release=resolve)};
  const pending=site.fetch(new Request('http://127.0.0.1:8787/api/servers'));await ready;
  await f.save(await f.check());release(new Response('old source data'));
  const response=await pending;assert.equal(response.status,409);assert.ok(!(await response.text()).includes('old source data'));
});
