import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {extractLocal,E_DESIGN_PINS} from './css.mjs';
import {verifyImageReplacement} from '../../scripts/verify-image-assets.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const spec=JSON.parse(await readFile(new URL('../../css/image-assets.json',import.meta.url),'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
export function rewriteKnownImageRules(rules,replacements){
  return rules.map(rule=>rule.replace(/url\("([^"\n]+)"\)/g,(token,url)=>{
    const row=replacements.find(e=>e.from.replace('/\\x/','/x/').replace(/^https?:/,'')===url);
    return row?`url("${row.to.replace(/^https?:/,'')}")`:token;
  }));
}
export async function planImageAssets(local,published,foundation,{signature,getSource}){
  const imports=extractLocal(local).imports,oldImports=extractLocal(published).imports;
  const modules=spec.modules.filter(row=>row.target&&imports.includes(row.target));
  if(!modules.length)return null;
  if(imports.length!==oldImports.length||imports.some((url,i)=>url!==oldImports[i]&&!modules.some(m=>m.source===oldImports[i]&&m.target===url)))
    throw new Error('Image migration cannot change unrelated imports or their order.');
  let candidate=foundation;
  const verified=[];
  for(const row of modules){
    const original=execFileSync('git',['show',`${spec.sourceRevision}:${row.file}`],{cwd:root,maxBuffer:2*1024*1024});
    const working=await readFile(new URL('../../'+row.file,import.meta.url));
    verifyImageReplacement(original,working,row);
    const remote=await getSource(row.target);
    if(!remote.ok()||hash(await remote.body())!==row.sha256)throw new Error('Remote image module differs from checked bytes.');
    const current=oldImports.includes(row.target)?row.target:row.source;
    const markers=[...candidate.matchAll(/\/\*\s*(https?:[^*]+?)\s*\*\//g)];
    const found=markers.filter(m=>m[1]===current);
    if(found.length!==1)throw new Error('Image module requires one exact source marker.');
    const marker=found[0],index=markers.indexOf(marker),end=markers[index+1]?.index??candidate.length;
    const block=candidate.slice(marker.index,end);
    const before=await signature(original.toString('utf8'));
    const after=await signature(working.toString('utf8'));
    if(JSON.stringify(rewriteKnownImageRules(before,row.replacements))!==JSON.stringify(after))throw new Error('Image module CSSOM changed outside approved URLs.');
    const pin=E_DESIGN_PINS.find(p=>p.snapshot===row.file.replace('css/base/','vendor/edesign/'));
    const compiledPairs=(pin.compiledUrlRewrites??[]).flatMap(e=>e.urls);
    const compile=rules=>rules.map(rule=>{
      for(const {from,to}of compiledPairs)rule=rule.replaceAll(`url("${from}")`,`url("${to}")`);
      return rule;
    });
    const expected=compile(current===row.target?after:before);
    if(JSON.stringify(expected)!==JSON.stringify(await signature(block)))throw new Error('Live module differs from the approved source/observed compiler rewrites.');
    candidate=candidate.slice(0,marker.index)+`/* ${row.target} */\n${compile(after).join('\n')}\n`+candidate.slice(end);
    verified.push({file:row.file,target:row.target,sha256:row.sha256,rules:after.length,remoteVerified:true});
  }
  return {foundation:candidate,migration:null,imageAssets:verified};
}
