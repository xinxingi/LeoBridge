/** Read the chosen upstream commit at install time; the reference manifest is not an allowlist. */
import { nativeSource, fetchPublicJson, ThemePackageError, type PublicFetcher } from './catalog.ts';
import { safePackagePath } from './package.ts';
export type NativeSourceFile=readonly [path:string,sha:string,size:number];
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export async function fetchNativeSource(revision:string,fetcher:PublicFetcher,themeId='mmwx-probe'):Promise<NativeSourceFile[]>{
  if(!/^[a-f0-9]{40}$/.test(revision))throw new ThemePackageError('NATIVE_REVISION','原生源码版本必须为上游的固定提交。');
  const tree=await fetchPublicJson(`https://api.github.com/repos/${nativeSource(themeId).repository}/git/trees/${revision}?recursive=1`,{fetcher,maxBytes:8_000_000});
  return nativeSourceFiles(tree);
}
export function nativeSourceFiles(tree:unknown):NativeSourceFile[]{
  if(!record(tree)||tree.truncated!==false||!Array.isArray(tree.tree)||tree.tree.length>20_000)throw new ThemePackageError('NATIVE_TREE','原生源码目录不完整或超过大小限制。');
  const files:NativeSourceFile[]=[],names=new Set<string>();let total=0;
  for(const node of tree.tree){
    if(!record(node)||typeof node.path!=='string')throw new ThemePackageError('NATIVE_TREE','原生源码目录条目无效。');
    const path=safePackagePath(node.path);
    if(node.type==='tree')continue;
    const selected=path.startsWith('src/')||path.startsWith('public/')||['index.html','map.html','package.json','package-lock.json'].includes(path)||/^(LICENSE|LICENCE|COPYING|NOTICE)(?:[.][^/]+)?$/i.test(path);
    if(!selected)continue;
    if(node.type!=='blob'||!['100644','100755'].includes(String(node.mode)))throw new ThemePackageError('NATIVE_SPECIAL_FILE','原生源码禁止符号链接及子模块。');
    if(typeof node.sha!=='string'||! /^[a-f0-9]{40}$/.test(node.sha)||!Number.isSafeInteger(node.size)||(node.size as number)<0||(node.size as number)>8_000_000)throw new ThemePackageError('NATIVE_TREE','原生源码文件摘要或大小无效。');
    if(names.has(path.toLowerCase()))throw new ThemePackageError('NATIVE_TREE','原生源码包含重复或大小写冲突路径。');
    names.add(path.toLowerCase());total+=node.size as number;
    if(total>100_000_000)throw new ThemePackageError('NATIVE_TREE','原生源码总量超过大小限制。');
    files.push([path,node.sha,node.size as number]);
  }
  for(const path of ['index.html','package.json','package-lock.json','src/main.tsx'])if(!files.some(file=>file[0]===path))throw new ThemePackageError('NATIVE_ENTRY','原生仓库缺少前台入口或依赖锁文件。');
  return files.sort((a,b)=>a[0]<b[0]?-1:a[0]>b[0]?1:0);
}
