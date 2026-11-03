import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { CATALOG_SOURCES, fetchCatalog, fetchPublicBytes, ThemePackageError, type PublicFetcher } from '../themes/catalog.ts';
import { NATIVE_SOURCE } from '../themes/native-source.ts';
import { contentType, finish, sha256, type ThemeFile, type ThemePackage, type RemoteThemeFile } from '../themes/package.ts';

const revision=CATALOG_SOURCES.native.revision;
const source=`https://raw.githubusercontent.com/mmwx-group/mmwx-probe/${revision}/`;
const encoder=new TextEncoder();
const require=createRequire(import.meta.url);
/** No upstream scripts/config are executed. npm lifecycle scripts are disabled;
 * the fixed lockfile's registry tarballs are verified by npm and routed through
 * the same injected store transport. The compiler configuration is owned here. */
export function createNativeBuilder(){
  let cached:ThemePackage|undefined,pending:Promise<ThemePackage>|undefined;
  const controller=new AbortController();
  const prepare=async(fetcher:PublicFetcher):Promise<ThemePackage>=>{
    if(controller.signal.aborted)throw new ThemePackageError('NATIVE_BUILD_STOPPED','原生主题构建器已停止。',503);
    if(cached)return structuredClone(cached);
    if(!pending)pending=compile((input,init)=>fetcher(input,{...init,signal:AbortSignal.any([controller.signal,...(init?.signal?[init.signal]:[])])}),controller.signal).then(value=>cached=value).finally(()=>{pending=undefined;});
    return structuredClone(await pending);
  };
  return Object.assign(prepare,{close:()=>controller.abort()});
}
async function compile(fetcher:PublicFetcher,signal:AbortSignal):Promise<ThemePackage>{
  const root=await mkdtemp(join(tmpdir(),'leobridge-native-'));
  const remote:Record<string,RemoteThemeFile>={};
  const files:ThemeFile[]=[];
  try{
    const selected=NATIVE_SOURCE.filter(([path])=>!path.startsWith('public/')||/LICENSE|README/.test(path));
    for(const [path,sha,size]of NATIVE_SOURCE)if(path.startsWith('public/'))remote[path.slice(7)]={sha,size,contentType:contentType(path)??'application/octet-stream'};
    let next=0;
    const downloads=await Promise.allSettled(Array.from({length:6},async()=>{
      while(next<selected.length){
        const [path,expected,size]=selected[next++]!;
        const bytes=await fetchPublicBytes(source+path,{fetcher,maxBytes:8_000_000});
        const prefix=encoder.encode(`blob ${bytes.length}\0`),input=new Uint8Array(prefix.length+bytes.length);input.set(prefix);input.set(bytes,prefix.length);
        const actual=Buffer.from(await crypto.subtle.digest('SHA-1',input)).toString('hex');
        if(bytes.length!==size||actual!==expected)throw new ThemePackageError('NATIVE_SOURCE_HASH','原生主题源码与固定提交不符。');
        await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),bytes);
        if(path==='LICENSE'||path.startsWith('public/'))files.push({path:path.startsWith('public/')?path.slice(7):path,bytes,contentType:'text/plain; charset=utf-8'});
      }
    }));
    const failed=downloads.find(result=>result.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
    const lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));
    await installDependencies(root,lock,fetcher,signal);
    const output=await build({absWorkingDir:root,entryPoints:['src/main.tsx'],outdir:join(root,'dist'),bundle:true,write:false,format:'esm',splitting:true,platform:'browser',mainFields:['module','browser','main'],target:'es2022',jsx:'automatic',minify:true,legalComments:'linked',entryNames:'assets/[name]-[hash]',chunkNames:'assets/chunk-[hash]',assetNames:'assets/[name]-[hash]',define:{'process.env.NODE_ENV':'"production"','import.meta.env.DEV':'false','import.meta.env.PROD':'true'},plugins:[{name:'native-public-assets',setup(api){api.onResolve({filter:/^\//},args=>args.kind==='url-token'?{path:args.path,external:true}:undefined);}}],loader:{'.woff2':'file','.svg':'file','.png':'file','.webp':'file'},logLevel:'silent'});
    for(const file of output.outputFiles){const path=file.path.slice(join(root,'dist').length+1);files.push({path,bytes:file.contents,contentType:contentType(path)??'application/octet-stream'});}
    const entry=files.find(file=>/^assets\/main-.*\.js$/.test(file.path));
    if(!entry)throw new Error('Missing frontend entry');
    let html=await readFile(join(root,'index.html'),'utf8');
    if(!html.includes('/src/main.tsx'))throw new Error('Unknown frontend entry');
    html=html.replace('/src/main.tsx',`/${entry.path}`);
    const css=files.find(file=>/^assets\/main-.*\.css$/.test(file.path));
    if(css)html=html.replace('</head>',`<link rel="stylesheet" href="/${css.path}"></head>`);
    files.push({path:'index.html',bytes:encoder.encode(html),contentType:'text/html; charset=utf-8'});
    // Retain dependency license texts alongside the generated JS legal notices.
    async function licenses(dir:string,prefix=''){
      for(const node of await readdir(dir,{withFileTypes:true})){
        if(node.isSymbolicLink())continue;
        const path=join(dir,node.name),label=prefix?`${prefix}/${node.name}`:node.name;
        if(node.isDirectory())await licenses(path,label);
        else if(/^(LICENSE|LICENCE|COPYING|NOTICE)(?:[.-].*)?$/i.test(node.name)){
          const bytes=new Uint8Array(await readFile(path));if(bytes.length<500_000)files.push({path:`licenses/${label}`,bytes,contentType:'text/plain; charset=utf-8'});
        }
      }
    }
    await licenses(join(root,'node_modules'));
    const license=files.find(file=>file.path==='LICENSE')!;
    const catalog=await fetchCatalog('native');
    return await finish(catalog.entries[0]!,files,{spdx:'NOASSERTION',text:new TextDecoder().decode(license.bytes),source:source+'LICENSE',sha256:await sha256(license.bytes),status:'found'},'https://github.com/mmwx-group/mmwx-probe',revision,undefined,remote);
  }catch(error){
    if(error instanceof ThemePackageError)throw error;
    throw Object.assign(new ThemePackageError('NATIVE_BUILD_FAILED','原生主题构建失败；请检查商店下载网络、磁盘空间及内存后重试。',502),{cause:error});
  }finally{await rm(root,{recursive:true,force:true});}
}
/** A loopback, random-path registry gate prevents npm from bypassing the selected
 * proxy. Only tarballs explicitly named by the pinned lockfile can be fetched. */
export async function installDependencies(root:string,lock:Record<string,any>,fetcher:PublicFetcher,signal?:AbortSignal){
  signal?.throwIfAborted();
  if(lock.lockfileVersion!==3||!lock.packages||typeof lock.packages!=='object')throw new Error('Unsupported lockfile');
  const gate=crypto.randomUUID(),allowed=new Map<string,string>();
  for(const [name,value]of Object.entries(lock.packages) as [string,Record<string,unknown>][]){
    if(!name)continue;
    if(typeof value.resolved!=='string'||typeof value.integrity!=='string'||!/^sha512-[A-Za-z0-9+/]+=*$/.test(value.integrity))throw new Error('Unpinned dependency');
    const url=new URL(value.resolved);
    if(url.origin!=='https://registry.npmjs.org'||url.username||url.password||url.search||url.hash||!url.pathname.endsWith('.tgz'))throw new Error('Unsupported dependency source');
    allowed.set(`/${gate}${url.pathname}`,url.href);
  }
  let total=0;
  const server=createServer(async(req,res)=>{
    const url=allowed.get(req.url??'');
    if(req.method!=='GET'||!url){res.writeHead(404);res.end();return;}
    try{
      const response=await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(60_000)});
      if(!response.ok||response.redirected)throw new Error('Registry unavailable');
      let size=0;const chunks:Uint8Array[]=[];
      if(!response.body)throw new Error('Empty registry response');
      for await(const chunk of response.body as unknown as AsyncIterable<Uint8Array>){size+=chunk.length;total+=chunk.length;if(size>80_000_000||total>300_000_000)throw new Error('Dependency size limit');chunks.push(chunk);}
      res.writeHead(200,{'Content-Type':'application/octet-stream'});for(const chunk of chunks)res.write(chunk);res.end();
    }catch{res.writeHead(502);res.end();}
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try{
    const address=server.address();if(!address||typeof address==='string')throw new Error('Registry unavailable');
    const base=`http://127.0.0.1:${address.port}`;
    for(const value of Object.values(lock.packages) as Record<string,any>[])if(value.resolved)value.resolved=base+`/${gate}`+new URL(value.resolved).pathname;
    await writeFile(join(root,'package-lock.json'),JSON.stringify(lock));
    await writeFile(join(root,'.npmrc'),`registry=${base}/${gate}/\nignore-scripts=true\naudit=false\nfund=false\n`);
    await new Promise<void>((resolve,reject)=>{
      const child=spawn(process.execPath,[join(dirname(require.resolve('npm/package.json')),'bin/npm-cli.js'),'ci','--ignore-scripts','--omit=dev','--no-audit','--no-fund','--fetch-retries=0','--cache',join(root,'.cache')],{cwd:root,env:{PATH:dirname(process.execPath),HOME:root,TMPDIR:root,npm_config_userconfig:join(root,'.npmrc'),npm_config_globalconfig:join(root,'.empty-npmrc')},stdio:'ignore'});
      const abort=()=>{child.kill('SIGKILL');};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
      const timer=setTimeout(abort,240_000);
      child.once('error',error=>{signal?.removeEventListener('abort',abort);clearTimeout(timer);reject(error);});child.once('exit',code=>{signal?.removeEventListener('abort',abort);clearTimeout(timer);code===0?resolve():reject(new Error('Dependency install failed'));});
    });
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
