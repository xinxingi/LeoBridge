import { mkdir,readFile,writeFile,rename,open,unlink,rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { applyThemeCommand,emptyThemeState,validAssetPath,validInstallationId,type ThemeStore,type ThemeState,type ThemeCommand } from '../themes/store.ts';
import { BridgeError } from '../core/errors.ts';
import { storageOperation } from './storage-check.ts';
export class FileThemeStore implements ThemeStore {
  readonly supportsUninstall=true;
  private pending=Promise.resolve();
  readonly root:string;
  constructor(root:string){this.root=resolve(root);}
  async state():Promise<ThemeState>{
    return storageOperation(async()=>{
      try{return JSON.parse(await readFile(resolve(this.root,'state.json'),'utf8'));}
      catch(error){
        if((error as NodeJS.ErrnoException).code==='ENOENT')return emptyThemeState();
        if(error instanceof SyntaxError){
          console.error('LeoBridge storage [STORAGE_INVALID_STATE]: state.json is not valid JSON; preserve data and restore a verified backup.');
          throw new BridgeError('STORAGE_INVALID_STATE',503,'数据状态文件无法解析。请保留数据，检查磁盘并从完整备份恢复；勿删除 state.json 或重新初始化。');
        }
        throw error;
      }
    });
  }
  async command(command:ThemeCommand):Promise<ThemeState>{
    let result!:ThemeState;
    const operation=this.pending.then(()=>storageOperation(async()=>{
      await mkdir(this.root,{recursive:true,mode:0o700});
      // An OS-exclusive file serializes multiple local processes as well as this queue.
      let lock;const deadline=Date.now()+3000;
      while(!lock){try{lock=await open(resolve(this.root,'state.lock'),'wx',0o600);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;if(Date.now()>deadline)throw new BridgeError('STORE_BUSY',503,'主题存储正被使用；异常退出后请检查state.lock。');await new Promise(r=>setTimeout(r,25));}}
      const temp=resolve(this.root,`state-${crypto.randomUUID()}.tmp`);
      try{
        result=applyThemeCommand(await this.state(),command);
        await writeFile(temp,JSON.stringify(result),{mode:0o600});await rename(temp,resolve(this.root,'state.json'));
        if(command.type==='uninstall'){
          // Publish the removal first. Failed/interrupted cleanup stays retryable and
          // prevents the same package from being reinstalled until cleanup finishes.
          try{
            await this.removePackage(command.id);
            const cleaned={...result,pendingAssetCleanup:result.pendingAssetCleanup?.filter(id=>id!==command.id)};
            await writeFile(temp,JSON.stringify(cleaned),{mode:0o600});await rename(temp,resolve(this.root,'state.json'));
            result=cleaned;
          }catch{/* Keep the durable pending record; the UI offers a cleanup retry. */}
        }
      }finally{await rm(temp,{force:true}).catch(()=>{});await lock.close();await unlink(resolve(this.root,'state.lock'));}
    }));
    this.pending=operation.catch(()=>{});await operation;return result;
  }
  protected async removePackage(id:string){await rm(resolve(this.root,'packages',id),{recursive:true,force:true});}
  private path(id:string,path:string){if(!validInstallationId(id)||!validAssetPath(path))throw new BridgeError('INVALID_PATH',400,'主题资源路径无效。');return resolve(this.root,'packages',id,path);}
  async putAsset(id:string,path:string,bytes:Uint8Array,contentType:string){
    return storageOperation(async()=>{
    const file=this.path(id,path);await mkdir(resolve(file,'..'),{recursive:true,mode:0o700});
    try{await writeFile(file,bytes,{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const existing=await readFile(file);if(!existing.equals(Buffer.from(bytes)))throw new BridgeError('IMMUTABLE_CONFLICT',409,'不可变资源摘要发生冲突。');}
    });
  }
  async asset(id:string,path:string){
    return storageOperation(async()=>{
    const file=this.path(id,path);const item=(await this.state()).installations[id]?.files[path];if(!item)return null;
    try{return {bytes:new Uint8Array(await readFile(file)),contentType:item.contentType};}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
    });
  }
}
