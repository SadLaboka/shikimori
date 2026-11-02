import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
export function verifyImageReplacement(before,after,spec){
  if(hash(before)!==spec.sourceSha256)throw new Error('Original CSS hash differs.');
  let expected=before.toString('utf8');
  const seen=new Set();
  for(const {from,to}of spec.replacements){
    if(!from||seen.has(from)||!expected.includes(from)||
        !/^https:\/\/raw\.githubusercontent\.com\/SadLaboka\/shikimori\/[a-f0-9]{40}\/assets\/images\/[a-f0-9]{64}\.(png|jpg|webp|gif)$/.test(to))
      throw new Error('Invalid or missing image replacement.');
    seen.add(from);expected=expected.replaceAll(from,to);
  }
  if(!Buffer.from(expected).equals(after)||hash(after)!==spec.sha256)
    throw new Error('CSS differs outside approved image URLs.');
}
export async function verifyImageAssets(){
  const assets=JSON.parse(await readFile(path.join(root,'assets/images/manifest.json'),'utf8'));
  const migration=JSON.parse(await readFile(path.join(root,'css/image-assets.json'),'utf8'));
  if(migration.version!==1||! /^[a-f0-9]{40}$/.test(migration.sourceRevision))throw new Error('Invalid source revision.');
  for(const image of assets.images){
    if(!new RegExp(`^assets/images/${image.sha256}\\.(webp|gif|png|jpg)$`).test(image.file))throw new Error('Invalid image path.');
    const bytes=await readFile(path.join(root,image.file));
    if(hash(bytes)!==image.sha256||bytes.length!==image.bytes)throw new Error('Image hash/size differs.');
  }
  for(const spec of migration.modules){
    if(!/^css\/base\/main_code_(1|3|4mob)\.css$/.test(spec.file))throw new Error('Invalid module.');
    const before=execFileSync('git',['show',`${migration.sourceRevision}:${spec.file}`],{cwd:root});
    verifyImageReplacement(before,await readFile(path.join(root,spec.file)),spec);
    if(spec.target){
      const prefix='https://raw.githubusercontent.com/SadLaboka/shikimori/';
      if(!spec.target.startsWith(prefix)||!spec.source.startsWith(prefix))throw new Error('Invalid module origin.');
      for(const url of [spec.source,spec.target]){
        const suffix=url.slice(prefix.length);
        if(!new RegExp(`^[a-f0-9]{40}/${spec.file.replaceAll('.','\\.')}$`).test(suffix))throw new Error('Invalid module URL.');
      }
      const revision=spec.target.slice(prefix.length).split('/')[0];
      if(hash(execFileSync('git',['show',`${revision}:${spec.file}`],{cwd:root,maxBuffer:2*1024*1024}))!==spec.sha256)throw new Error('Pinned CSS module hash differs.');
    }
    for(const {to}of spec.replacements){
      const parts=new URL(to).pathname.split('/'),revision=parts[3],file=parts.slice(4).join('/');
      const entry=assets.images.find(e=>e.file===file);
      if(!entry||hash(execFileSync('git',['show',`${revision}:${file}`],{cwd:root,maxBuffer:25*1024*1024}))!==entry.sha256)
        throw new Error('Pinned image differs from archived original.');
    }
  }
  return {images:assets.images.length,modules:migration.modules.length,pass:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(await verifyImageAssets()));}catch(e){console.error(e.message);process.exitCode=1;}
}
