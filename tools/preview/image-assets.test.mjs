import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {planImageAssets,rewriteKnownImageRules} from './image-assets.mjs';
import {E_DESIGN_PINS} from './css.mjs';
const spec=JSON.parse(await readFile(new URL('../../css/image-assets.json',import.meta.url),'utf8'));
test('image migration verifies exact source CSSOM, remote bytes, order and inactive media rules',async()=>{
 const browser=await chromium.launch();try{
  const page=await browser.newPage();
  const signature=css=>page.evaluate(css=>{const s=document.createElement('style');s.textContent=css;s.media='not all';document.head.append(s);try{return [...s.sheet.cssRules].map(r=>r.cssText.replace(/https?:\/\//g,'//'));}finally{s.remove()}},css);
  const getSource=async url=>{const row=spec.modules.find(m=>m.target===url);return {ok:()=>true,body:()=>readFile(new URL('../../'+row.file,import.meta.url))}};
  let foundation='';
  for(const row of spec.modules){
   const original=execFileSync('git',['show',`${spec.sourceRevision}:${row.file}`],{encoding:'utf8',maxBuffer:2*1024*1024});
   const rules=await signature(original);
   const pin=E_DESIGN_PINS.find(p=>p.snapshot===row.file.replace('css/base/','vendor/edesign/'));
   const pairs=(pin.compiledUrlRewrites??[]).flatMap(e=>e.urls);
   const compiled=rules.map(r=>{for(const {from,to}of pairs)r=r.replaceAll(`url("${from}")`,`url("${to}")`);return r;});
   const current=await readFile(new URL('../../'+row.file,import.meta.url),'utf8');
   assert.deepEqual(rewriteKnownImageRules(rules,row.replacements),await signature(current));
   foundation+=`/* ${row.source} */\n${compiled.join('\n')}\n`;
  }
  const before=spec.modules.map(m=>`@import "${m.source}";`).join('\n');
  const after=spec.modules.map(m=>`@import "${m.target}";`).join('\n');
  const planned=await planImageAssets(after,before,foundation,{signature,getSource});
  assert.equal(planned.imageAssets.length,3);
  assert.equal((await signature(planned.foundation)).length,(await signature(foundation)).length);
  await assert.rejects(planImageAssets(after+'@import "https://other.test/x.css";',before,foundation,{signature,getSource}),/unrelated/);
  await assert.rejects(planImageAssets(after,before,foundation,{signature,getSource:async()=>({ok:()=>true,body:async()=>Buffer.from('bad')})}),/Remote/);
  const rules=await signature(foundation),media=rules.find(r=>r.startsWith('@media'));
  assert.ok(media,'inactive media is present for negative control');
  await assert.rejects(planImageAssets(after,before,foundation.replace(media,''),{signature,getSource}),/Live module/);
 }finally{await browser.close()}
});
