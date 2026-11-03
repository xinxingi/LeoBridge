import { commitInstallation,type ThemeStore,type Installation } from './store.ts';
/** Build manifests are trusted local artifacts; third-party catalog packages use the installer. */
export async function seedBundled(store:ThemeStore,load:(path:string)=>Promise<Uint8Array>){
  const definitions=JSON.parse(new TextDecoder().decode(await load('index.json'))) as Installation[];
  let state=await store.state();
  for(const definition of definitions){
    if(state.installations[definition.id]){
      const existing=state.installations[definition.id];
      if(existing.bundled&&(existing.compatibility!==definition.compatibility||existing.evidence!==definition.evidence))await store.command({type:'bundled-evidence',id:definition.id,compatibility:definition.compatibility,evidence:definition.evidence||''});
      continue;
    }
    const files=[];for(const [path,info]of Object.entries(definition.files))files.push({path,bytes:await load(`${definition.id}/${path}`),contentType:info.contentType});
    await commitInstallation(store,{...definition,installedAt:new Date().toISOString()},files,definition.ecosystem==='cfsm');
    state=await store.state();
  }
}
