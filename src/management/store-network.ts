import { BridgeError } from '../core/errors.ts';
import { parseStoreProxy,publicProxyUrl,type StoreProxySettings } from '../core/store-proxy.ts';
import type { InstallOptions, ThemePackage } from '../themes/package.ts';
import { installCatalogTheme } from '../themes/package.ts';
import type { Ecosystem, PublicFetcher } from '../themes/catalog.ts';
import type { ThemeStore } from '../themes/store.ts';
export type StoreTransport = <T>(settings:StoreProxySettings,run:(fetcher:PublicFetcher)=>Promise<T>)=>Promise<T>;
/** Configuration and authorization stay independent of the Node transport. */
export class StoreNetwork {
  constructor(private store:ThemeStore,private transport?:StoreTransport,private nativeBuild?:(fetcher:PublicFetcher,revision:string)=>Promise<ThemePackage>){}
  private async current(){const saved=(await this.store.state()).storeProxy;return saved??{enabled:false,url:'',version:0};}
  async status(){const current=await this.current();return {supported:!!this.transport,version:current.version,enabled:current.enabled,url:publicProxyUrl(current.url),hasAddress:!!current.url,hasCredentials:!!current.url&&(!!new URL(current.url).username||!!new URL(current.url).password),storage:current.version?'saved':'default'};}
  async save(body:Record<string,unknown>,sessionId:string){
    if(!this.transport)throw new BridgeError('STORE_PROXY_UNSUPPORTED',400,'当前运行环境不支持配置商店代理。');
    const current=await this.current();
    if(body.version!==current.version)throw new BridgeError('STORE_PROXY_CONFLICT',409,'商店代理设置已变更，请重新载入后再保存。');
    if(typeof body.url!=='string')throw new BridgeError('STORE_PROXY_INPUT',400,'代理地址无效。');
    const settings=parseStoreProxy(body.enabled,body.url.trim()||current.url);
    await this.store.command({type:'store-proxy',sessionId,expectedVersion:current.version,settings});
    return {ok:true};
  }
  async install(ecosystem:Ecosystem,id:string,options:InstallOptions):Promise<ThemePackage>{
    if(ecosystem!=='native')return this.run(fetcher=>installCatalogTheme(ecosystem,id,{...options,fetcher}));
    if(!this.nativeBuild)throw new BridgeError('NATIVE_BUILD_UNAVAILABLE',503,'当前运行环境不支持原生主题源码构建，请使用Node运行包或Docker。');
    if(typeof options.expectedCatalogRevision!=='string')throw new BridgeError('CATALOG_REVISION',400,'请先从原生主题商店选择版本。');
    const {fetchCatalog}=await import('../themes/catalog.ts');
    const catalog=await fetchCatalog('native',undefined,{revision:options.expectedCatalogRevision});
    if(!catalog.entries.some(entry=>entry.id===id))throw new BridgeError('THEME_NOT_FOUND',404,'原生主题不存在。');
    return this.run(fetcher=>this.nativeBuild!(fetcher,catalog.catalogRevision));
  }
  async run<T>(action:(fetcher:PublicFetcher)=>Promise<T>):Promise<T>{
    const current=await this.current();
    if(this.transport)return this.transport(current,action);
    if(current.enabled)throw new BridgeError('STORE_PROXY_UNSUPPORTED',503,'当前运行环境不支持已启用的商店代理。');
    return action(fetch);
  }
}
