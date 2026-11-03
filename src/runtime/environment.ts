import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import type { Env } from '../core/config.ts';
import { BridgeError } from '../core/errors.ts';

/** Production is environment-only unless an explicit private file is selected. */
export async function loadRuntimeEnv(environment:Env,directory=process.cwd()):Promise<Env>{
  const explicit=environment.BRIDGE_ENV_FILE;
  const file=explicit||(['proxy','direct'].includes(environment.BRIDGE_NODE_MODE||'')?undefined:'.dev.vars');
  let values:Record<string,string>={};
  if(file)try{values=parseEnv(await readFile(resolve(directory,file),'utf8')) as Record<string,string>;}
  catch(error){if(explicit||(error as NodeJS.ErrnoException).code!=='ENOENT')throw new BridgeError('ENV_FILE',503,'无法读取配置文件，请检查路径及权限。');}
  return {...values,...Object.fromEntries(Object.entries(environment).filter(([,value])=>value!==undefined))};
}
