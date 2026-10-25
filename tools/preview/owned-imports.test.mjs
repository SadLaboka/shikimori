import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
import {OWNED_IMPORTS,ownedImportRevision,planFoundation,assertVersionPinBytes,prepareUser,joinCompiled} from './css.mjs';
const spec=OWNED_IMPORTS[0];

test('owned-source relocation only changes an approved URL label at the same cascade position',()=>{
  const source=`@import "https://example.test/before.css";@import "${spec.source}";@import "https://example.test/after.css";`;
  const local=source.replace(spec.source,spec.target);
  const prefix=`/* https://example.test/before.css */a{color:red}/* ${spec.source} */b{color:blue}/* https://example.test/after.css */c{color:green}`;
  const result=planFoundation(local,source,prefix);
  assert.equal(result.foundation,prefix.replace(spec.source,spec.target));assert.equal(result.ownedImports.length,1);
  for(const candidate of [local.replace('SadLaboka/shikimori','Other/repo'),local.replace('main_code_3.css','main_code_4mob.css'),local.replace('e64310020fa1daf487a55f4648391d9b003f49ae','a'.repeat(40)),local.replace(`@import "${spec.target}";`,'')])
    assert.throws(()=>planFoundation(candidate,source,prefix));
});

test('owned module is bound to safe repository path, upstream hash and committed bytes',async()=>{
  const revision=ownedImportRevision(spec);
  const snapshot=await readFile(new URL('../../'+spec.snapshot,import.meta.url));
  const working=await readFile(new URL('../../'+spec.local,import.meta.url));
  const committed=execFileSync('git',['show',`${revision}:${spec.local}`],{maxBuffer:2*1024*1024});
  assertVersionPinBytes(spec,snapshot,working);assertVersionPinBytes(spec,snapshot,committed);
  assert.throws(()=>assertVersionPinBytes(spec,snapshot,Buffer.concat([working,Buffer.from('\nbody{color:red}')])));
  for(const changed of [{...spec,local:'../deploy.local.json'},{...spec,target:spec.target.replace('/css/base/','/other/')},{...spec,sha256:'0'.repeat(64)},{...spec,snapshot:'styles_optimized.css'},{...spec,source:'https://example.test/a.css'}])
    assert.throws(()=>ownedImportRevision(changed));
});

test('the real owned module has identical CSSOM, including media, pseudos and asset paths',async()=>{
  const snapshot=await readFile(new URL('../../'+spec.snapshot,import.meta.url),'utf8');
  const module=await readFile(new URL('../../'+spec.local,import.meta.url),'utf8');
  const source=`@import "${spec.source}";@media(min-width:1025px){.menu{position:sticky}}`;
  const local=source.replace(spec.source,spec.target),prefix=`/* ${spec.source} */${snapshot}`;
  const planned=planFoundation(local,source,prefix);
  const browser=await chromium.launch();try{const page=await browser.newPage();await page.setContent('<style></style>');
    const parse=css=>page.evaluate(css=>{const s=document.querySelector('style');s.textContent=css;return [...s.sheet.cssRules].map(r=>r.cssText);},css);
    assert.deepEqual(await parse(module),await parse(snapshot));
    assert.deepEqual(await parse(joinCompiled(planned.foundation,prepareUser(local))),await parse(joinCompiled(prefix,prepareUser(source))));
  }finally{await browser.close();}
});
