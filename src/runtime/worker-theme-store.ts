import { applyThemeCommand,emptyThemeState,validAssetPath,validInstallationId,type ThemeState,type ThemeCommand,type ThemeStore } from '../themes/store.ts';
interface DurableStorage {
  get<T>(key:string):Promise<T|undefined>;
  put<T>(key:string,value:T):Promise<void>;
  transaction<T>(operation:(storage:DurableStorage)=>Promise<T>):Promise<T>;
}
interface DurableState {storage:DurableStorage;}
export interface CoordinatorBinding {idFromName(name:string):unknown;get(id:unknown):{fetch(request:Request):Promise<Response>};}
export interface R2Binding {
  put(key:string,value:Uint8Array,options?:{onlyIf?:{etagDoesNotMatch:string}}):Promise<unknown|null>;
  get(key:string,options?:{range?:{offset:number;length:number}}):Promise<{arrayBuffer():Promise<ArrayBuffer>}|null>;
}
/** One station coordinator: only metadata/session transactions, never history or metrics. */
export class ThemeCoordinator {
  constructor(private state:DurableState){}
  async fetch(request:Request){
    try{
      if(request.method==='GET')return Response.json((await this.state.storage.get<ThemeState>('state'))||emptyThemeState());
      if(request.method!=='POST')return new Response('Method not allowed',{status:405});
      const command=await request.json() as ThemeCommand;
      const result=await this.state.storage.transaction(async storage=>{const current=(await storage.get<ThemeState>('state'))||emptyThemeState();const next=applyThemeCommand(current,command);await storage.put('state',next);return next;});
      return Response.json(result);
    }catch(error){const e=error as {status?:number;code?:string;message?:string};return Response.json({code:e.code||'STORE_ERROR',message:e.message||'主题元数据操作失败。'},{status:e.status||500});}
  }
}
export class WorkerThemeStore implements ThemeStore {
  constructor(private bucket:R2Binding,private binding:CoordinatorBinding){}
  // A DO stub is an I/O handle scoped to the current Worker request. Never cache it in Site.
  private coordinator(){return this.binding.get(this.binding.idFromName('site'));}
  async state():Promise<ThemeState>{const response=await this.coordinator().fetch(new Request('https://coordinator/state'));if(!response.ok)throw new Error('Theme state unavailable');return response.json();}
  async command(command:ThemeCommand):Promise<ThemeState>{
    const response=await this.coordinator().fetch(new Request('https://coordinator/state',{method:'POST',body:JSON.stringify(command),headers:{'Content-Type':'application/json'}}));
    if(!response.ok){const error=await response.json() as {message:string;code:string};const {BridgeError}=await import('../core/errors.ts');throw new BridgeError(error.code,response.status,error.message);}
    return response.json();
  }
  async putAsset(){throw new Error('Use atomic package upload');}
  async putAssets(id:string,files:{path:string;bytes:Uint8Array;contentType:string}[]){
    if(!validInstallationId(id)||files.some(f=>!validAssetPath(f.path)))throw new Error('Invalid asset path');
    const combined=new Uint8Array(files.reduce((sum,file)=>sum+file.bytes.length,0));let offset=0;
    for(const file of files){combined.set(file.bytes,offset);offset+=file.bytes.length;}
    // One immutable object per package; range reads avoid downloading unrelated assets.
    const written=await this.bucket.put(`packages/${id}`,combined,{onlyIf:{etagDoesNotMatch:'*'}});
    if(written===null){const prior=await this.bucket.get(`packages/${id}`);if(!prior)throw new Error('Immutable upload conflict');const bytes=new Uint8Array(await prior.arrayBuffer());if(bytes.length!==combined.length||bytes.some((value,i)=>value!==combined[i]))throw new Error('Immutable upload conflict');}
  }
  async asset(id:string,path:string){
    if(!validInstallationId(id)||!validAssetPath(path))return null;
    const info=(await this.state()).installations[id]?.files[path];if(!info||info.offset===undefined)return null;
    if(!info.size)return {bytes:new Uint8Array(),contentType:info.contentType};
    const object=await this.bucket.get(`packages/${id}`,{range:{offset:info.offset,length:info.size}});return object?{bytes:new Uint8Array(await object.arrayBuffer()),contentType:info.contentType}:null;
  }
}
