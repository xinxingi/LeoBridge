import { BridgeError } from '../core/errors.ts';
import type { AdminCredential } from '../themes/store.ts';

export const DEFAULT_ADMIN_PASSWORD = 'admin';
export const PASSWORD_POLICY = '密码须为12–128位，并包含大写字母、小写字母、数字和符号。';
export function constantEqual(a:string,b:string){let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0;}
export function validatePassword(password:unknown):asserts password is string {
  if(typeof password!=='string')throw new BridgeError('WEAK_PASSWORD',400,PASSWORD_POLICY);
  const length=[...password].length;
  if(length<12||length>128)throw new BridgeError('WEAK_PASSWORD',400,`新密码须为12–128位，当前为${length}位。密码未更改。`);
  if(!/[A-Z]/.test(password)||!/[a-z]/.test(password)||!/[0-9]/.test(password)||!/[\p{P}\p{S}]/u.test(password)||/\p{C}/u.test(password)||/^(password|qwerty|letmein|admin)[\d\p{P}\p{S}]*$/iu.test(password))throw new BridgeError('WEAK_PASSWORD',400,PASSWORD_POLICY+' 请勿使用常见弱口令。');
}
const hex=(bytes:Uint8Array)=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
async function derive(password:string,salt:string,iterations:number){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const bytes=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:Uint8Array.from(salt.match(/../g)!,s=>parseInt(s,16)),iterations},key,256);
  return hex(new Uint8Array(bytes));
}
export async function hashPassword(password:string,version:number):Promise<AdminCredential>{
  const salt=hex(crypto.getRandomValues(new Uint8Array(16))),iterations=600000;
  return {version,algorithm:'PBKDF2-SHA256',salt,iterations,hash:await derive(password,salt,iterations)};
}
export async function verifyPassword(password:string,credential:AdminCredential){
  return constantEqual(await derive(password,credential.salt,credential.iterations),credential.hash);
}
