import test from 'node:test';
import assert from 'node:assert/strict';
import { cssDependencySources,semanticUiDependencyFingerprint } from '../src/themes/resource-sources-css.ts';
import { KOMARI_PUBLIC_SOURCES, KOMARI_LEGACY_PUBLIC_REVISION, KOMARI_PUBLIC_REVISION, CFSM_PUBLIC_SOURCES, CFSM_PUBLIC_REVISION } from '../src/themes/default-resources.ts';

test('CSS dependency fingerprint ignores unrelated styles but preserves glyphs, flags, font URLs and declarations',async()=>{
  const enc=new TextEncoder();
  const css=`/* library */ @font-face {font-family:Icons;src:url("themes/default/assets/fonts/icons.woff2")}i.icon.example:before{content:"\\f001"}i.flag.example:before{background-position:1px 2px}`;
  const fingerprint=await semanticUiDependencyFingerprint(enc.encode(css));assert.ok(fingerprint);
  assert.equal(await semanticUiDependencyFingerprint(enc.encode(css+'body{color:red}')),fingerprint);
  for(const changed of [css.replace('f001','f002'),css.replace('icons.woff2','other.woff2'),css.replace('1px 2px','2px 1px'),css+'i.icon.example:before{content:"different"}'])
    assert.notEqual(await semanticUiDependencyFingerprint(enc.encode(changed)),fingerprint);
  assert.equal(await semanticUiDependencyFingerprint(enc.encode('body{color:red}')),null);
  assert.equal(await semanticUiDependencyFingerprint(enc.encode(css+'}')),null);
  for(const path of ['semantic.css','../semantic.css','/semantic.css','a//semantic.css','a/../semantic.css','a%2fsemantic.css','semantic.js'])
    assert.deepEqual(await cssDependencySources(path,enc.encode(css)),{});
});

test('historical PNG resource paths retain independently pinned original bytes',()=>{
  const names=['os-OpenCloudOS','os-astar','os-istore'];
  for(const name of names){
    const png=KOMARI_PUBLIC_SOURCES[`assets/logo/${name}.png`]!,webp=KOMARI_PUBLIC_SOURCES[`assets/logo/${name}.webp`]!;
    assert.ok(png.url.includes(KOMARI_LEGACY_PUBLIC_REVISION));assert.ok(png.url.endsWith(`${name}.png`));
    assert.ok(webp.url.includes(KOMARI_PUBLIC_REVISION));assert.ok(webp.url.endsWith(`${name}.webp`));
    assert.notEqual(png.sha256,webp.sha256);
  }
  assert.equal(Object.hasOwn(KOMARI_PUBLIC_SOURCES,'assets/logo/not-a-real-system.png'),false);
});

test('CFSM default resource index contains only explicitly pinned public display images',()=>{
  assert.equal(Object.keys(CFSM_PUBLIC_SOURCES).length,299);
  for(const [path,source] of Object.entries(CFSM_PUBLIC_SOURCES)){
    assert.match(path,/^(?:flags\/[a-z0-9-]+\.svg|os-icons\/[^/]+\.(?:svg|png|webp|ico)|favicon\.(?:ico|png))$/);
    assert.equal(source.url,`https://raw.githubusercontent.com/huilang-me/CF-Server-Monitor/${CFSM_PUBLIC_REVISION}/public/${path}`);
    assert.match(source.sha256,/^[a-f0-9]{64}$/);
  }
  assert.ok(CFSM_PUBLIC_SOURCES['flags/us.svg']);
  assert.ok(CFSM_PUBLIC_SOURCES['os-icons/os-debian.svg']);
  for(const path of ['flags/US.svg','index.html','admin/index.html','assets/app.js','../flags/us.svg'])assert.equal(Object.hasOwn(CFSM_PUBLIC_SOURCES,path),false);
});
