import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG_SOURCES, fetchCatalog, fetchPublicBytes, parseCfsmCatalog, parseKomariCatalog, repositoryParts, validatePublicUrl } from '../src/themes/catalog.ts';

test('catalogs preserve their different shapes and separate discovery from validation', () => {
  const cfsm = parseCfsmCatalog({ schema: 1, themes: [{ id: 'paper', title: 'Paper', url: 'https://github.com/example/theme', branch: 'build' }] })[0]!;
  assert.equal(cfsm.canAttemptInstall, true); assert.equal(cfsm.licenseStatus, 'unverified'); assert.equal(cfsm.compatibility, 'unverified'); assert.equal(cfsm.branch, 'build');
  const komari = parseKomariCatalog({ schema: 1, themes: [{ short: 'Paper', name: { en: 'Paper', 'zh-CN': '纸张' }, version: '1.0', url: 'https://github.com/example/theme', download: 'https://github.com/example/theme/releases/download/v1/theme.zip', sha256: 'a'.repeat(64) }] })[0]!;
  assert.equal(komari.name, '纸张'); assert.equal(komari.version, '1.0'); assert.equal(komari.canAttemptInstall, true);
  assert.equal(komari.sourceId, 'komari-official');
});

test('unsupported catalog packages remain visible with reasons; no arbitrary URL installation', () => {
  const [entry] = parseKomariCatalog({ schema: 1, themes: [{ short: 'private-host', version: '1', url: 'https://github.com/example/theme', download: 'http://127.0.0.1/package.zip', sha256: 'bad' }] });
  assert.equal(entry!.canAttemptInstall, false); assert.deepEqual(entry!.blockReasons, ['UNSUPPORTED_DOWNLOAD_HOST', 'SHA256_REQUIRED']);
  assert.equal(parseCfsmCatalog({ schema: 1, themes: [{ id: 'x', url: 'https://evil.test/a', branch: 'main' }] })[0]!.canAttemptInstall, false);
  assert.throws(() => parseCfsmCatalog({ schema: 2, themes: [] }), { code: 'CATALOG_SCHEMA' });
  assert.throws(() => parseKomariCatalog({ schema: 1, themes: [{ short: 'Name' }, { short: 'name' }] }), { code: 'CATALOG_DUPLICATE' });
});

test('fixed catalogs do not accept a user supplied source URL', async () => {
  const seen: string[] = [];
  const catalog = await fetchCatalog('cfsm', async input => { seen.push(String(input)); return Response.json({ schema: 1, themes: [] }); });
  assert.deepEqual(seen, [CATALOG_SOURCES.cfsm.url]); assert.equal(catalog.pinnedVersion.length, 40);
  await assert.rejects(fetchCatalog('unknown' as never), { code: 'ECOSYSTEM' });
});

test('public downloader rejects private hosts, credentials, alternate ports and lookalike domains', () => {
  for (const url of ['http://github.com/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://169.254.169.254/a', 'https://github.com.evil.test/a', 'https://user:secret@github.com/a', 'https://github.com:444/a', 'https://github.com/a#secret']) assert.throws(() => validatePublicUrl(url), { code: 'PUBLIC_URL' });
  assert.equal(repositoryParts('https://github.com/owner/repo.git')?.url, 'https://github.com/owner/repo');
  assert.equal(repositoryParts('https://github.com/owner/repo/tree/main'), null);
});

test('redirects are manually revalidated before any next request', async () => {
  let count = 0;
  await assert.rejects(fetchPublicBytes('https://github.com/owner/repo', { fetcher: async (_input, init) => { count++; assert.equal(init!.redirect, 'manual'); assert.equal(new Headers(init!.headers).has('authorization'), false); return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } }); } }), { code: 'PUBLIC_URL' });
  assert.equal(count, 1);
  const calls: string[] = [];
  const bytes = await fetchPublicBytes('https://github.com/owner/repo/releases/download/v1/p.zip', { fetcher: async input => { calls.push(String(input)); return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/asset?pinned=yes' } }) : new Response(new Uint8Array([1,2,3])); } });
  assert.deepEqual([...bytes], [1,2,3]); assert.equal(calls.length, 2);
});

test('stream byte limits apply without content-length and abort messages do not leak URLs', async () => {
  let cancelled = false;
  await assert.rejects(fetchPublicBytes('https://raw.githubusercontent.com/a/b/c/index', { maxBytes: 3, fetcher: async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(10)); }, cancel() { cancelled = true; } })) }), { code: 'DOWNLOAD_SIZE' });
  assert.equal(cancelled, true);
  await assert.rejects(fetchPublicBytes('https://github.com/owner/repo', { fetcher: async () => { throw new Error('secret URL internal failure'); } }), error => (error as Error).message === '公开主题来源暂时无法读取。');
});

