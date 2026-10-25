import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {OWNED_IMPORTS,ownedImportRevision,planFoundation,assertVersionPinBytes,prepareUser,joinCompiled} from './css.mjs';
import {verifyMain1ButtonCandidate,verifyMain1ButtonCssomDelta,DUPLICATE_BUTTON_BLOCK} from './main1-button-pilot.mjs';
for(const spec of OWNED_IMPORTS) {

test(`${spec.local}: owned-source relocation only changes an approved URL label at the same cascade position`,()=>{
  const source=`@import "https://example.test/before.css";@import "${spec.source}";@import "https://example.test/after.css";`;
  const local=source.replace(spec.source,spec.target);
  const prefix=`/* https://example.test/before.css */a{color:red}/* ${spec.source} */b{color:blue}/* https://example.test/after.css */c{color:green}`;
  const result=planFoundation(local,source,prefix);
  assert.equal(result.foundation,prefix.replace(spec.source,spec.target));assert.equal(result.ownedImports.length,1);
  for(const candidate of [local.replace('SadLaboka/shikimori','Other/repo'),local.replace(spec.target.split('/').at(-1),'unapproved.css'),local.replace(ownedImportRevision(spec),'a'.repeat(40)),local.replace(`@import "${spec.target}";`,'')])
    assert.throws(()=>planFoundation(candidate,source,prefix));
});

test(`${spec.local}: owned baseline and approved working version are bound to safe paths and exact bytes`,async()=>{
  const revision=ownedImportRevision(spec);
  const snapshot=await readFile(new URL('../../'+spec.snapshot,import.meta.url));
  const working=await readFile(new URL('../../'+spec.local,import.meta.url));
  const committed=execFileSync('git',['show',`${revision}:${spec.local}`],{maxBuffer:2*1024*1024});
  if(spec.local==='css/base/main_code_1.css')verifyMain1ButtonCandidate(snapshot,working);
  else assertVersionPinBytes(spec,snapshot,working);
  assertVersionPinBytes(spec,snapshot,committed);
  assert.throws(()=>assertVersionPinBytes(spec,snapshot,Buffer.concat([working,Buffer.from('\nbody{color:red}')])));
  for(const changed of [{...spec,local:'../deploy.local.json'},{...spec,target:spec.target.replace('/css/base/','/other/')},{...spec,sha256:'0'.repeat(64)},{...spec,snapshot:'styles_optimized.css'},{...spec,source:'https://example.test/a.css'}])
    assert.throws(()=>ownedImportRevision(changed));
});

test(`${spec.local}: real module preserves CSSOM except its explicitly approved optimization`,async()=>{
  const snapshot=await readFile(new URL('../../'+spec.snapshot,import.meta.url),'utf8');
  const module=await readFile(new URL('../../'+spec.local,import.meta.url),'utf8');
  const source=`@import "${spec.source}";@media(min-width:1025px){.menu{position:sticky}}`;
  const local=source.replace(spec.source,spec.target),prefix=`/* ${spec.source} */${snapshot}`;
  const planned=planFoundation(local,source,prefix);
  const browser=await chromium.launch();try{const page=await browser.newPage();await page.setContent('<style></style>');
    const parse=css=>page.evaluate(css=>{const s=document.querySelector('style');s.textContent=css;return [...s.sheet.cssRules].map(r=>r.cssText);},css);
    if(spec.local==='css/base/main_code_1.css')verifyMain1ButtonCssomDelta(await parse(snapshot),await parse(module),await parse(DUPLICATE_BUTTON_BLOCK));
    else assert.deepEqual(await parse(module),await parse(snapshot));
    assert.deepEqual(await parse(joinCompiled(planned.foundation,prepareUser(local))),await parse(joinCompiled(prefix,prepareUser(source))));
    const rules=await parse(module),mediaIndex=rules.findIndex(rule=>rule.startsWith('@media'));
    assert.ok(mediaIndex>=0,'The real module must include a media branch for the negative control');
    const omittedMedia=rules.filter((_,i)=>i!==mediaIndex).join('\n');
    assert.throws(()=>assertVersionPinBytes(spec,Buffer.from(snapshot),Buffer.from(omittedMedia)));
    assert.notDeepEqual(await parse(omittedMedia),rules,'An omitted media branch must change CSSOM');
  }finally{await browser.close();}
});
}
