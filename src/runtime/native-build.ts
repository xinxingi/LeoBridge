import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { nativeSource, fetchCatalog, fetchPublicBytes, ThemePackageError, type PublicFetcher } from '../themes/catalog.ts';
import { fetchNativeSource } from '../themes/native-source.ts';
import { contentType, finish, sha256, type ThemeFile, type ThemePackage, type RemoteThemeFile } from '../themes/package.ts';

const encoder=new TextEncoder();
const require=createRequire(import.meta.url);
/** No upstream scripts/config are executed. npm lifecycle scripts are disabled;
 * the fixed lockfile's registry tarballs are verified by npm and routed through
 * the same injected store transport. The compiler configuration is owned here. */
export function createNativeBuilder(){
  const cached=new Map<string,ThemePackage>(),pending=new Map<string,Promise<ThemePackage>>();
  const controller=new AbortController();
  const prepare=async(fetcher:PublicFetcher,revision:string,themeId='mmwx-probe'):Promise<ThemePackage>=>{
    nativeSource(themeId);
    const key=`${themeId}:${revision}`;
    if(!/^[a-f0-9]{40}$/.test(revision))throw new ThemePackageError('NATIVE_REVISION','原生源码版本必须为上游的固定提交。');
    if(controller.signal.aborted)throw new ThemePackageError('NATIVE_BUILD_STOPPED','原生主题构建器已停止。',503);
    if(cached.has(key))return structuredClone(cached.get(key)!);
    if(!pending.has(key))pending.set(key,compile(themeId,revision,(input,init)=>fetcher(input,{...init,signal:AbortSignal.any([controller.signal,...(init?.signal?[init.signal]:[])])}),controller.signal).then(value=>{cached.set(key,value);while(cached.size>2)cached.delete(cached.keys().next().value!);return value;}).finally(()=>{pending.delete(key);}));
    return structuredClone(await pending.get(key)!);
  };
  return Object.assign(prepare,{close:()=>{controller.abort();cached.clear()}});
}
async function compile(themeId:string,revision:string,fetcher:PublicFetcher,signal:AbortSignal):Promise<ThemePackage>{
  const selectedSource=nativeSource(themeId);
  const source=`https://raw.githubusercontent.com/${selectedSource.repository}/${revision}/`;
  const index=await fetchNativeSource(revision,fetcher,themeId);
  const root=await mkdtemp(join(tmpdir(),'leobridge-native-'));
  const remote:Record<string,RemoteThemeFile>={};
  const files:ThemeFile[]=[];
  try{
    const selected=index.filter(([path])=>!path.startsWith('public/')||/LICENSE|README/.test(path));
    for(const [path,sha,size]of index)if(path.startsWith('public/'))remote[path.slice(7)]={sha,size,contentType:contentType(path)??'application/octet-stream'};
    let next=0;
    const downloads=await Promise.allSettled(Array.from({length:6},async()=>{
      while(next<selected.length){
        const [path,expected,size]=selected[next++]!;
        const bytes=await fetchPublicBytes(source+path.split('/').map(encodeURIComponent).join('/'),{fetcher,maxBytes:8_000_000});
        const prefix=encoder.encode(`blob ${bytes.length}\0`),input=new Uint8Array(prefix.length+bytes.length);input.set(prefix);input.set(bytes,prefix.length);
        const actual=Buffer.from(await crypto.subtle.digest('SHA-1',input)).toString('hex');
        if(bytes.length!==size||actual!==expected)throw new ThemePackageError('NATIVE_SOURCE_HASH','原生主题源码与固定提交不符。');
        await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),bytes);
        if(/(?:^|\/)(LICENSE|LICENCE|COPYING|NOTICE)(?:[.][^/]+)?$/i.test(path)||path.startsWith('public/'))files.push({path:path.startsWith('public/')?path.slice(7):path,bytes,contentType:contentType(path)??'text/plain; charset=utf-8'});
      }
    }));
    const failed=downloads.find(result=>result.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
    const lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));
    await installDependencies(root,lock,fetcher,signal);
    const entries=[{html:'index.html',source:'src/main.tsx',name:'main'}];
    if(themeId==='jiwo-probe'){
      if(!index.some(([path])=>path==='map.html')||!index.some(([path])=>path==='src/ran/map-entry.tsx'))throw new ThemePackageError('NATIVE_ENTRY','Jiwo源码缺少独立地图入口。');
      entries.push({html:'map.html',source:'src/ran/map-entry.tsx',name:'map-entry'});
    }
    const output=await build({absWorkingDir:root,entryPoints:entries.map(entry=>entry.source),...(themeId==='jiwo-probe'?{alias:{'@':join(root,'src/ran')}}:{}),outdir:join(root,'dist'),bundle:true,write:false,format:'esm',splitting:true,platform:'browser',mainFields:['module','browser','main'],target:'es2022',jsx:'automatic',minify:true,legalComments:'linked',entryNames:'assets/[name]-[hash]',chunkNames:'assets/chunk-[hash]',assetNames:'assets/[name]-[hash]',define:{'process.env.NODE_ENV':'"production"','import.meta.env.DEV':'false','import.meta.env.PROD':'true'},plugins:[{name:'native-public-assets',setup(api){api.onResolve({filter:/^\//},args=>args.kind==='url-token'?{path:args.path,external:true}:undefined);}}],loader:{'.woff2':'file','.svg':'file','.png':'file','.webp':'file'},logLevel:'silent'});
    for(const file of output.outputFiles){const path=file.path.slice(join(root,'dist').length+1);files.push({path,bytes:file.contents,contentType:contentType(path)??'application/octet-stream'});}
    for(const page of entries){
      const entry=files.find(file=>file.path.startsWith(`assets/${page.name}-`)&&file.path.endsWith('.js'));
      if(!entry)throw new Error('Missing frontend entry');
      let html=await readFile(join(root,page.html),'utf8');
      if(!html.includes(`/${page.source}`))throw new Error('Unknown frontend entry');
      html=html.replace(`/${page.source}`,`/${entry.path}`);
      const css=files.find(file=>file.path.startsWith(`assets/${page.name}-`)&&file.path.endsWith('.css'));
      if(css)html=html.replace('</head>',`<link rel="stylesheet" href="/${css.path}"></head>`);
      files.push({path:page.html,bytes:encoder.encode(html),contentType:'text/html; charset=utf-8'});
    }
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
    await mkdir(join(root,'node_modules'),{recursive:true});await licenses(join(root,'node_modules'));
    const license=files.find(file=>/^(LICENSE|LICENCE|COPYING)(?:[.][^/]+)?$/i.test(file.path));
    const catalog=await fetchCatalog('native',fetcher,{revision,nativeThemeId:themeId});
    return await finish(catalog.entries[0]!,files,{spdx:'NOASSERTION',text:license?new TextDecoder().decode(license.bytes):'',source:source+(license?.path??''),sha256:await sha256(license?.bytes??new Uint8Array()),status:license?'found':'missing'},`https://github.com/${selectedSource.repository}`,revision,undefined,remote);
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
