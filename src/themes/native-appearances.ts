import { tokenizer } from 'acorn';
import { isNativeTheme } from '../core/presentation.ts';
import type { Installation, ThemeStore } from './store.ts';

export interface NativeAppearance { id:string; label:string }
export interface NativeAppearances { options:NativeAppearance[]; status:'detected'|'unavailable' }
// Labels translate known IDs, but never add capabilities absent from the package.
const labels:Record<string,string>={pixel:'像素',flat:'扁平',anime:'二次元',premium:'高级黑金（付费许可证）',sweet:'天真'};
/** Inspect installed assets, never execute upstream code or infer support from the latest catalog.
 * CSS root selectors cover upstream's class-based themes. Literal appearance.theme
 * branches cover its separate renderers (e.g. premium). Custom IDs remain available
 * if future upstream code uses a different convention. This is discovery, not compatibility proof. */
export function detectNativeAppearances(assets:{path:string;bytes:Uint8Array}[]):NativeAppearance[]{
  const ids=new Set<string>(),add=(id:unknown)=>{if(isNativeTheme(id)&&!['source','custom'].includes(id))ids.add(id);};
  for(const asset of assets){
    const text=new TextDecoder().decode(asset.bytes);
    if(asset.path.endsWith('.css')){
      // Strings and comments cannot supply selectors; only inspect rule preludes.
      const css=text.replace(/\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,'');
      for(const rule of css.matchAll(/([^{}]+)\{/g)){
        for(const match of rule[1]!.matchAll(/(?:^|[\s,])(?::root|html)\.theme-([A-Za-z0-9_-]+)(?=[\s.#:[>,+~]|$)/g))add(match[1]);
      }
    }else if(/\.m?js$/.test(asset.path)){
      const window:{label:string;value:unknown}[]=[];
      try{
        for(const token of tokenizer(text,{ecmaVersion:'latest',sourceType:'module',allowHashBang:true})){
          window.push({label:token.type.label,value:(token as typeof token & {value?:unknown}).value});if(window.length>7)window.shift();
          if(window.length<6)continue;
          const [a,b,c,d,e,f]=window.slice(-6);
          const member=(x:typeof a,y:typeof a,z:typeof a)=>x!.label==='name'&&x!.value==='appearance'&&['.','?.'].includes(y!.label)&&z!.label==='name'&&z!.value==='theme';
          // The first token may be a member separator; require it to avoid unrelated identifiers.
          if(['.','?.'].includes(a!.label)&&member(b,c,d)&&['===','=='].includes(String(e!.value))&&f!.label==='string')add(f!.value);
          const [r,s,t,u,v,w,x]=window;
          if(window.length===7&&r!.label==='string'&&['===','=='].includes(String(s!.value))&&t!.label==='name'&&['.','?.'].includes(u!.label)&&member(v,w,x))add(r!.value);
        }
      }catch{/* Unknown JS syntax must not make the management page unavailable. */}
    }
  }
  return [...ids].sort().map(id=>({id,label:Object.hasOwn(labels,id)?labels[id]!:id}));
}

export class NativeAppearanceIndex {
  private cache=new Map<string,NativeAppearances>();
  async read(store:ThemeStore,item:Installation):Promise<NativeAppearances>{
    const key=`${item.id}:${item.packageDigest??item.pinnedVersion}`;
    const cached=this.cache.get(key);if(cached)return structuredClone(cached);
    const entries=Object.entries(item.files).filter(([path])=>/\.(css|m?js)$/.test(path));
    if(!entries.length||entries.length>256||entries.reduce((n,[,file])=>n+file.size,0)>32_000_000)return {options:[],status:'unavailable'};
    const assets:{path:string;bytes:Uint8Array}[]=[];
    try{
      for(const [path,metadata]of entries){
        const asset=await store.asset(item.id,path);
        if(!asset||asset.bytes.length!==metadata.size)return {options:[],status:'unavailable'};
        assets.push({path,bytes:asset.bytes});
      }
    }catch{return {options:[],status:'unavailable'};}
    const options=detectNativeAppearances(assets),result:NativeAppearances={options,status:options.length?'detected':'unavailable'};
    this.cache.set(key,result);while(this.cache.size>32)this.cache.delete(this.cache.keys().next().value!);
    return structuredClone(result);
  }
}
