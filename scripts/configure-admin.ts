import { readFile,writeFile,chmod } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { DEFAULT_ADMIN_PASSWORD } from '../src/management/password.ts';
let text='';try{text=await readFile('.dev.vars','utf8');}catch{throw new Error('Configure .dev.vars first.');}
const env=parseEnv(text) as Record<string,string>;
if(env.BRIDGE_ADMIN_PASSWORD){console.log('Independent admin credentials already configured; not overwritten.');process.exit(0);}
const password=DEFAULT_ADMIN_PASSWORD;
text+=`\n# Independent local management credentials. Never share with themes.\nBRIDGE_ADMIN_USERNAME=admin\nBRIDGE_ADMIN_PASSWORD=${password}\n`;
await writeFile('.dev.vars',text,{mode:0o600});await chmod('.dev.vars',0o600);
console.log('初始管理凭据已保存到 .dev.vars。默认密码为admin，首次登录必须设置高强度密码。');
