import { readFile,readdir,mkdir,writeFile,copyFile,cp,rm } from 'node:fs/promises';
import { join,extname } from 'node:path';
import { createHash } from 'node:crypto';
const sha=data=>createHash('sha256').update(data).digest('hex');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8'};
const definitions=[
  {title:'CFSM 默认前台 · LeoBridge',ecosystem:'cfsm',directory:'dist/public',source:'https://github.com/huilang-me/CF-Server-Monitor',pinnedVersion:'609cc0b0998793510453be8eadced2064b28ad7d',protocolProfile:'cfsm-609cc0b',licensePath:'web/themes/cfsm/LICENSE',compatibility:'verified',evidence:'docs/research/acceptance.md'},
  {title:'Adhesive Note · LeoBridge',ecosystem:'komari',directory:'dist/komari-public',source:'https://github.com/stqfdyr/komari-theme-adhesive-note',pinnedVersion:'8ac4fd2fe4fb4cabde84ddc31c8cd9e9df966914',protocolProfile:'komari-adhesive-v1',licensePath:'web/themes/komari/LICENSE',compatibility:'verified',evidence:'docs/research/dual-store-acceptance.md'},
];
async function files(root,prefix=''){const list=[];for(const entry of await readdir(join(root,prefix),{withFileTypes:true})){const path=prefix?`${prefix}/${entry.name}`:entry.name;if(entry.isDirectory())list.push(...await files(root,path));else if(entry.isFile())list.push(path);else throw new Error('Only regular build assets allowed');}return list.sort();}
await rm('dist/bundled',{recursive:true,force:true});await mkdir('dist/bundled',{recursive:true});
const installations=[];
for(const definition of definitions){
  const paths=await files(definition.directory),digests=[];
  const metadata={};for(const path of paths){const bytes=await readFile(join(definition.directory,path));digests.push(`${path}:${sha(bytes)}`);metadata[path]={contentType:mime[extname(path)]||'application/octet-stream',size:bytes.length};}
  const id=sha(`${definition.ecosystem}:${definition.protocolProfile}:${digests.join('\n')}`).slice(0,32);
  for(const path of paths){const target=join('dist/bundled',id,path);await mkdir(join(target,'..'),{recursive:true});await copyFile(join(definition.directory,path),target);}
  const license=await readFile(definition.licensePath,'utf8');
  const {directory,licensePath,...rest}=definition;
  installations.push({...rest,id,entry:'index.html',license:{spdx:'MIT',text:license,source:`${definition.source}/blob/${definition.pinnedVersion}/LICENSE`,sha256:sha(license)},files:metadata,bundled:true});
}
await writeFile('dist/bundled/index.json',JSON.stringify(installations));await cp('web/admin','dist/bundled/_management',{recursive:true});
console.log(`Bundled ${installations.length} immutable themes and the independent management UI.`);
