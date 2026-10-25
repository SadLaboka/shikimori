import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {E_DESIGN_PINS,planFoundation,assertVersionPinBytes,prepareUser,joinCompiled} from './css.mjs';

const pins=E_DESIGN_PINS;
const source=pins.map(p=>`@import "${p.source}";`).join('');
const pinned=pins.map(p=>`@import "${p.target}";`).join('');
const foundation=pins.map((p,i)=>`/* ${p.source} */.sentinel${i}{color:red}\n`).join('');

test('version pin allowlist keeps import order and all compiled CSS bytes except approved source labels',()=>{
  const plan=planFoundation(pinned,source,foundation);
  assert.equal(plan.versionPins.length,pins.length);
  assert.equal(plan.migration,null);
  let expected=foundation;for(const p of pins)expected=expected.replace(`/* ${p.source} */`,`/* ${p.target} */`);
  assert.equal(plan.foundation,expected);
  assert.throws(()=>planFoundation(pinned.replace(/d54e91b58c7c16def6f73e7289e29f895a984195/g,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),source,foundation));
  assert.throws(()=>planFoundation(pins.toReversed().map(p=>`@import "${p.target}";`).join(''),source,foundation));
  assert.throws(()=>planFoundation(pinned.replace('main_code_2.css','main_code_1.css'),source,foundation));
  assert.throws(()=>planFoundation(pinned.replace('main_code_2.css','main_code_4mob.css'),source,foundation));
  assert.throws(()=>planFoundation(source,pinned,plan.foundation),'Downgrading to master is not implicitly approved');
});

test('pinned snapshots require exact remote and local SHA256; even visually inert omissions are rejected',async()=>{
  for(const pin of pins){
    const bytes=await readFile(new URL('../../'+pin.snapshot,import.meta.url));
    assert.doesNotThrow(()=>assertVersionPinBytes(pin,bytes,Buffer.from(bytes)));
    assert.throws(()=>assertVersionPinBytes(pin,bytes,Buffer.concat([bytes,Buffer.from('\n/* modified */')])));
    assert.throws(()=>assertVersionPinBytes(pin,bytes.subarray(0,bytes.length-10),bytes));
    assert.throws(()=>assertVersionPinBytes({...pin,sha256:'0'.repeat(64)},bytes,bytes));
  }
});

test('approved URL pinning preserves full CSSOM, media and pseudo rules of all actual snapshots',async()=>{
  const blocks=await Promise.all(pins.map(async p=>`/* ${p.source} */${await readFile(new URL('../../'+p.snapshot,import.meta.url),'utf8')}\n`));
  const prefix=blocks.join('');
  const user='@media(min-width:1025px){.l-top_menu-v2{position:sticky}} .custom::before{content:"unchanged"}';
  const plan=planFoundation(pinned+user,source+user,prefix);
  const browser=await chromium.launch();try{const page=await browser.newPage();await page.setContent('<style></style>');
    const parse=css=>page.evaluate(css=>{const s=document.querySelector('style');s.textContent=css;return [...s.sheet.cssRules].map(r=>r.cssText);},css);
    assert.deepEqual(await parse(joinCompiled(plan.foundation,prepareUser(pinned+user))),await parse(joinCompiled(prefix,prepareUser(source+user))));
  }finally{await browser.close();}
});
