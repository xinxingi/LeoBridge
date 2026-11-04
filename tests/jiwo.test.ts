import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fetchCatalog, type PublicFetcher } from '../src/themes/catalog.ts';
import { createNativeBuilder } from '../src/runtime/native-build.ts';
import { StoreNetwork } from '../src/management/store-network.ts';
import { emptyThemeState, applyThemeCommand, commitInstallation, INSTALL_NOTICE_VERSION, type ThemeCommand, type Installation, type ThemeStore } from '../src/themes/store.ts';
import type { ThemePackage } from '../src/themes/package.ts';
import { normalizeSnapshot } from '../src/core/model.ts';
import { NativeService } from '../src/protocols/native/service.ts';
import { Upstream } from '../src/upstream/client.ts';
import { detectNativeAppearances } from '../src/themes/native-appearances.ts';
import { Site } from '../src/app/site.ts';
import { Admin } from '../src/management/admin.ts';
import { managementConfig } from '../src/management/config.ts';
import { hashPassword } from '../src/management/password.ts';
import { readConfig } from './helpers/config.ts';

const encode=(value:string)=>new TextEncoder().encode(value);
const officialRepository='mmwx-group/mmwx-probe',communityRepository='chnnic/jiwo-probe';

test('native aggregation preserves each repository revision and isolates refresh/cache by source',async()=>{
  const heads:Record<string,string>={[officialRepository]:'a'.repeat(40),[communityRepository]:'b'.repeat(40)};
  const calls:string[]=[];
  const fetcher:PublicFetcher=async input=>{
    const url=new URL(String(input)),repository=url.pathname.split('/').slice(2,4).join('/');
    calls.push(repository);assert.ok(Object.hasOwn(heads,repository));assert.equal(url.pathname,`/repos/${repository}/commits/main`);
    return Response.json({sha:heads[repository]});
  };
  const first=await fetchCatalog('native',fetcher,{refresh:true});
  assert.equal(first.entries.length,2);
  assert.deepEqual(first.entries.map(entry=>[entry.id,entry.catalogRevision,entry.version]),[
    ['mmwx-probe',heads[officialRepository],heads[officialRepository]],['jiwo-probe',heads[communityRepository],heads[communityRepository]],
  ]);
  const jiwo=first.entries.find(entry=>entry.id==='jiwo-probe')!;
  assert.equal(jiwo.repositoryUrl,`https://github.com/${communityRepository}`);
  assert.equal(jiwo.tag,'社区 · Jiwo');assert.equal(jiwo.compatibility,'unverified');
  const cached=await fetchCatalog('native',fetcher);
  assert.equal(cached.fromCache,true);assert.equal(calls.length,2);
  cached.entries[1].catalogRevision='mutated';
  heads[communityRepository]='c'.repeat(40);
  const updated=await fetchCatalog('native',fetcher,{nativeThemeId:'jiwo-probe',refresh:true});
  assert.equal(updated.entries[0].catalogRevision,heads[communityRepository]);
  assert.deepEqual(calls,[officialRepository,communityRepository,communityRepository]);
  const combined=await fetchCatalog('native',fetcher);
  assert.equal(combined.entries[0].catalogRevision,'a'.repeat(40));
  assert.equal(combined.entries[1].catalogRevision,'c'.repeat(40));assert.equal(calls.length,3);
});

