import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source=await readFile(new URL('../web/admin/app.js',import.meta.url),'utf8');
class Element {
  hidden=true;disabled=false;textContent='';className='';href='';children:Element[]=[];
  listeners:Record<string,(event:any)=>void>={};values:Record<string,string>={};
  elements={password:{value:''}};
  addEventListener(type:string,listener:(event:any)=>void){this.listeners[type]=listener;}
  replaceChildren(){this.children=[];}
  append(...children:Element[]){this.children.push(...children);}
  reset(){this.values={};}
}
async function fixture(required=true,initiallyLoggedIn=true,infoFails=false){
  const elements=new Map<string,Element>();
  const get=(id:string)=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)!;};
  let loggedIn=initiallyLoggedIn,mustChangePassword=required;
  const calls:{path:string;body?:any}[]=[];
  runInNewContext(source,{
    location:{pathname:'/admin/'},
    document:{getElementById:get,createElement:()=>new Element(),querySelectorAll:()=>[],createTextNode:()=>new Element()},
    FormData:class {constructor(private form:Element){}get(name:string){return this.form.values[name];}},
    fetch:async(url:string,options:any)=>{
      const path=url.replace('/admin/api/',''),body=options.body?JSON.parse(options.body):undefined;calls.push({path,body});
      let data:any={};let status=200;
      if(path==='login-info'){status=infoFails?503:200;data={showInitialPasswordHint:mustChangePassword};}
      else if(path==='login'){loggedIn=true;data={csrf:'new-csrf'};}
      else if(!loggedIn){status=401;data={message:'请登录LeoBridge管理站。'};}
      else if(path==='session')data={csrf:'csrf',mustChangePassword};
      else if(path==='password'){
        if(body.newPassword==='weak'){status=400;data={message:'密码强度不足'};}
        else {mustChangePassword=false;loggedIn=false;data={ok:true};}
      }
      else if(path==='state')data={installations:{},displayOrigin:'https://synthetic.invalid'};
      else if(path==='source')data={configured:true};
      else if(path==='logout')loggedIn=false;
      return {ok:status===200,status,json:async()=>data};
    },
  });
  const settle=async()=>{for(let i=0;i<8;i++)await new Promise<void>(resolve=>setImmediate(resolve));};
  await settle();
  return {get,calls,settle,submit:async(id:string,values:Record<string,string>)=>{const target=get(id);target.values=values;target.listeners.submit({preventDefault(){},target});await settle();}};
}

test('resumed bootstrap session shows mandatory form without loading management state',async()=>{
  const f=await fixture();
  assert.equal(f.get('password-change').hidden,false);assert.equal(f.get('workspace').hidden,true);
  assert.equal(f.get('cancel-password').hidden,true);assert.equal(f.get('login').hidden,true);
  assert.deepEqual(f.calls.map(c=>c.path),['session']);
  await f.submit('password-form',{currentPassword:'admin',newPassword:'First-fixture-2026!',confirmPassword:'different'});
  assert.equal(f.calls.length,1);assert.match(f.get('notice').textContent,/不一致/);
  await f.submit('password-form',{currentPassword:'admin',newPassword:'weak',confirmPassword:'weak'});
  assert.equal(f.get('notice').textContent,'密码强度不足');assert.equal(f.get('password-change').hidden,false);
  const strong='First-fixture-2026!';
  await f.submit('password-form',{currentPassword:'admin',newPassword:strong,confirmPassword:strong});
  assert.equal(f.get('login').hidden,false);assert.equal(f.get('password-change').hidden,true);
  assert.equal(f.get('initial-password-hint').hidden,true);
  assert.deepEqual(f.get('password-form').values,{});assert.match(f.get('notice').textContent,/密码已更改/);
  await f.submit('login-form',{username:'admin',password:strong});
  assert.equal(f.get('workspace').hidden,false);assert.equal(f.get('change-password').hidden,false);
  assert.equal(f.get('login').hidden,true);assert.equal(f.get('login-form').elements.password.value,'');
  assert.ok(f.calls.some(call=>call.path==='state'));
});

test('optional password change can return to the workspace and logout clears the form',async()=>{
  const f=await fixture(false);
  f.get('change-password').listeners.click({});
  assert.equal(f.get('password-change').hidden,false);assert.equal(f.get('cancel-password').hidden,false);
  f.get('cancel-password').listeners.click({});await f.settle();assert.equal(f.get('workspace').hidden,false);
  f.get('change-password').listeners.click({});f.get('password-form').values={currentPassword:'synthetic'};
  f.get('password-logout').listeners.click({});await f.settle();
  assert.equal(f.get('login').hidden,false);assert.equal(f.get('password-change').hidden,true);
  assert.equal(f.get('initial-password-hint').hidden,true);
  assert.deepEqual(f.get('password-form').values,{});
});


test('initial password guidance follows server initialization on a fresh login page',async()=>{
  const initial=await fixture(true,false);
  assert.equal(initial.get('login').hidden,false);
  assert.equal(initial.get('initial-password-hint').hidden,false);
  const configured=await fixture(false,false);
  assert.equal(configured.get('login').hidden,false);
  assert.equal(configured.get('initial-password-hint').hidden,true);
  const unavailable=await fixture(true,false,true);
  assert.equal(unavailable.get('login').hidden,false);
  assert.equal(unavailable.get('initial-password-hint').hidden,true);
});
