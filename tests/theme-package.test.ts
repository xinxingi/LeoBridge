import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync } from 'fflate';
import { parseKomariCatalog, type CatalogEntry } from '../src/themes/catalog.ts';
import { buildKomariPackage, installCatalogTheme, readStaticZip, safePackagePath, sha256, validateStaticReferences, contentType } from '../src/themes/package.ts';
const enc = new TextEncoder();
// Synthetic package/license fixture. It is implementation evidence, not a real theme.
const MIT = `MIT License\nCopyright (c) Synthetic Test Author\n\nPermission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:\n
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.\n
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;
function source(overrides: Record<string, string> = {}): Record<string, Uint8Array> {
  return Object.fromEntries(Object.entries({ 'komari-theme.json': JSON.stringify({ short: 'Synthetic', version: '1.0' }), 'dist/index.html': '<script type="module" src="/assets/app.js"></script><link rel="stylesheet" href="/assets/style.css">', 'dist/assets/app.js': 'export const synthetic = true;', 'dist/assets/style.css': 'body{color:green}', LICENSE: MIT, ...overrides }).map(([path, text]) => [path, enc.encode(text)]));
}
async function entry(zip: Uint8Array): Promise<CatalogEntry> {
  return parseKomariCatalog({ schema: 1, themes: [{ short: 'Synthetic', name: 'Synthetic', version: '1.0', url: 'https://github.com/example/synthetic', download: 'https://github.com/example/synthetic/releases/download/v1/p.zip', sha256: await sha256(zip) }] })[0]!;
}
function centralOffset(zip: Uint8Array): number {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let i=0;i<zip.length-4;i++) if (view.getUint32(i,true)===0x02014b50) return i;
  throw new Error('test ZIP central directory absent');
}

test('valid static ZIP produces content-derived immutable identity, normalized root and preserved license', async () => {
  const archive = zipSync(source()); const e = await entry(archive);
  const a = await buildKomariPackage(e, archive), b = await buildKomariPackage(e, archive);
  assert.equal(a.id, b.id); assert.match(a.id, /^[a-f0-9]{32}$/); assert.equal(a.entry, 'index.html');
  assert.equal(a.license.spdx, 'MIT'); assert.equal(a.compatibility, 'unverified');
  assert.deepEqual(a.files.map(f => f.path).sort(), ['LICENSE','assets/app.js','assets/style.css','index.html'].sort());
  const changed = zipSync(source({ 'dist/assets/app.js': 'export const synthetic = false;' }));
  assert.notEqual((await buildKomariPackage(await entry(changed), changed)).id, a.id);
});

test('hash, manifest identity, license and configuration are mandatory independent gates', async () => {
  const zip = zipSync(source()); const e = await entry(zip);
  await assert.rejects(buildKomariPackage({ ...e, sha256: '0'.repeat(64) }, zip), { code: 'PACKAGE_SHA256' });
  const mismatch = zipSync(source({ 'komari-theme.json': JSON.stringify({ short:'Other',version:'1.0' }) }));
  await assert.rejects(buildKomariPackage(await entry(mismatch), mismatch), { code: 'MANIFEST_IDENTITY' });
  const noLicense = source(); delete noLicense.LICENSE;
  const absent = zipSync(noLicense); await assert.rejects(buildKomariPackage(await entry(absent), absent), { code: 'LICENSE_REQUIRED' });
  const raw = zipSync(source({ 'komari-theme.json': JSON.stringify({ short:'Synthetic',version:'1.0',configuration:{type:'raw',html:'<script>bad</script>'} }) }));
  await assert.rejects(buildKomariPackage(await entry(raw), raw), { code: 'MANIFEST_CONFIGURATION' });
});

test('ZIP rejects traversal, absolute paths, backslashes, encoded paths and case aliases', () => {
  for (const path of ['../outside.js','/outside.js','a\\outside.js','a/%2e%2e/out.js','a/../out.js','a//out.js']) {
    assert.throws(() => safePackagePath(path), { code: 'PACKAGE_PATH' });
    assert.throws(() => readStaticZip(zipSync({[path]:enc.encode('x')})), { code: 'PACKAGE_PATH' });
  }
  assert.throws(() => readStaticZip(zipSync({'index.html':enc.encode('a'),'INDEX.html':enc.encode('b')})), { code: 'ZIP_DUPLICATE' });
});

test('ZIP rejects symlinks and local/central path mismatches before decompression', () => {
  const link = zipSync({'link':enc.encode('target')}); const at = centralOffset(link);
  new DataView(link.buffer).setUint32(at + 38, 0xa1ff0000, true);
  assert.throws(() => readStaticZip(link), { code:'ZIP_SPECIAL_FILE' });
  const mismatch = zipSync({'asset.js':enc.encode('safe')}); mismatch[30] = 'b'.charCodeAt(0);
  assert.throws(() => readStaticZip(mismatch), { code:'ZIP_HEADER_MISMATCH' });
});

test('ZIP size and ratio claims cannot hide actual expansion or bad CRC', () => {
  const bomb = zipSync({'bomb.txt':new Uint8Array(100_000)}, {level:9});
  assert.throws(() => readStaticZip(bomb), { code:'ZIP_EXPANSION' });
  const forged = zipSync({'bomb.txt':new Uint8Array(100_000)}, {level:9}); const central = centralOffset(forged); const view = new DataView(forged.buffer);
  view.setUint32(22,1,true); view.setUint32(central+24,1,true);
  assert.throws(() => readStaticZip(forged), { code:'ZIP_EXPANSION' });
  const corrupted = zipSync({'asset.txt':enc.encode('abc')}, {level:0}); corrupted[30+'asset.txt'.length] ^= 1;
  assert.throws(() => readStaticZip(corrupted), { code:'ZIP_CHECKSUM' });
});

test('resource validation rejects missing chunks and external scripts, not harmless navigation links', async () => {
  for (const markup of ['<script src="/assets/missing.js"></script>', '<script src="https://evil.test/payload.js"></script>']) {
    const archive = zipSync(source({'dist/index.html':markup}));
    await assert.rejects(buildKomariPackage(await entry(archive),archive), {code:markup.includes('https')?'EXTERNAL_ASSET':'ASSET_MISSING'});
  }
  const files = [{path:'index.html',bytes:enc.encode('<a href="https://example.com">link</a>'),contentType:contentType('index.html')!}];
  assert.doesNotThrow(()=>validateStaticReferences(files));
});

test('server-side installer resolves catalog IDs and never uses user URLs as a package location', async () => {
  let calls=0;
  await assert.rejects(installCatalogTheme('komari','https://evil.test/p.zip',{fetcher:async()=>{calls++;return Response.json({schema:1,themes:[]});}}),{code:'THEME_NOT_FOUND'});
  assert.equal(calls,1);
});

async function gitBlob(bytes: Uint8Array): Promise<string> {
  const prefix=enc.encode(`blob ${bytes.length}\0`), all=new Uint8Array(prefix.length+bytes.length);all.set(prefix);all.set(bytes,prefix.length);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-1',all))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
test('CFSM pins the build branch, verifies each Git blob, and refuses truncated trees', async () => {
  const commit='a'.repeat(40), data={'index.html':enc.encode('<p>test</p>'),'LICENSE':enc.encode(MIT)};
  const tree=await Promise.all(Object.entries(data).map(async([path,bytes])=>({path,type:'blob',mode:'100644',sha:await gitBlob(bytes),size:bytes.length})));
  const seen:string[]=[];
  const fetcher=async(input:string|URL|Request)=>{
    const url=String(input);seen.push(url);
    if(url.endsWith('/themes.json'))return Response.json({schema:1,themes:[{id:'synthetic',title:'Synthetic',url:'https://github.com/example/theme',branch:'build'}]});
    if(url.includes('/commits/'))return Response.json({sha:commit});
    if(url.includes('/git/trees/'))return Response.json({truncated:false,tree});
    const path=url.endsWith('/LICENSE')?'LICENSE':'index.html';
    assert.ok(url.includes(`/${commit}/`));return new Response(data[path]);
  };
  const pkg=await installCatalogTheme('cfsm','synthetic',{fetcher});
  assert.equal(pkg.pinnedVersion,commit);assert.equal(pkg.license.spdx,'MIT');assert.equal(pkg.compatibility,'unverified');
  assert.ok(seen.some(url=>url.endsWith('/commits/build')));
  await assert.rejects(installCatalogTheme('cfsm','synthetic',{fetcher:async(input,init)=>String(input).includes('/git/trees/')?Response.json({truncated:true,tree}):fetcher(input)}),{code:'CFSM_TREE'});
  await assert.rejects(installCatalogTheme('cfsm','synthetic',{fetcher:async(input)=>String(input).endsWith('/index.html')?new Response('<p>oops</p>'):fetcher(input)}),{code:'CFSM_BLOB_HASH'});
});

test('audited Emerald license does not silently apply to a different build commit', async () => {
  const commit='b'.repeat(40), bytes=enc.encode('<p>new build</p>'), hash=await gitBlob(bytes);let assetReads=0;
  await assert.rejects(installCatalogTheme('cfsm','emerald',{fetcher:async(input)=>{
    const url=String(input);
    if(url.endsWith('/themes.json'))return Response.json({schema:1,themes:[{id:'emerald',title:'Emerald',url:'https://github.com/Tokinx/cf-server-monitor-theme-emerald',branch:'build'}]});
    if(url.includes('/commits/'))return Response.json({sha:commit});
    if(url.includes('/git/trees/'))return Response.json({truncated:false,tree:[{path:'index.html',type:'blob',mode:'100644',sha:hash,size:bytes.length}]});
    assetReads++;return new Response(bytes);
  }}),{code:'LICENSE_REQUIRED'});
  assert.equal(assetReads,0);
});

test('ZIP comment signatures cannot substitute a second unaudited central directory', () => {
  const original=zipSync({'safe.txt':enc.encode('safe')});
  const bytes=new Uint8Array(original.length+22);bytes.set(original);
  const view=new DataView(bytes.buffer);view.setUint16(original.length-2,22,true);
  view.setUint32(original.length,0x06054b50,true);view.setUint16(bytes.length-2,1,true);
  assert.equal(new TextDecoder().decode(readStaticZip(bytes).get('safe.txt')),'safe');
});

test('JavaScript references use tokens: prose and comments are not imports', async () => {
  const prose = zipSync(source({ 'dist/assets/app.js': `// import './absent-comment.js';\nconst x='text from "./absent-prose.js"'; const from=':[{from:C()}],'; export { x };` }));
  await assert.doesNotReject(buildKomariPackage(await entry(prose),prose));
  for (const code of [`import './missing.js';`,`import x from './missing.js';`,`export {x} from './missing.js';`,`import('./missing.js');`]) {
    const archive=zipSync(source({'dist/assets/app.js':code}));
    await assert.rejects(buildKomariPackage(await entry(archive),archive),{code:'ASSET_MISSING'});
  }
});

