import { readFile,writeFile,chmod } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';
let text='';try{text=await readFile('.dev.vars','utf8');}catch{throw new Error('Configure .dev.vars first.');}
const env=parseEnv(text) as Record<string,string>;
if(env.BRIDGE_ADMIN_PASSWORD){console.log('Independent admin credentials already configured; not overwritten.');process.exit(0);}
const password=randomBytes(24).toString('base64url');
text+=`\n# Independent local management credentials. Never share with themes.\nBRIDGE_ADMIN_USERNAME=admin\nBRIDGE_ADMIN_PASSWORD=${password}\n`;
await writeFile('.dev.vars',text,{mode:0o600});await chmod('.dev.vars',0o600);
console.log('Admin credentials saved privately to .dev.vars. Open http://admin.localhost:8786 and use BRIDGE_ADMIN_USERNAME / BRIDGE_ADMIN_PASSWORD from that file.');
