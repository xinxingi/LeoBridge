import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Admin } from '../src/management/admin.ts';
import { managementConfig } from '../src/management/config.ts';
import { SourceManagement } from '../src/management/source.ts';
import { verifyPassword } from '../src/management/password.ts';
import { readConfig } from '../src/core/config.ts';
import { normalizeSnapshot } from '../src/core/model.ts';
import { FileThemeStore } from '../src/runtime/file-theme-store.ts';
import { loadRuntimeEnv } from '../src/runtime/environment.ts';

const changed='Changed-fixture-password-2026!';
function call(admin:Admin,path:string,body?:unknown,session?:{cookie:string;csrf:string}){
  return admin.handle(new Request(admin.config.adminOrigin+'/admin/api/'+path,{
    method:body===undefined?'GET':'POST',
    headers:{Origin:admin.config.adminOrigin,'Content-Type':'application/json',Cookie:session?.cookie||'','X-CSRF-Token':session?.csrf||''},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
  }));
}
async function login(admin:Admin,password='admin'){
  const response=await call(admin,'login',{username:admin.config.username,password});
  const data=await response.json();
  return {response,data,cookie:response.headers.get('set-cookie')?.split(';')[0]||'',csrf:data.csrf};
}

test('removed environment initialization cannot supply credentials or sources; both settings persist in one file',async t=>{
  const root=await mkdtemp(join(tmpdir(),'bridge-state-settings-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const text='MMWX_BASE_URL=not-a-url\nMMWX_PROBE_TOKEN=ignored-secret\nBRIDGE_BINDINGS=not-json\nBRIDGE_PING_TARGETS=not-json\nBRIDGE_ADMIN_USERNAME=operator\nBRIDGE_ADMIN_PASSWORD=ignored-password\n';
  const file=join(root,'.dev.vars');await writeFile(file,text);
  const env=await loadRuntimeEnv({},root),config=managementConfig(env),store=new FileThemeStore(join(root,'state'));
  const manager=new SourceManagement(readConfig(env),store,async source=>{
    assert.equal(source.baseUrl,'https://source.example.test');assert.equal(source.token,'synthetic-source-token');
    return normalizeSnapshot({enabled:true,show_name:true,servers:[]});
  });
  const admin=new Admin(config,store,async()=>new Response('ui'),manager);
  assert.deepEqual(await (await call(admin,'login-info')).json(),{showInitialPasswordHint:true,credentialSource:'default'});
  assert.equal((await login(admin,'ignored-password')).response.status,401);
  const initial=await login(admin);assert.equal(initial.response.status,200);assert.equal(initial.data.mustChangePassword,true);
  assert.equal((await call(admin,'source',undefined,initial)).status,403);
  assert.equal((await call(admin,'password',{currentPassword:'admin',newPassword:'Abcd123!',confirmPassword:'Abcd123!'},initial)).status,400);
  assert.equal((await store.state()).adminCredential,undefined);
  assert.equal((await call(admin,'password',{currentPassword:'admin',newPassword:changed,confirmPassword:changed},initial)).status,200);
  const session=await login(admin,changed);assert.equal(session.response.status,200);
  const status=await (await call(admin,'source',undefined,session)).json();
  assert.equal(status.storage,'unconfigured');assert.equal(status.hasToken,false);assert.equal(status.baseUrl,'');
  const checked=await call(admin,'source/check',{version:0,baseUrl:'https://source.example.test',token:'synthetic-source-token'},session);
  assert.equal(checked.status,200);const review=await checked.json();
  assert.equal((await call(admin,'source/save',{reviewId:review.reviewId,assignments:[],pingKeys:Array(8).fill(''),confirmed:true},session)).status,200);
  const saved=JSON.parse(await readFile(join(root,'state/state.json'),'utf8'));
  assert.ok(await verifyPassword(changed,saved.adminCredential));assert.equal(saved.source.token,'synthetic-source-token');
  assert.ok(!JSON.stringify(saved).includes(changed));assert.equal((await stat(join(root,'state/state.json'))).mode&0o777,0o600);
  assert.equal(await readFile(file,'utf8'),text,'application never rewrites runtime files');
  await writeFile(file,'BRIDGE_ADMIN_USERNAME=operator\n');
  const restartedStore=new FileThemeStore(join(root,'state')),restartedEnv=await loadRuntimeEnv({},root);
  const restarted=new Admin(managementConfig(restartedEnv),restartedStore,async()=>new Response('ui'),new SourceManagement(readConfig(restartedEnv),restartedStore,async()=>{throw new Error('not needed')}));
  for(const obsolete of ['admin','ignored-password'])assert.equal((await login(restarted,obsolete)).response.status,401);
  const resumed=await login(restarted,changed);assert.equal(resumed.response.status,200);assert.equal(resumed.data.mustChangePassword,false);
  const current=await (await call(restarted,'source',undefined,resumed)).json();assert.equal(current.storage,'saved');assert.equal(current.baseUrl,'https://source.example.test');assert.equal(current.hasToken,true);
  const publicState=await (await call(restarted,'state',undefined,resumed)).text();
  for(const secret of ['synthetic-source-token',saved.adminCredential.hash,saved.adminCredential.salt])assert.ok(!publicState.includes(secret));
});
