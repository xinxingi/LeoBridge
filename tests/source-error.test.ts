import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { sourceErrorHtml } from '../src/app/source-error.ts';
import { previewHtml } from '../src/app/preview.ts';

class Element {
  children:Element[]=[];style={cssText:''};textContent='';attributes:Record<string,string>={};parent?:Element;shadow?:Element;
  append(...children:Element[]){for(const child of children){child.parent=this;this.children.push(child);}}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);}
  setAttribute(key:string,value:string){this.attributes[key]=value;}
  attachShadow(){return this.shadow=new Element();}
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('native source alert preserves fetch responses, ignores unrelated requests and clears on recovery',async()=>{
  const origin='https://view.test',body=new Element();
  const calls:unknown[][]=[];
  let payload:unknown={code:'UPSTREAM_NOT_FOUND',message:'Token 可能已失效 <img src=x onerror=alert(1)>'},ok=false;
  const replies:{ok:boolean;clone:()=>{json:()=>Promise<unknown>}}[]=[];
  const context:any={URL,Request,location:{origin},document:{baseURI:origin+'/',body,createElement:()=>new Element()},fetch:async(...args:unknown[])=>{
    calls.push(args);const data=payload;const response={ok,clone:()=>({json:async()=>data})};replies.push(response);return response;
  }};
  context.window=context;
  const html=sourceErrorHtml('<html><head><script src="/theme.js"></script></head><body></body></html>');
  assert.ok(html.indexOf('originalFetch')<html.indexOf('src="/theme.js"'));
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)![1],context);
  for(const url of ['https://other.test/api/probe','/api/series','/admin/api/source/check'])await context.fetch(url);
  await flush();assert.equal(body.children.length,0);
  const request=new Request(origin+'/api/probe?__preview='+'a'.repeat(32));const init={credentials:'same-origin'};
  assert.equal(await context.fetch(request,init),replies.at(-1));await flush();
  assert.deepEqual(calls.at(-1),[request,init]);
  const panel=body.children[0].shadow!.children[0];assert.equal(panel.attributes.role,'alert');
  assert.equal(panel.children[0].textContent,'请检查数据源 Token');
  assert.equal(panel.children[1].textContent,(payload as {message:string}).message);
  assert.equal(panel.children[1].children.length,0);
  await context.fetch('/api/probe');await flush();assert.equal(body.children.length,1);
  ok=true;payload={enabled:true,servers:[]};await context.fetch('/api/probe');await flush();assert.equal(body.children.length,0);
  ok=false;payload={code:'UPSTREAM_AUTH',message:'Token 可能已失效'};await context.fetch('/api/probe');await flush();assert.equal(body.children.length,1);
  payload={code:'UPSTREAM_HTTP',message:'HTTP 500'};await context.fetch('/api/probe');await flush();assert.equal(body.children.length,0);
});

test('preview wrapper and source alert compose without changing installation selection',()=>{
  const html=previewHtml(sourceErrorHtml('<head><script src="/theme.js"></script></head>'),'a'.repeat(32));
  const calls:string[]=[];
  class Transport {open(){}}
  const origin='https://view.test';
  const context:any={URL,Request,location:{origin},document:{baseURI:origin+'/'},history:{pushState(){},replaceState(){}},XMLHttpRequest:Transport,WebSocket:Transport,fetch:(url:string)=>{calls.push(url);return Promise.resolve({ok:true,clone:()=>({json:async()=>({enabled:true})})});}};
  context.window=context;
  for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))runInNewContext(match[1],context);
  context.fetch('/api/probe');assert.equal(calls[0],origin+'/api/probe?__preview='+'a'.repeat(32));
});
