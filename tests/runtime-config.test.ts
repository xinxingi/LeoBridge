import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
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