test('native fixed selections retain the selected source and reject unknown source identities without fetching',async()=>{
  const never:PublicFetcher=async()=>{assert.fail('fixed curated source lookup must not resolve main');};
  const revision='d'.repeat(40);
  const selected=await fetchCatalog('native',never,{nativeThemeId:'jiwo-probe',revision});
  assert.equal(selected.entries.length,1);assert.equal(selected.entries[0].id,'jiwo-probe');
  assert.equal(selected.source,`https://github.com/${communityRepository}/tree/${revision}`);
  assert.equal(selected.catalogRevision,revision);
  const legacy=await fetchCatalog('native',never,{revision});assert.equal(legacy.entries[0].id,'mmwx-probe');
  for(const nativeThemeId of ['__proto__','constructor','https://github.com/other/theme','unknown']){
    await assert.rejects(fetchCatalog('native',never,{nativeThemeId,revision}),{code:'THEME_NOT_FOUND'});
  }
  await assert.rejects(fetchCatalog('native',never,{nativeThemeId:'jiwo-probe',revision:'main'}),{code:'CATALOG_REVISION'});
  await assert.rejects(fetchCatalog('cfsm',never,{nativeThemeId:'jiwo-probe',revision}),{code:'CATALOG_OPTIONS'});
});

test('failed Jiwo refresh cannot report its old commit as fresh or invalidate the official source cache',async()=>{
  let failure=false;
  const fetcher:PublicFetcher=async input=>{
    const jiwo=String(input).includes(communityRepository);
    if(jiwo&&failure)return new Response('missing',{status:404});
    return Response.json({sha:(jiwo?'b':'a').repeat(40)});
  };
  await fetchCatalog('native',fetcher);
  failure=true;
  await assert.rejects(fetchCatalog('native',fetcher,{nativeThemeId:'jiwo-probe',refresh:true}),{code:'DOWNLOAD_HTTP'});
  await assert.rejects(fetchCatalog('native',fetcher,{nativeThemeId:'jiwo-probe'}),{code:'DOWNLOAD_HTTP'});
  const official=await fetchCatalog('native',fetcher,{nativeThemeId:'mmwx-probe'});
  assert.equal(official.fromCache,true);assert.equal(official.catalogRevision,'a'.repeat(40));
});

test('native installation passes exact source and reviewed revision through the configured download transport',async()=>{
  const state=emptyThemeState();state.storeProxy={version:1,enabled:true,url:'http://127.0.0.1:7897'};
  const store={state:async()=>state} as ThemeStore;
  const fetcher:PublicFetcher=async()=>{assert.fail('fixed selection does not need HEAD');};
  const built:ThemePackage={id:'a'.repeat(32),digest:'a'.repeat(64),name:'Synthetic community package',themeId:'jiwo-probe',ecosystem:'native',source:`https://github.com/${communityRepository}`,catalogSource:`https://github.com/${communityRepository}/tree/${'e'.repeat(40)}`,catalogRevision:'e'.repeat(40),pinnedVersion:'e'.repeat(40),license:{spdx:'NOASSERTION',text:'Synthetic only',source:'synthetic',sha256:'a'.repeat(64)},entry:'index.html',files:[],compatibility:'unverified',audit:{staticReferencesChecked:true,dynamicReferencesRequireBrowser:true,notices:[]}};
  const calls:{revision:string;themeId:string}[]=[];let transports=0;
  const network=new StoreNetwork(store,async(settings,run)=>{
    assert.equal(settings.url,state.storeProxy!.url);assert.equal(settings.enabled,true);transports++;return run(fetcher);
  },async(actualFetcher,revision,themeId)=>{assert.equal(actualFetcher,fetcher);calls.push({revision,themeId});return built;});
  for(let confirm=0;confirm<2;confirm++)assert.equal(await network.install('native','jiwo-probe',{expectedCatalogRevision:'e'.repeat(40)}),built);
  assert.deepEqual(calls,[{revision:'e'.repeat(40),themeId:'jiwo-probe'},{revision:'e'.repeat(40),themeId:'jiwo-probe'}]);
  assert.equal(transports,2);
  await assert.rejects(network.install('native','unknown',{expectedCatalogRevision:'e'.repeat(40)}),{code:'THEME_NOT_FOUND'});
  assert.equal(transports,2);
});