test('latest discovery resolves official main then immutable JSON; explicit refresh sees new entries', async () => {
  let current='a'.repeat(40);const urls:string[]=[];
  const fetcher=async(input:string|URL|Request)=>{
    const url=String(input);urls.push(url);
    if(url==='https://api.github.com/repos/huilang-me/CFSM-Theme-Store/commits/main')return Response.json({sha:current});
    assert.equal(url,`https://raw.githubusercontent.com/huilang-me/CFSM-Theme-Store/${current}/themes.json`);
    return Response.json({schema:1,themes:[{id:current[0],title:current[0],url:'https://github.com/example/theme',branch:'build'}]});
  };
  const first=await fetchCatalog('cfsm',fetcher,{latest:true});
  assert.equal(first.catalogRevision,'a'.repeat(40));assert.equal(first.entries[0]!.catalogRevision,first.catalogRevision);
  first.entries[0]!.name='caller mutation';
  current='b'.repeat(40);
  const cached=await fetchCatalog('cfsm',fetcher,{latest:true});
  assert.equal(cached.fromCache,true);assert.equal(cached.entries[0]!.name,'a');assert.equal(urls.length,2);
  const refreshed=await fetchCatalog('cfsm',fetcher,{refresh:true});
  assert.equal(refreshed.catalogRevision,current);assert.equal(refreshed.entries[0]!.id,'b');assert.equal(refreshed.fromCache,false);assert.equal(urls.length,4);
});

test('short latest cache expires and concurrent discovery coalesces', async () => {
  const originalNow=Date.now;let clock=originalNow(),calls=0;
  Date.now=()=>clock;
  try{
    const fetcher=async(input:string|URL|Request)=>{
      calls++; await Promise.resolve();
      return String(input).includes('/commits/')?Response.json({sha:'c'.repeat(40)}):Response.json({schema:1,themes:[]});
    };
    await Promise.all([fetchCatalog('komari',fetcher,{latest:true}),fetchCatalog('komari',fetcher,{latest:true})]);
    assert.equal(calls,2);
    await fetchCatalog('komari',fetcher,{latest:true});assert.equal(calls,2);
    clock+=60_001;
    const fresh=await fetchCatalog('komari',fetcher,{latest:true});assert.equal(calls,4);assert.equal(fresh.fromCache,false);
  }finally{Date.now=originalNow;}
});

test('revision reads stay in the official repository and invalid revisions never trigger fetch', async () => {
  const urls:string[]=[];const fetcher=async(input:string|URL|Request)=>{urls.push(String(input));return Response.json({schema:1,themes:[]});};
  const revision='D'.repeat(40);
  const catalog=await fetchCatalog('komari',fetcher,{revision});
  assert.equal(catalog.catalogRevision,revision.toLowerCase());assert.deepEqual(urls,[`https://raw.githubusercontent.com/komari-monitor/theme-market/${revision.toLowerCase()}/v1.json`]);
  for(const value of ['main','../secret','https://github.com/other/repo','a'.repeat(39),''])await assert.rejects(fetchCatalog('komari',fetcher,{revision:value}),{code:'CATALOG_REVISION'});
  await assert.rejects(fetchCatalog('komari',fetcher,{revision,latest:true}),{code:'CATALOG_OPTIONS'});
  assert.equal(urls.length,1);
});

test('a failed explicit refresh is visible and cannot masquerade as an old successful refresh', async () => {
  let broken=false,calls=0;
  const fetcher=async(input:string|URL|Request)=>{calls++;return String(input).includes('/commits/')?Response.json({sha:broken?'invalid':'e'.repeat(40)}):Response.json({schema:1,themes:[]});};
  await fetchCatalog('cfsm',fetcher,{latest:true});broken=true;
  await assert.rejects(fetchCatalog('cfsm',fetcher,{refresh:true}),{code:'CATALOG_COMMIT',status:502});
  await assert.rejects(fetchCatalog('cfsm',fetcher,{latest:true}),{code:'CATALOG_COMMIT'});
  assert.equal(calls,4);
});
