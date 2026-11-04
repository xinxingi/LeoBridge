import test from 'node:test';
import assert from 'node:assert/strict';
import { detectNativeAppearances, NativeAppearanceIndex } from '../src/themes/native-appearances.ts';
import type { Installation, ThemeStore } from '../src/themes/store.ts';
const asset=(path:string,text:string)=>({path,bytes:new TextEncoder().encode(text)});
test('installed CSS selectors and literal renderer branches discover version-specific appearances',()=>{
  const old=[asset('main.css',':root.theme-pixel{color:red}:root.theme-flat .card{border:0}:root.theme-anime.dark{color:pink}')];
  assert.deepEqual(detectNativeAppearances(old).map(o=>o.id),['anime','flat','pixel']);
  const latest=[...old,asset('new.css',':root.theme-sweet{color:pink} @media (width>1px){html.theme-future-glass .card{color:blue}}'),asset('main.js','if(data.appearance?.theme === "premium")render();')];
  assert.deepEqual(detectNativeAppearances(latest).map(o=>o.id),['anime','flat','future-glass','pixel','premium','sweet']);
  assert.equal(detectNativeAppearances(latest).find(o=>o.id==='future-glass')?.label,'future-glass');
  assert.deepEqual(detectNativeAppearances([asset('reverse.js','if("premium"===e.appearance.theme)render()')]).map(o=>o.id),['premium']);
});
test('comments, quoted examples, arbitrary theme classes and nonliteral branches do not invent options',()=>{
  const values=[asset('main.css','/* :root.theme-comment {} */ .theme-switch{content:":root.theme-string{}"} :root.theme-source{} :root.theme-custom{} :root.theme-flat.dark{color:red}'),asset('main.js','// data.appearance.theme==="fake"\nconst example="e.appearance.theme===\\"bogus\\"";if(data.appearance.theme===name)render();if(x.theme==="wrong")render();')];
  assert.deepEqual(detectNativeAppearances(values).map(o=>o.id),['flat']);
});
test('existing installation discovery is local, cached by package and retries missing assets without changing state',async()=>{
  const index=new NativeAppearanceIndex(),file=asset('main.css',':root.theme-sweet{color:pink}');
  let calls=0,available=false;
  const store={asset:async()=>{calls++;return available?{...file,contentType:'text/css'}:null}} as unknown as ThemeStore;
  const item={id:'a'.repeat(32),pinnedVersion:'a'.repeat(40),files:{'main.css':{size:file.bytes.length,contentType:'text/css'}}} as unknown as Installation;
  assert.equal((await index.read(store,item)).status,'unavailable');available=true;
  const found=await index.read(store,item);assert.deepEqual(found.options,[{id:'sweet',label:'天真'}]);
  found.options.length=0;
  assert.equal((await index.read(store,item)).options.length,1);assert.equal(calls,2);
  await index.read(store,{...item,id:'b'.repeat(32)});assert.equal(calls,3);
});

test('unknown appearance labels do not resolve object prototype properties',()=>{
  assert.deepEqual(detectNativeAppearances([asset('main.css',':root.theme-__proto__{color:red}')]),[{id:'__proto__',label:'__proto__'}]);
});