/** These are hand-written build fixtures, not copies of any upstream source. */
function frontendFixture(repository:string,missingMap=false):Record<string,Uint8Array>{
  const community=repository===communityRepository;
  const packageJson={name:'synthetic-native-build',version:'1.0.0'};
  const source:Record<string,string>={
    'index.html':'<html><head></head><body><script type="module" src="/src/main.tsx"></script></body></html>',
    'package.json':JSON.stringify(packageJson),
    'package-lock.json':JSON.stringify({...packageJson,lockfileVersion:3,packages:{'':packageJson}}),
    'LICENSE':'Synthetic test fixture license; no upstream code.',
    'src/main.tsx':community?'import { marker } from "@/shared"; import "./main.css"; document.body.dataset.fixture = marker;':'import "./main.css"; document.body.dataset.fixture="official";',
    'src/main.css':':root { color: #123456 }',
    'public/image.svg':'<svg xmlns="http://www.w3.org/2000/svg"/>',
  };
  if(community){
    source['src/ran/shared.ts']='export const marker="community-alias-resolved";';
    source['src/ran/map-entry.tsx']='import { marker } from "@/shared"; import "./map.css"; document.body.dataset.map=marker;';
    source['src/ran/map.css']=':root { background: #abcdef }';
    source['src/ran/NOTICE.md']='Synthetic nested source notice.';
    if(!missingMap)source['map.html']='<html><head></head><body><script type="module" src="/src/ran/map-entry.tsx"></script></body></html>';
  }
  return Object.fromEntries(Object.entries(source).map(([path,text])=>[path,encode(text)]));
}
function buildFetcher(calls:string[],missingMap=false):PublicFetcher{
  return async input=>{
    const url=new URL(String(input));calls.push(url.href);
    const parts=url.pathname.split('/');
    const repository=url.hostname==='api.github.com'?parts.slice(2,4).join('/'):parts.slice(1,3).join('/');
    assert.ok([officialRepository,communityRepository].includes(repository));
    const files=frontendFixture(repository,missingMap);
    if(url.hostname==='api.github.com'){
      assert.match(url.pathname,/\/git\/trees\/[a-f0-9]{40}$/);
      return Response.json({truncated:false,tree:Object.entries(files).map(([path,bytes])=>({path,type:'blob',mode:'100644',sha:createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),size:bytes.length}))});
    }
    assert.equal(url.hostname,'raw.githubusercontent.com');
    const path=parts.slice(4).join('/');assert.ok(files[path],path);
    return new Response(new Uint8Array(files[path]));
  };
}

