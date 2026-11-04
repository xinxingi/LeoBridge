import { readFile, stat } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import type { Env } from '../core/config.ts';
import { BridgeError } from '../core/errors.ts';

/** Production is environment-only unless an explicit private file is selected. */
export async function loadRuntimeEnv(environment:Env,directory=process.cwd()):Promise<Env>{
  const explicit=environment.BRIDGE_ENV_FILE;
  const production=environment.NODE_ENV==='production'||['proxy','direct'].includes(environment.BRIDGE_NODE_MODE||'');
  const file=explicit||(production?undefined:'.dev.vars');
  let values:Record<string,string>={};
  if(file)try{values=parseEnv(await readFile(resolve(directory,file),'utf8')) as Record<string,string>;}
  catch(error){if(explicit||(error as NodeJS.ErrnoException).code!=='ENOENT')throw new BridgeError('ENV_FILE',503,'无法读取配置文件，请检查路径及权限。');}
  return {...values,...Object.fromEntries(Object.entries(environment).filter(([,value])=>value!==undefined))};
}

/** Never turn an existing installation into an empty site when changing defaults. */
export async function themeStoreDirectory(environment:Env,directory=process.cwd()):Promise<string>{
  if(environment.BRIDGE_THEME_STORE)return resolve(directory,environment.BRIDGE_THEME_STORE);
  try{
    await stat(resolve(directory,'work/theme-store'));
  }catch(error){
    if((error as NodeJS.ErrnoException).code==='ENOENT')return resolve(directory,'data');
    throw new BridgeError('STORAGE_CONFIGURATION',503,'无法检查旧数据目录，请核对目录权限或显式设置 BRIDGE_THEME_STORE。');
  }
  throw new BridgeError('STORAGE_MIGRATION',503,'检测到旧 work/theme-store 目录。请停机后完整迁移到 ./data，或设置 BRIDGE_THEME_STORE=work/theme-store 继续使用旧目录。');
}