test('independent license evidence cannot come from another repo or omit an immutable commit', async () => {
  const values=source();delete values.LICENSE;const archive=zipSync(values),e=await entry(archive);
  for(const url of ['https://raw.githubusercontent.com/other/project/'+'a'.repeat(40)+'/LICENSE','https://raw.githubusercontent.com/example/synthetic/main/LICENSE']) {
    await assert.rejects(buildKomariPackage(e,archive,{licenseEvidence:{url,sha256:await sha256(enc.encode(MIT))},fetcher:async()=>{throw new Error('must not fetch');}}),{code:'LICENSE_EVIDENCE'});
  }
});

test('installation re-reads the UI-observed catalog commit and never drifts to moving main', async () => {
  const {fetchCatalog}=await import('../src/themes/catalog.ts');
  const archive=zipSync(source()),hash=await sha256(archive);
  const shownRevision='c'.repeat(40),nextRevision='d'.repeat(40);let current=shownRevision;const urls:string[]=[];
  const fetcher=async(input:string|URL|Request)=>{
    const url=String(input);urls.push(url);
    if(url.includes('/commits/main'))return Response.json({sha:current});
    if(url.endsWith('/v1.json')){
      const old=url.includes(`/${shownRevision}/`);
      return Response.json({schema:1,themes:[{short:'Synthetic',name:'Synthetic',version:old?'1.0':'2.0',url:'https://github.com/example/synthetic',download:`https://github.com/example/synthetic/releases/download/${old?'v1':'v2'}/p.zip`,sha256:hash}]});
    }
    assert.equal(url,'https://github.com/example/synthetic/releases/download/v1/p.zip');return new Response(new Uint8Array(archive));
  };
  const shown=await fetchCatalog('komari',fetcher,{latest:true});current=nextRevision;
  const pkg=await installCatalogTheme('komari','Synthetic',{fetcher,expectedCatalogRevision:shown.catalogRevision});
  assert.equal(pkg.catalogRevision,shownRevision);assert.ok(pkg.catalogSource.includes(`/${shownRevision}/`));assert.ok(pkg.pinnedVersion.startsWith('1.0@'));
  assert.equal(urls.filter(url=>url.includes('/commits/main')).length,1);
  assert.equal(urls.filter(url=>url.includes(`/${shownRevision}/v1.json`)).length,2);
  assert.equal(urls.some(url=>url.includes(nextRevision)),false);
});