test('same-commit native builds remain source-isolated and Jiwo builds both HTML entries with its local alias',async t=>{
  const builder=createNativeBuilder();t.after(()=>builder.close());
  const calls:string[]=[],fetcher=buildFetcher(calls),revision='f'.repeat(40);
  const [official,jiwo,same]=await Promise.all([builder(fetcher,revision,'mmwx-probe'),builder(fetcher,revision,'jiwo-probe'),builder(fetcher,revision,'jiwo-probe')]);
  assert.equal(same.digest,jiwo.digest);assert.notEqual(official.digest,jiwo.digest);
  assert.equal(official.source,`https://github.com/${officialRepository}`);
  assert.equal(jiwo.source,`https://github.com/${communityRepository}`);assert.equal(jiwo.themeId,'jiwo-probe');
  assert.equal(calls.filter(url=>url.includes('/git/trees/')).length,2);
  assert.ok(!official.files.some(file=>file.path==='map.html'));
  for(const [page,entryName] of [['index.html','main'],['map.html','map-entry']]){
    const html=new TextDecoder().decode(jiwo.files.find(file=>file.path===page)!.bytes);
    assert.doesNotMatch(html,/\/src\//);
    const js=html.match(new RegExp(`src="/(assets/${entryName}-[^"\\s]+\\.js)"`))?.[1];
    const css=html.match(new RegExp(`href="/(assets/${entryName}-[^"\\s]+\\.css)"`))?.[1];
    assert.ok(js,html);assert.ok(css,html);
    assert.ok(jiwo.files.some(file=>file.path===js));assert.ok(jiwo.files.some(file=>file.path===css));
  }
  assert.ok(jiwo.files.some(file=>file.path.endsWith('.js')&&new TextDecoder().decode(file.bytes).includes('community-alias-resolved')));
  assert.ok(jiwo.license.documents?.some(doc=>doc.path==='src/ran/NOTICE.md'));
  assert.ok(!jiwo.files.some(file=>/\.(tsx?|lock)$/.test(file.path)||['package.json','package-lock.json'].includes(file.path)));
  assert.ok(jiwo.remoteFiles?.['image.svg']);
  const count=calls.length;await builder(fetcher,revision,'mmwx-probe');await builder(fetcher,revision,'jiwo-probe');assert.equal(calls.length,count);
  await assert.rejects(builder(fetcher,revision,'untrusted'),{code:'THEME_NOT_FOUND'});assert.equal(calls.length,count);
});

test('Jiwo refuses an incomplete map entry instead of publishing a partially built frontend',async t=>{
  const builder=createNativeBuilder();t.after(()=>builder.close());
  await assert.rejects(builder(buildFetcher([],true),'d'.repeat(40),'jiwo-probe'),{code:'NATIVE_ENTRY'});
});

test('Jiwo-only display helpers expose defaults and unknown visitor data without querying upstream or trusting headers',async()=>{
  const config=readConfig({MMWX_BASE_URL:'https://source.test',MMWX_PROBE_TOKEN:'private-token',BRIDGE_BINDINGS:JSON.stringify([{id:'a',match:{name:'fixture'}}])});
  const service=new NativeService(config,new Upstream(config,async()=>{assert.fail('helpers must not contact the source');}));
  const presentation={theme:'jiwo-probe',settings:{secret:'never-send'},nativeTheme:'luminaplus'};
  const request=(path:string)=>new Request('https://view.test'+path,{headers:{'CF-Connecting-IP':'203.0.113.99','CF-IPCountry':'US'}});
  assert.deepEqual(await (await service.handle(request('/api/theme-config'),presentation))!.json(),{});
  assert.deepEqual(await (await service.handle(request('/api/visitor'),presentation))!.json(),{ip:'UNKNOWN',risk:null,proxy:'unknown',type:''});
  for(const path of ['/api/theme-config','/api/visitor']){
    assert.equal(await service.handle(request(path),{theme:'mmwx-probe',settings:{}}),null);
    assert.equal(await service.handle(request(path)),null);
    await assert.rejects(service.handle(new Request('https://view.test'+path,{method:'POST'}),presentation),{status:405});
  }
});

test('native appearance discovery recognizes literal picker menus without executing bundle code or accepting unrelated strings',()=>{
  const menu='[{value:null,label:"Follow source",color:"#abc"},{value:"luminaplus",label:"Community layout",color:"#123456"},{value:"ran",label:"Map layout",color:"#654321"}]';
  const discovered=detectNativeAppearances([{path:'assets/community.js',bytes:encode(`const menu=${menu};globalThis.mustNeverExecute();`)}]);
  assert.deepEqual(discovered.map(option=>option.id),['luminaplus','ran']);
  const malformed=[
    `const quoted=${JSON.stringify(menu)};`,
    '/* '+menu+' */',
    '[{value:"fake",label:"No source row",color:"#123456"},{value:"also-fake",label:"Other",color:"#123456"}]',
    '[{value:null,label:"Follow",color:"#abc"},{value:getTheme(),label:"dynamic",color:"#123456"}]',
    '[{value:null,label:"Follow",color:"#abc"},{value:"unsafe/path",label:"invalid",color:"#123456"}]',
    '[{value:null,label:"Follow",color:"#abc"},{value:"fake",label:"No color",unrelated:"#123456"}]',
  ];
  for(const source of malformed)assert.deepEqual(detectNativeAppearances([{path:'assets/community.js',bytes:encode(source)}]),[]);
});

class NativeTestStore implements ThemeStore {
  value=emptyThemeState();
  assets=new Map<string,{bytes:Uint8Array;contentType:string}>();
  async state(){return structuredClone(this.value);}
  async command(command:ThemeCommand){this.value=applyThemeCommand(this.value,command);return this.state();}
  async putAsset(id:string,path:string,bytes:Uint8Array,contentType:string){this.assets.set(`${id}/${path}`,{bytes,contentType});}
  async asset(id:string,path:string){return this.assets.get(`${id}/${path}`)??null;}
}
const pageFiles=(label:string)=>['index','map'].map(page=>({path:`${page}.html`,bytes:encode(`<html><head></head><body>${label}-${page}</body></html>`),contentType:'text/html; charset=utf-8'}));
function nativeInstallation(id:string,label:string,overrides:Partial<Installation>={}):Installation{
  return {id,title:label,ecosystem:'native',themeId:'jiwo-probe',source:`https://github.com/${communityRepository}`,pinnedVersion:'a'.repeat(40),protocolProfile:'mmwx-native-v1',license:{spdx:'NOASSERTION',text:'Synthetic license',source:'synthetic',sha256:'a'.repeat(64)},entry:'index.html',installedAt:'2026-11-04T00:00:00Z',compatibility:'unverified',files:Object.fromEntries(pageFiles(label).map(file=>[file.path,{size:file.bytes.length,contentType:file.contentType}])),bundled:false,...overrides};
}
const testOrigin='https://native.example.test';

test('native extensionless pages select packaged HTML on direct load and preview reload while other SPA routes retain fallback',async()=>{
  const store=new NativeTestStore(),active=nativeInstallation('1'.repeat(32),'active'),preview=nativeInstallation('2'.repeat(32),'preview');
  await commitInstallation(store,active,pageFiles('active'),true);
  await commitInstallation(store,preview,pageFiles('preview'));
  const config=readConfig({MMWX_BASE_URL:'https://source.test',MMWX_PROBE_TOKEN:'synthetic',BRIDGE_ACCESS:'public',BRIDGE_BINDINGS:JSON.stringify([{id:'a',match:{name:'A'}}])});
  const site=new Site(config,managementConfig({BRIDGE_ORIGIN:testOrigin}),store,async()=>new Response('synthetic admin'),new StoreNetwork(store,async(_settings,run)=>run(async()=>new Response('synthetic missing asset',{status:404}))));
  site.protocols['mmwx-native-v1']={fetch:async()=>null,websocketPaths:[],openRealtime:()=>({close(){}})};
  const request=(path:string,referer?:string)=>new Request(testOrigin+path,{headers:{accept:'text/html',...(referer?{referer}:{})}});
  for(const path of ['/map','/map.html']){
    const response=await site.fetch(request(path));assert.equal(response.status,200);
    const body=await response.text();assert.match(body,/active-map/);assert.doesNotMatch(body,/active-index/);
  }
  const previewPath=`/map?__preview=${preview.id}`;
  for(let reload=0;reload<2;reload++){
    const response=await site.fetch(request(previewPath));assert.equal(response.status,200);
    const body=await response.text();assert.match(body,/preview-map/);assert.doesNotMatch(body,/active-map|preview-index/);
    assert.ok(body.includes(`"__preview","${preview.id}"`));assert.equal(response.headers.get('referrer-policy'),'same-origin');
  }
  const navigated=await site.fetch(request('/map',testOrigin+`/?__preview=${preview.id}`));
  assert.equal(navigated.status,307);assert.equal(navigated.headers.get('location'),testOrigin+previewPath);
  assert.match(await(await site.fetch(request('/ordinary-spa-route'))).text(),/active-index/);
  assert.match(await(await site.fetch(request(`/ordinary-spa-route?__preview=${preview.id}`))).text(),/preview-index/);
  assert.equal((await site.fetch(request('/unknown.html'))).status,404);
  assert.equal(store.value.active,active.id);
});

test('extensionless HTML lookup does not change non-native SPA routes',async()=>{
  const store=new NativeTestStore(),item=nativeInstallation('3'.repeat(32),'cfsm',{ecosystem:'cfsm',themeId:'synthetic',protocolProfile:'cfsm-609cc0b'});
  await commitInstallation(store,item,pageFiles('cfsm'),true);
  const config=readConfig({MMWX_BASE_URL:'https://source.test',MMWX_PROBE_TOKEN:'synthetic',BRIDGE_ACCESS:'public',BRIDGE_BINDINGS:JSON.stringify([{id:'a',match:{name:'A'}}])});
  const site=new Site(config,managementConfig({BRIDGE_ORIGIN:testOrigin}),store,async()=>new Response('synthetic admin'),new StoreNetwork(store,async(_settings,run)=>run(async()=>new Response('synthetic missing asset',{status:404}))));
  site.protocols['cfsm-609cc0b']={fetch:async()=>null,websocketPaths:[],openRealtime:()=>({close(){}})};
  const html=await(await site.fetch(new Request(testOrigin+'/map',{headers:{accept:'text/html'}}))).text();
  assert.match(html,/cfsm-index/);assert.doesNotMatch(html,/cfsm-map/);
});

test('Jiwo update only resolves its own repository and keeps reviewed source, revision and appearance through installation',async()=>{
  const store=new NativeTestStore(),old=nativeInstallation('4'.repeat(32),'old-jiwo',{nativeTheme:'luminaplus',pinnedVersion:'b'.repeat(40)});
  await commitInstallation(store,old,pageFiles('old-jiwo'),true);
  const password='Synthetic-jiwo-password-2026!';store.value.adminCredential=await hashPassword(password,1);
  let head=old.pinnedVersion;const requested:string[]=[],builds:{revision:string;themeId:string}[]=[];
  const network=new StoreNetwork(store,async(_settings,run)=>run(async input=>{
    const url=String(input);requested.push(url);assert.equal(url,`https://api.github.com/repos/${communityRepository}/commits/main`);
    return Response.json({sha:head});
  }),async(_fetcher,revision,themeId)=>{
    builds.push({revision,themeId});
    return {id:'f'.repeat(32),digest:'f'.repeat(64),themeId,name:'new-jiwo',ecosystem:'native',source:`https://github.com/${communityRepository}`,catalogSource:`https://github.com/${communityRepository}/tree/${revision}`,catalogRevision:revision,pinnedVersion:revision,license:old.license,entry:'index.html',files:pageFiles('new-jiwo'),compatibility:'unverified',audit:{staticReferencesChecked:true,dynamicReferencesRequireBrowser:true,notices:[]}};
  });
  const admin=new Admin(managementConfig({BRIDGE_ORIGIN:testOrigin}),store,async()=>new Response('synthetic admin'),undefined,network);
  let auth:Record<string,string>={};
  const post=(path:string,body:unknown)=>admin.handle(new Request(`${testOrigin}/admin/api/${path}`,{method:'POST',headers:{'content-type':'application/json',origin:testOrigin,...auth},body:JSON.stringify(body)}));
  const login=await post('login',{username:'admin',password});assert.equal(login.status,200);
  auth={cookie:login.headers.get('set-cookie')!.split(';')[0],'x-csrf-token':(await login.json()).csrf};
  const current=await post('prepare-update',{id:old.id});assert.equal(current.status,200);assert.equal((await current.json()).status,'current');assert.equal(builds.length,0);
  head='c'.repeat(40);
  const response=await post('prepare-update',{id:old.id});assert.equal(response.status,200);const review=await response.json();
  assert.equal(review.status,'available');assert.equal(review.pinnedVersion,head);assert.equal(review.source,`https://github.com/${communityRepository}`);
  head='d'.repeat(40);
  const installedResponse=await post('install',{reviewId:review.reviewId,noticeVersion:INSTALL_NOTICE_VERSION,acknowledge:true});assert.equal(installedResponse.status,200);
  const installed=store.value.installations[(await installedResponse.json()).id];
  assert.equal(installed.themeId,'jiwo-probe');assert.equal(installed.source,`https://github.com/${communityRepository}`);
  assert.equal(installed.pinnedVersion,'c'.repeat(40));assert.equal(installed.catalogRevision,'c'.repeat(40));assert.equal(installed.nativeTheme,'luminaplus');
  assert.equal(installed.compatibility,'unverified');assert.equal(store.value.active,old.id);
  assert.deepEqual(builds,[{revision:'c'.repeat(40),themeId:'jiwo-probe'},{revision:'c'.repeat(40),themeId:'jiwo-probe'}]);
  assert.equal(requested.length,2);assert.ok(requested.every(url=>url.includes(communityRepository)));
});

test('partial native source failures keep the other source installable and mark unavailable entries without stale revisions',async()=>{
  for(const failedRepository of [officialRepository,communityRepository]){
    let unavailable=false;
    const fetcher:PublicFetcher=async input=>{
      const repository=new URL(String(input)).pathname.split('/').slice(2,4).join('/');
      if(unavailable&&repository===failedRepository)return new Response('offline',{status:404});
      return Response.json({sha:(repository===officialRepository?'a':'b').repeat(40)});
    };
    await fetchCatalog('native',fetcher,{refresh:true});
    unavailable=true;
    const catalog=await fetchCatalog('native',fetcher,{refresh:true});
    assert.equal(catalog.entries.length,2);assert.equal(catalog.fromCache,false);
    const failed=catalog.entries.find(entry=>entry.repositoryUrl===`https://github.com/${failedRepository}`)!;
    const working=catalog.entries.find(entry=>entry!==failed)!;
    assert.equal(failed.canAttemptInstall,false);assert.equal(failed.catalogRevision,'');assert.equal(failed.version,undefined);
    assert.ok(failed.blockReasons.length);assert.equal(failed.compatibility,'unverified');
    assert.equal(working.canAttemptInstall,true);assert.match(working.catalogRevision,/^[ab]{40}$/);assert.equal(working.blockReasons.length,0);
    unavailable=false;
    const recovered=await fetchCatalog('native',fetcher,{refresh:true});
    assert.ok(recovered.entries.every(entry=>entry.canAttemptInstall&&entry.catalogRevision.length===40));
  }
  await assert.rejects(fetchCatalog('native',async()=>new Response('offline',{status:404}),{refresh:true}),{code:'DOWNLOAD_HTTP'});
});


test('native license badges preserve object and array forms while filtering nonobjects and private fields',()=>{
  const config=readConfig({MMWX_BASE_URL:'https://source.test',MMWX_PROBE_TOKEN:'synthetic',BRIDGE_BINDINGS:JSON.stringify([{id:'a',match:{name:'A'}}])});
  const service=new NativeService(config);
  const project=(license_badge:unknown)=>service.snapshot(normalizeSnapshot({enabled:true,show_name:true,servers:[{name:'A',online:true}],license_badge}),{theme:'jiwo-probe',settings:{}});
  const object={name:'premium',display_name:'Synthetic badge',token:'must-not-leak',nested:{private:'must-not-leak'}};
  assert.deepEqual(project(object).license_badge,{name:'premium',display_name:'Synthetic badge'});
  const result=project([object,null,'must-not-leak',false,123,['must-not-leak'],{name:'community',token:'must-not-leak'},{display_name:'Public label',secret:'must-not-leak'}]);
  assert.deepEqual(result.license_badge,[{name:'premium',display_name:'Synthetic badge'},{name:'community'},{display_name:'Public label'}]);
  assert.doesNotMatch(JSON.stringify(result),/must-not-leak|token|secret|nested/);
  assert.deepEqual(project([]).license_badge,[]);
  assert.equal(project(null).license_badge,undefined);
});
