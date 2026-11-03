import { cssDependencySources } from './resource-sources-css.ts';
import type { PresentationContext } from '../core/presentation.ts';
import { BridgeError } from '../core/errors.ts';
import { contentType, safePackagePath, sha256, type RemoteThemeFile } from './package.ts';
import { fetchPublicBytes, repositoryParts, type PublicFetcher } from './catalog.ts';
import { CFSM_PUBLIC_SOURCES, KOMARI_PUBLIC_SOURCES, type PublicResourceSource } from './default-resources.ts';
import type { Installation } from './store.ts';

export function presentationContext(item:Installation):PresentationContext {
  const settings:Record<string,unknown>={};
  const data=item.configuration?.data;
  if(item.configuration?.type==='managed'&&Array.isArray(data))for(const field of data){
    if(field&&typeof field==='object'&&typeof field.key==='string'&&Object.hasOwn(field,'default'))
      Object.defineProperty(settings,field.key,{value:structuredClone(field.default),enumerable:true,writable:true,configurable:true});
  }
  return {theme:item.themeId??(typeof item.manifest?.short==='string'?item.manifest.short:'default'),settings};
}
export interface ResourceAsset {bytes:Uint8Array;contentType:string;}
type Transport = <T>(run:(fetcher:PublicFetcher)=>Promise<T>)=>Promise<T>;
/** Fixed upstream assets, isolated from data-source credentials. Bounded cache and concurrency. */
export class ThemeResources {
  private dependencies=new Map<string,Record<string,PublicResourceSource>>();
  private inspected=new Set<string>();
  private cache=new Map<string,{value:ResourceAsset|null;expires:number}>();
  private pending=new Map<string,Promise<ResourceAsset|null>>();
  private bytes=0;
  private active=0;
  private waiting:(()=>void)[]=[];
  constructor(private transport:Transport,private now=Date.now){}
  async observe(item:Installation,path:string,asset:ResourceAsset){
    if(!path.endsWith('.css'))return;
    const key=`${item.id}:${path}:${await sha256(asset.bytes)}`;
    if(this.inspected.has(key))return;
    const sources=await cssDependencySources(path,asset.bytes);
    if(Object.keys(sources).length)this.dependencies.set(item.id,{...this.dependencies.get(item.id),...sources});
    this.inspected.add(key);
    if(this.inspected.size>512)this.inspected.delete(this.inspected.values().next().value!);
    if(this.dependencies.size>64)this.dependencies.delete(this.dependencies.keys().next().value!);
  }
  has(item:Installation,path:string):boolean {
    return [item.files,item.remoteFiles,item.dependencySources,this.dependencies.get(item.id)].some(index=>!!index&&Object.hasOwn(index,path));
  }
  async get(item:Installation,path:string,defaultOnly=false):Promise<ResourceAsset|null>{
    safePackagePath(path);
    const dependencies=defaultOnly?{}:{...this.dependencies.get(item.id),...item.dependencySources};
    if(!defaultOnly&&(item.ecosystem==='cfsm'||item.ecosystem==='native')){
      const remote=item.remoteFiles&&Object.hasOwn(item.remoteFiles,path)?item.remoteFiles[path]:undefined;
      const repo=repositoryParts(item.source);
      if((remote||!item.remoteFiles)&&repo&&/^[a-f0-9]{40}$/.test(item.pinnedVersion)){
        const url=`https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${item.pinnedVersion}/${item.ecosystem==='native'?'public/':''}${path.split('/').map(encodeURIComponent).join('/')}`;
        const own=await this.fetchAsset(url,path,undefined,remote);
        if(own)return own;
      }
    }
    const defaults=item.ecosystem==='native'?{}:item.ecosystem==='komari'?KOMARI_PUBLIC_SOURCES:CFSM_PUBLIC_SOURCES;
    const source=Object.hasOwn(dependencies,path)?dependencies[path]:Object.hasOwn(defaults,path)?defaults[path]:undefined;
    return source?this.fetchAsset(source.url,path,source.sha256):null;
  }
  private async fetchAsset(url:string,path:string,expectedHash?:string,remote?:RemoteThemeFile):Promise<ResourceAsset|null>{
    const key=`${url}#${expectedHash??(remote?`${remote.sha}:${remote.size}`:'fixed-revision')}`;
    const cached=this.cache.get(key);
    if(cached&&cached.expires>this.now()){this.cache.delete(key);this.cache.set(key,cached);return cached.value;}
    if(cached){this.bytes-=cached.value?.bytes.length??0;this.cache.delete(key);}
    const pending=this.pending.get(key);if(pending)return pending;
    if(this.pending.size>=128)throw new BridgeError('RESOURCE_BUSY',503,'主题资源加载繁忙，请稍后重试。');
    const task=this.load(key,url,path,expectedHash,remote);this.pending.set(key,task);
    try{return await task;}finally{this.pending.delete(key);}
  }
  private async load(key:string,url:string,path:string,expectedHash?:string,remote?:RemoteThemeFile):Promise<ResourceAsset|null>{
    if(this.active>=6)await new Promise<void>(resolve=>this.waiting.push(resolve));
    else this.active++;
    try{
      let asset:ResourceAsset|null;
      try{
        const bytes=await this.transport(fetcher=>fetchPublicBytes(url,{fetcher,maxBytes:8_000_000,timeoutMs:30_000}));
        if(expectedHash&&await sha256(bytes)!==expectedHash)throw new BridgeError('RESOURCE_HASH',502,'上游公共资源与固定摘要不一致。');
        if(remote){
          const prefix=new TextEncoder().encode(`blob ${bytes.length}\0`),input=new Uint8Array(prefix.length+bytes.length);input.set(prefix);input.set(bytes,prefix.length);
          const actual=[...new Uint8Array(await crypto.subtle.digest('SHA-1',input))].map(v=>v.toString(16).padStart(2,'0')).join('');
          if(bytes.length!==remote.size||actual!==remote.sha)throw new BridgeError('RESOURCE_HASH',502,'主题资源与固定Git树不一致。');
        }
        asset={bytes,contentType:remote?.contentType??contentType(path)??'application/octet-stream'};
      }catch(error){
        if((error as {httpStatus?:number}).httpStatus!==404)throw error;
        asset=null;
      }
      this.cache.set(key,{value:asset,expires:this.now()+(asset?3_600_000:60_000)});this.bytes+=asset?.bytes.length??0;
      while(this.cache.size>512||this.bytes>32_000_000){const key=this.cache.keys().next().value!;this.bytes-=this.cache.get(key)!.value?.bytes.length??0;this.cache.delete(key);}
      return asset;
    }finally{const next=this.waiting.shift();if(next)next();else this.active--;}
  }
}
