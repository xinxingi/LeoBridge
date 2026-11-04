import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readdir, rm, mkdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const exec=promisify(execFile);
const root=resolve(import.meta.dirname,'..');
const args=process.env.BRIDGE_TEST_BUILT_NODE==='1'?[join(root,'dist/node.js')]:['--import',import.meta.resolve('tsx'),join(root,'src/runtime/node.ts')];
test('configuration preflight validates without listening, state writes or leaking secrets',async t=>{
  const cwd=await mkdtemp(join(tmpdir(),'leobridge-preflight-'));
  t.after(()=>rm(cwd,{recursive:true,force:true}));
  await writeFile(join(cwd,'.dev.vars'),'BRIDGE_NODE_MODE=invalid\n');
  const env={NODE_ENV:'production',BRIDGE_NODE_MODE:'proxy',BRIDGE_ROUTING:'single',BRIDGE_ORIGIN:'https://monitor.example.test',BRIDGE_LISTEN_PORT:'8787',BRIDGE_ACCESS:'public',BRIDGE_PASSWORD:'synthetic-secret-do-not-log',BRIDGE_THEME_STORE:join(cwd,'state')};
  const result=await exec(process.execPath,[...args,'--check-config'],{cwd,env,timeout:10_000});
  assert.deepEqual(JSON.parse(result.stdout),{valid:true,mode:'proxy',routing:'single',listenHost:'127.0.0.1',listenPort:8787,origin:env.BRIDGE_ORIGIN,adminOrigin:env.BRIDGE_ORIGIN,previewOrigin:env.BRIDGE_ORIGIN});
  assert.equal(result.stderr,'');
  const direct=await exec(process.execPath,[...args,'--check-config'],{cwd,env:{...env,BRIDGE_NODE_MODE:'direct'},timeout:10_000});
  assert.equal(JSON.parse(direct.stdout).mode,'direct');
  for(const overrides of [{BRIDGE_NODE_MODE:'invalid'},{BRIDGE_ORIGIN:'https://user:synthetic-secret-do-not-log@monitor.example.test'},{BRIDGE_ORIGIN:'https://monitor.example.test/admin/'}]){
    await assert.rejects(exec(process.execPath,[...args,'--check-config'],{cwd,env:{...env,...overrides},timeout:10_000}),error=>{
      const failure=error as Error & {code:number;stdout:string;stderr:string};
      assert.equal(failure.code,1);assert.equal(failure.stdout,'');
      assert.match(failure.stderr,/configuration is invalid \[(NODE|MANAGEMENT)_CONFIGURATION\]/);
      assert.doesNotMatch(failure.stderr,/synthetic-secret-do-not-log/);
      if(overrides.BRIDGE_NODE_MODE)assert.match(failure.stderr,/BRIDGE_NODE_MODE/);
      return true;
    });
  }
  // The real startup path must fail equally early, not just the optional command.
  await assert.rejects(exec(process.execPath,args,{cwd,env:{...env,BRIDGE_NODE_MODE:'invalid'},timeout:10_000}),error=>{
    assert.match((error as {stderr:string}).stderr,/BRIDGE_NODE_MODE/);return true;
  });
  assert.deepEqual(await readdir(cwd),['.dev.vars']);
  await mkdir(join(cwd,'work/theme-store'),{recursive:true});
  const legacyEnv={...env};delete (legacyEnv as Partial<typeof env>).BRIDGE_THEME_STORE;
  await assert.rejects(exec(process.execPath,[...args,'--check-config'],{cwd,env:legacyEnv,timeout:10_000}),error=>{
    assert.match((error as {stderr:string}).stderr,/STORAGE_MIGRATION/);return true;
  });
  assert.deepEqual((await readdir(cwd)).sort(),['.dev.vars','work']);
});

test('startup rejects unwritable data but does not require writable temporary storage', async t=>{
  if(process.getuid?.()===0||process.platform==='win32')return t.skip('Requires unprivileged POSIX permissions');
  const cwd=await mkdtemp(join(tmpdir(),'leobridge-storage-startup-'));
  const data=join(cwd,'data'),temporary=join(cwd,'tmp'),assets=join(cwd,'assets');
  await mkdir(data);await mkdir(temporary);await mkdir(join(assets,'_management'),{recursive:true});
  await writeFile(join(assets,'index.json'),'[]');
  await writeFile(join(assets,'_management/index.html'),'Synthetic management');
  t.after(async()=>{await chmod(data,0o700);await chmod(temporary,0o700);await rm(cwd,{recursive:true,force:true});});
  const env={NODE_ENV:'production',BRIDGE_THEME_STORE:data,BRIDGE_ASSETS_DIR:assets,TMPDIR:temporary};
  await chmod(data,0o500);
  // Configuration validation remains read-only; real startup checks data writes.
  await exec(process.execPath,[...args,'--check-config'],{cwd,env,timeout:10_000});
  await assert.rejects(exec(process.execPath,args,{cwd,env,timeout:10_000}),error=>{
    const failure=error as {code:number;stdout:string;stderr:string};
    assert.equal(failure.code,1);assert.equal(failure.stdout,'');
    assert.match(failure.stderr,/STORAGE_PERMISSION/);
    assert.match(failure.stderr,/UID\/GID/);
    return true;
  });
  await chmod(data,0o700);await chmod(temporary,0o500);
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
  const port=(reservation.address() as {port:number}).port;
  await new Promise<void>(done=>reservation.close(()=>done()));
  const child=spawn(process.execPath,args,{cwd,env:{...env,BRIDGE_LISTEN_PORT:String(port)},stdio:['ignore','pipe','pipe','ipc']});
  let logs='';child.stdout!.on('data',chunk=>logs+=chunk);child.stderr!.on('data',chunk=>logs+=chunk);
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const stopped=once(child,'exit');child.kill('SIGKILL');await stopped;}});
  await new Promise<void>((accept,reject)=>{
    const timer=setTimeout(()=>reject(new Error(logs||'startup timeout')),10_000);
    child.once('error',error=>{clearTimeout(timer);reject(error)});
    child.once('exit',()=>{clearTimeout(timer);reject(new Error(logs))});
    child.once('message',message=>{clearTimeout(timer);assert.equal((message as {type:string}).type,'ready');accept()});
  });
  assert.equal(await (await fetch(`http://127.0.0.1:${port}/admin/`)).text(),'Synthetic management');
  const stopped=once(child,'exit');child.kill('SIGTERM');await stopped;
  assert.equal(child.exitCode,0);
});
