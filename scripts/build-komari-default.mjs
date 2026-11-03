import { build } from 'vite';
import { cp,readFile,writeFile } from 'node:fs/promises';
await build({configFile:'web/themes/komari-default/vite.config.ts'});
const root='web/themes/komari-default',out='dist/komari-default-public';
for(const name of ['UPSTREAM_README.md','SOURCE_TERMS.md','UPSTREAM.json','PATCHES.md'])await cp(`${root}/${name}`,`${out}/${name}`);
const original=JSON.parse(await readFile(`${root}/komari-theme.json`,'utf8'));
await writeFile(`${out}/komari-theme.json`,JSON.stringify({...original,name:'Komari 默认主题 · LeoBridge',short:'LeoBridgeKomariDefault',version:'bed58b5-leobridge.1'},null,2)+'\n');
