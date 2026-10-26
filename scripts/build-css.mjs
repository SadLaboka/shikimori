import {readFile,writeFile,mkdir,realpath,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';

export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function assembleCss(root){
  const manifest=JSON.parse(await readFile(path.join(root,'css/components.json'),'utf8'));
  if(manifest.version!==1||!Array.isArray(manifest.parts)||!manifest.parts.length)
    throw new Error('Invalid CSS component manifest.');
  const seen=new Set(),buffers=[];
  const directory=await realpath(path.join(root,'css/components'));
  for(const entry of manifest.parts){
    if(typeof entry!=='string'||!/^components\/[a-z0-9-]+\.css$/.test(entry)||seen.has(entry))
      throw new Error(`Invalid or duplicate component: ${entry}`);
    seen.add(entry);
    const file=await realpath(path.join(root,'css',entry));
    if(path.dirname(file)!==directory)throw new Error('Component escapes its directory.');
    buffers.push(await readFile(file));
  }
  for(const name of await readdir(directory)){
    if(name.endsWith('.css')&&!seen.has('components/'+name))throw new Error(`Unlisted component: ${name}`);
  }
  return Buffer.concat(buffers); // No parsing, sorting, whitespace or @import rewriting.
}

export async function buildCss(root,{write=false,output='styles_optimized.css'}={}){
  const bytes=await assembleCss(root);
  const target=path.resolve(root,output),relative=path.relative(root,target).split(path.sep).join('/');
  if(relative!=='styles_optimized.css'&&!/^\.preview\/.+\.css$/.test(relative))
    throw new Error('Output must be styles_optimized.css or a CSS candidate inside .preview/.');
  if(write){
    await mkdir(path.dirname(target),{recursive:true});
    // Refuse writing through an existing link outside the workspace.
    const parent=await realpath(path.dirname(target)),workspace=await realpath(root);
    const parentRelative=path.relative(workspace,parent);
    if(parentRelative==='..'||parentRelative.startsWith('..'+path.sep)||path.isAbsolute(parentRelative))
      throw new Error('Output directory escapes the workspace.');
    let actual;
    try{actual=await realpath(target);}catch(error){if(error.code!=='ENOENT')throw error;}
    if(actual&&actual!==path.join(parent,path.basename(target)))throw new Error('Output must not be a file link.');
    await writeFile(target,bytes);
  }else if(!bytes.equals(await readFile(target))){
    throw new Error('CSS output is stale. Build a .preview/ candidate, verify it, then update styles_optimized.css.');
  }
  return {mode:write?'write':'check',parts:JSON.parse(await readFile(path.join(root,'css/components.json'),'utf8')).parts.length,
    bytes:bytes.length,sha256:sha256(bytes),output:relative};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const {values}=parseArgs({options:{check:{type:'boolean'},write:{type:'boolean'},output:{type:'string'}}});
    if(values.check&&values.write)throw new Error('Choose --check or --write.');
    const root=fileURLToPath(new URL('../',import.meta.url));
    console.log(JSON.stringify(await buildCss(root,{write:values.write,output:values.output}),null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
