import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { previewHtml } from '../src/app/preview.ts';

test('preview bootstrap preserves request bodies, socket protocols, SPA routes and external URLs',async()=>{
  const id='a'.repeat(32),origin='https://single.example.test';
  const html=previewHtml('<!doctype html><html><head><meta name="referrer" content="no-referrer"><script src="/app.js"></script></head></html>',id);
  assert.ok(html.indexOf('function(parameter,id)')<html.indexOf('src="/app.js"'));
  assert.doesNotMatch(html,/content="no-referrer"/);
  const code=html.match(/<script>([\s\S]*?)<\/script>/)![1]!;
  const calls:unknown[][]=[];
  class Transport {static OPEN=1;constructor(...args:unknown[]){calls.push(args);}}
  class XHR {open(...args:unknown[]){calls.push(args);}}
  const context:any={URL,Request,location:{origin},document:{baseURI:origin+'/?__preview='+id},
    fetch:async(...args:unknown[])=>calls.push(args),WebSocket:Transport,EventSource:Transport,XMLHttpRequest:XHR,
    history:{pushState:(...args:unknown[])=>calls.push(args),replaceState:(...args:unknown[])=>calls.push(args)}};
  context.window=context;runInNewContext(code,context);
  const original=new Request(origin+'/api/rpc2',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"jsonrpc":"2.0"}'});
  await context.fetch(original,{credentials:'omit'});
  const forwarded=calls.pop()!;const request=forwarded[0] as Request;
  assert.equal(request.url,origin+'/api/rpc2?__preview='+id);assert.equal(request.method,'POST');
  assert.equal(request.headers.get('content-type'),'application/json');assert.equal(await request.text(),'{"jsonrpc":"2.0"}');assert.deepEqual(forwarded[1],{credentials:'omit'});
  await context.fetch('/api/data?hours=1');assert.equal(calls.pop()![0],origin+'/api/data?hours=1&__preview='+id);
  await context.fetch('https://external.invalid/data');assert.equal(calls.pop()![0],'https://external.invalid/data');
  new context.WebSocket('wss://single.example.test/api/rpc2',['jsonrpc']);
  assert.deepEqual(calls.pop(),['wss://single.example.test/api/rpc2?__preview='+id,['jsonrpc']]);assert.equal(context.WebSocket.OPEN,1);
  new context.XMLHttpRequest().open('POST','/api/rpc2',false,'user','pass');
  assert.deepEqual(calls.pop(),['POST',origin+'/api/rpc2?__preview='+id,false,'user','pass']);
  context.history.pushState({node:1},'','/instance/node?range=1#cpu');
  assert.deepEqual(calls.pop(),[{node:1},'',origin+'/instance/node?range=1&__preview='+id+'#cpu']);
  context.history.replaceState(null,'',null);assert.deepEqual(calls.pop(),[null,'',null]);
});
