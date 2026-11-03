import test from 'node:test';
import assert from 'node:assert/strict';
import {createDevTransport} from '../src/runtime/proxy.ts';
test('local development proxy explicitly configures both Node HTTP and WebSocket transports',async()=>{
  const direct=createDevTransport(undefined,30000);
  assert.equal(direct.proxied,false);assert.equal(direct.webSocket,undefined);await direct.http.close();
  const proxy=createDevTransport('http://127.0.0.1:7897',30000);
  assert.equal(proxy.proxied,true);assert.ok(proxy.webSocket);assert.equal(proxy.http.constructor.name,'ProxyAgent');
  await proxy.http.close();proxy.webSocket?.destroy();
});
test('proxy config rejects credentials, non-loopback services, unsupported protocols and URL suffixes',()=>{
  for(const url of ['socks5://127.0.0.1:7897','http://elsewhere.invalid','http://user:secret@localhost','http://localhost/path','http://localhost?x=1','invalid'])assert.throws(()=>createDevTransport(url,30000));
});
