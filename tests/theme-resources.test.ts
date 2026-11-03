import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ThemeResources,presentationContext } from '../src/themes/resources.ts';
import { CFSM_PUBLIC_SOURCES, KOMARI_PUBLIC_SOURCES } from '../src/themes/default-resources.ts';
import { type Installation } from '../src/themes/store.ts';
const bytes=new TextEncoder().encode('export const fromUpstream=true;');
const blob=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const base:Installation={id:'a'.repeat(32),title:'Synthetic',ecosystem:'cfsm',source:'https://github.com/example/theme',pinnedVersion:'b'.repeat(40),entry:'index.html',protocolProfile:'cfsm-609cc0b',license:{spdx:'NOASSERTION',text:'',source:'',sha256:''},installedAt:'test',compatibility:'unverified',bundled:false,files:{},remoteFiles:{'custom/nested/module.mjs':{sha:blob,size:bytes.length,contentType:'text/javascript'}}};

test('fixed CFSM resources load once, verify blob, preserve MIME and do not forward client credentials',async()=>{
  const seen:{url:string;init:RequestInit|undefined}[]=[];
  const resources=new ThemeResources(async run=>run(async(input,init)=>{seen.push({url:String(input),init});return new Response(bytes);}));
  const [a,b]=await Promise.all([resources.get(base,'custom/nested/module.mjs'),resources.get(base,'custom/nested/module.mjs')]);
  assert.equal(a,b);assert.equal(a?.contentType,'text/javascript');assert.deepEqual(a?.bytes,bytes);
  assert.equal(seen.length,1);assert.equal(seen[0]!.url,`https://raw.githubusercontent.com/example/theme/${base.pinnedVersion}/custom/nested/module.mjs`);
  assert.equal(new Headers(seen[0]!.init?.headers).has('authorization'),false);assert.equal(new Headers(seen[0]!.init?.headers).has('cookie'),false);
  assert.equal(await resources.get(base,'unlisted.js'),null);assert.equal(seen.length,1);
  const bad=new ThemeResources(async run=>run(async()=>new Response('corrupt')));
  await assert.rejects(bad.get(base,'custom/nested/module.mjs'),{code:'RESOURCE_HASH'});
  await assert.rejects(resources.get(base,'../outside.js'),{code:'PACKAGE_PATH'});
});

test('Komari defaults only resolve indexed upstream resources and verify original byte hashes',async()=>{
  const item={...base,ecosystem:'komari' as const};let calls=0;
  const resources=new ThemeResources(async run=>run(async input=>{calls++;assert.equal(String(input),KOMARI_PUBLIC_SOURCES['assets/logo/os-alma.svg']!.url);return new Response('corrupt');}));
  assert.equal(await resources.get(item,'assets/nonexistent.svg'),null);
  assert.equal(await resources.get(item,'toString'),null);assert.equal(calls,0);
  await assert.rejects(resources.get(item,'assets/logo/os-alma.svg'),{code:'RESOURCE_HASH'});assert.equal(calls,1);
  assert.ok(KOMARI_PUBLIC_SOURCES['assets/logo/os-istore.png']?.url.includes('baf5db6'));
});

test('resource 404 caches briefly; transient failures are retried and concurrency is bounded',async()=>{
  let now=0,calls=0,active=0,peak=0;
  const item={...base,remoteFiles:undefined};
  const resources=new ThemeResources(async run=>run(async()=>{calls++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;return new Response('missing',{status:404});}),()=>now);
  await Promise.all(Array.from({length:16},(_,i)=>resources.get(item,`asset-${i}.png`)));
  assert.ok(peak<=6);assert.equal(calls,16);
  assert.equal(await resources.get(item,'asset-0.png'),null);assert.equal(calls,16);
  now=60_001;await resources.get(item,'asset-0.png');assert.equal(calls,17);
  let failures=0;const failed=new ThemeResources(async run=>run(async()=>{failures++;return new Response('unavailable',{status:503});}));
  for(let i=0;i<2;i++)await assert.rejects(failed.get(item,'asset.png'),{code:'DOWNLOAD_HTTP'});
  assert.equal(failures,2);
});

test('presentation defaults preserve false and zero, isolate versions and never evaluate raw configuration',()=>{
  const item={...base,themeId:'Demo',configuration:{type:'managed',data:[{key:'zero',default:0},{key:'disabled',default:false},{key:'label',default:''},{key:'__proto__',default:{x:1}}]}};
  const context=presentationContext(item);assert.equal(context.theme,'Demo');assert.equal(context.settings.zero,0);assert.equal(context.settings.disabled,false);assert.equal(context.settings.label,'');
  assert.equal(Object.hasOwn(context.settings,'__proto__'),true);assert.equal(Object.getPrototypeOf(context.settings),Object.prototype);
  context.settings.zero=9;assert.equal(presentationContext(item).settings.zero,0);
  assert.deepEqual(presentationContext({...base,configuration:{type:'raw',html:'<script>throw Error()</script>'}}),{theme:'default',settings:{}});
});


test('CFSM own assets precede dependencies and defaults; missing assets fall back only to indexed sources',async()=>{
  const path='flags/us.svg',seen:string[]=[];
  const own={...base,remoteFiles:{[path]:{sha:blob,size:bytes.length,contentType:'image/svg+xml'}},dependencySources:{[path]:{url:'https://raw.githubusercontent.com/example/library/'+'c'.repeat(40)+'/us.svg',sha256:createHash('sha256').update(bytes).digest('hex')}}};
  const resources=new ThemeResources(async run=>run(async input=>{seen.push(String(input));return new Response(bytes);}));
  assert.deepEqual((await resources.get(own,path))?.bytes,bytes);
  assert.ok(seen[0]!.includes('/example/theme/'));assert.equal(seen.length,1);
  const fallback=new ThemeResources(async run=>run(async input=>{seen.push(String(input));return new Response(String(input).includes('/example/theme/')?'missing':bytes,{status:String(input).includes('/example/theme/')?404:200});}));
  assert.deepEqual((await fallback.get(own,path))?.bytes,bytes);assert.ok(seen.at(-1)!.includes('/example/library/'));
  const defaults=new ThemeResources(async run=>run(async input=>{seen.push(String(input));return new Response('corrupt');}));
  await assert.rejects(defaults.get(base,path),{code:'RESOURCE_HASH'});
  assert.equal(seen.at(-1),CFSM_PUBLIC_SOURCES[path]!.url);
  const count=seen.length;assert.equal(await defaults.get(base,'arbitrary.svg'),null);assert.equal(seen.length,count);
  const legacy=new ThemeResources(async run=>run(async input=>{seen.push(String(input));return new Response('missing',{status:404});}));
  assert.equal(await legacy.get({...base,remoteFiles:undefined},path),null);
  assert.ok(seen.at(-2)!.includes('/example/theme/'));assert.equal(seen.at(-1),CFSM_PUBLIC_SOURCES[path]!.url);
});
