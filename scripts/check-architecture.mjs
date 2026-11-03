import ts from 'typescript';
import { readdir,readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';

const layers={
  core:['core'],upstream:['core','upstream'],
  'protocols/cfsm':['core','upstream','protocols/cfsm'],
  'protocols/native':['core','upstream','protocols/native'],
  'protocols/komari':['core','upstream','protocols/komari'],
  themes:['core','themes'],management:['core','themes','management'],
  app:['core','upstream','protocols/native','protocols/cfsm','protocols/komari','themes','management','app'],
  runtime:['core','upstream','protocols/native','protocols/cfsm','protocols/komari','themes','management','app','runtime'],
};
const layer=file=>file.startsWith('src/protocols/')?file.split('/').slice(1,3).join('/'):file.split('/')[1];
const nodeModules=new Set([...builtinModules,...builtinModules.map(name=>`node:${name}`),'esbuild','npm','ws','undici','https-proxy-agent']);
/** Check actual TypeScript import/export/import-type/dynamic-import edges, including type-only edges. */
export function architectureErrors(files){
  const errors=[],graph=new Map(),externals=new Map();
  for(const [file,text] of files){
    const edges=new Set(),packages=new Set(),source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true);
    const owner=layer(file);if(!layers[owner])errors.push(`${file}: unclassified source layer`);
    function record(specifier){
      if(!specifier.startsWith('.')){packages.add(specifier);return;}
      let target=path.posix.normalize(path.posix.join(path.posix.dirname(file),specifier)).replace(/\.js$/,'.ts');
      if(!path.posix.extname(target))target+='.ts';
      if(!files.has(target)){errors.push(`${file}: missing source module ${target}`);return;}
      edges.add(target);
      if(!layers[owner]?.includes(layer(target)))errors.push(`${file}: ${owner} cannot import ${target}`);
    }
    function visit(node){
      if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))record(node.moduleSpecifier.text);
      if(ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument)&&ts.isStringLiteral(node.argument.literal))record(node.argument.literal.text);
      if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(node.expression)&&node.expression.text==='require'))){
        if(node.arguments.length===1&&ts.isStringLiteral(node.arguments[0]))record(node.arguments[0].text);
        else errors.push(`${file}: computed module loading prevents boundary verification`);
      }
      ts.forEachChild(node,visit);
    }
    visit(source);graph.set(file,edges);externals.set(file,packages);
    if(owner!=='runtime')for(const name of packages)if(nodeModules.has(name))errors.push(`${file}: Node-only dependency ${name} outside runtime`);
  }
  const visiting=new Set(),visited=new Set();
  function walk(file,chain){
    if(visiting.has(file)){errors.push(`Dependency cycle: ${[...chain,file].join(' -> ')}`);return;}
    if(visited.has(file))return;visiting.add(file);
    for(const next of graph.get(file)||[])walk(next,[...chain,file]);
    visiting.delete(file);visited.add(file);
  }
  for(const file of graph.keys())walk(file,[]);
  // Deferred Worker adapter must remain free of Node imports, even transitively.
  const workerSeen=new Set();
  function worker(file){if(workerSeen.has(file))return;workerSeen.add(file);
    for(const name of externals.get(file)||[])if(nodeModules.has(name))errors.push(`Worker reaches Node-only ${name} through ${file}`);
    for(const next of graph.get(file)||[])worker(next);
  }
  if(graph.has('src/runtime/worker.ts'))worker('src/runtime/worker.ts');
  return [...new Set(errors)];
}
async function sourceFiles(directory){const files=new Map();for(const entry of await readdir(directory,{withFileTypes:true})){const file=`${directory}/${entry.name}`;if(entry.isDirectory())for(const pair of await sourceFiles(file))files.set(...pair);else if(file.endsWith('.ts'))files.set(file,await readFile(file,'utf8'));}return files;}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const files=await sourceFiles('src'),errors=architectureErrors(files);
  if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log(`Architecture boundaries and cycles: ${files.size} source modules passed.`);
}
