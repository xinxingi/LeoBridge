import { Agent,ProxyAgent,fetch as nodeFetch,type Dispatcher } from 'undici';
import { parseStoreProxy } from '../core/store-proxy.ts';
import type { PublicFetcher } from '../themes/catalog.ts';
import type { StoreTransport } from '../management/store-network.ts';
/** Each operation pins its transport through redirects and all package downloads. */
export function createStoreTransport(){
  const pending=new Set<Dispatcher>();let stopped=false;
  const run:StoreTransport=async(settings,action)=>{
    if(stopped)throw new Error('Store transport stopped');
    const parsed=parseStoreProxy(settings.enabled,settings.url);
    let dispatcher:Dispatcher;
    if(parsed.enabled){
      const url=new URL(parsed.url);
      const token=url.username||url.password?'Basic '+Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64'):undefined;
      dispatcher=new ProxyAgent({uri:url.origin,token,connect:{timeout:10_000}});
    }else dispatcher=new Agent({connect:{timeout:10_000}});
    pending.add(dispatcher);
    // Use the fetch implementation matching the dispatcher, including header/decompression handling.
    const fetcher:PublicFetcher=(input,init)=>nodeFetch(input as Parameters<typeof nodeFetch>[0],{...init,dispatcher} as Parameters<typeof nodeFetch>[1]) as unknown as Promise<Response>;
    try{return await action(fetcher);}
    finally{pending.delete(dispatcher);await dispatcher.destroy();}
  };
  return {run,async destroy(){stopped=true;await Promise.allSettled([...pending].map(dispatcher=>dispatcher.destroy()));}};
}
