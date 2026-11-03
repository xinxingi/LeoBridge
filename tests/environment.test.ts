import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRuntimeEnv } from '../src/runtime/environment.ts';
import { BridgeError } from '../src/core/errors.ts';
test('production ignores development secrets and explicit config has predictable environment precedence',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'leobridge-env-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  await writeFile(join(directory,'.dev.vars'),'MMWX_PROBE_TOKEN=synthetic-dev-secret\n');
  assert.equal((await loadRuntimeEnv({BRIDGE_NODE_MODE:'proxy'},directory)).MMWX_PROBE_TOKEN,undefined);
  assert.equal((await loadRuntimeEnv({},directory)).MMWX_PROBE_TOKEN,'synthetic-dev-secret');
  await writeFile(join(directory,'production.env'),"MMWX_PROBE_TOKEN='synthetic-$literal'\nBRIDGE_TITLE=file-title\nBRIDGE_BINDINGS='[]'\n");
  const config=await loadRuntimeEnv({BRIDGE_NODE_MODE:'proxy',BRIDGE_ENV_FILE:'production.env',BRIDGE_TITLE:'environment-title'},directory);
  assert.equal(config.MMWX_PROBE_TOKEN,'synthetic-$literal');assert.equal(config.BRIDGE_TITLE,'environment-title');assert.equal(config.BRIDGE_BINDINGS,'[]');
});
test('explicit missing config fails without exposing the path; absent local development config remains optional',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'leobridge-env-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  assert.deepEqual(await loadRuntimeEnv({},directory),{});
  await assert.rejects(loadRuntimeEnv({BRIDGE_ENV_FILE:'sensitive-name.env'},directory),error=>error instanceof BridgeError&&error.code==='ENV_FILE'&&!String(error).includes('sensitive-name'));
});
