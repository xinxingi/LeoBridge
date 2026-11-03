import { mkdir,writeFile,cp,rm } from 'node:fs/promises';
// Clear obsolete frontend output as well as previous bundled assets on upgrades.
for(const path of ['dist/public','dist/komari-public','dist/komari-default-public','dist/bundled'])await rm(path,{recursive:true,force:true});
await mkdir('dist/bundled',{recursive:true});
await writeFile('dist/bundled/index.json','[]\n');
await cp('web/admin','dist/bundled/_management',{recursive:true});
console.log('Built LeoBridge management assets; no third-party themes bundled.');
