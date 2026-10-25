import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {planFoundation,POSTERS_SOURCE,USER_MARKER,HISTORY_COMPAT,joinCompiled,prepareUser} from './css.mjs';
import {auditPosters,auditHistory} from './audit.mjs';
const reference=await readFile(new URL('../../vendor/custom_posters.min.css',import.meta.url),'utf8');
const history=await readFile(new URL('../../vendor/q03_history_bookmarks.css',import.meta.url),'utf8');

test('poster import removal is allowlisted, isolated, and preserves the last foundation boundary',()=>{
  const published=`@import "https://example.test/base.css";@import "${POSTERS_SOURCE}";`;
  const local='@import "https://example.test/base.css";/* BEGIN LOCAL CUSTOM POSTERS */'+reference+'/* END LOCAL CUSTOM POSTERS */';
  const foundation=`/* https://example.test/base.css */a{color:red}/* ${POSTERS_SOURCE} */${reference}`;
  const planned=planFoundation(local,published,foundation);
  assert.equal(planned.foundation,'/* https://example.test/base.css */a{color:red}');
  assert.equal(planned.migration.snapshot,'vendor/custom_posters.min.css');
  assert.throws(()=>planFoundation(local.replace('BEGIN LOCAL CUSTOM POSTERS','unmarked'),published,foundation));
  assert.throws(()=>planFoundation(local.replace('base.css','other.css'),published,foundation));
});

test('poster audit detects missing, duplicate, changed, prefixed and external copies; q03 accepts only an intact local poster snapshot',async()=>{
  const browser=await chromium.launch();try{const page=await browser.newPage();await page.setContent('<style id="custom_css"></style>');
    const rules=await page.evaluate(css=>{const s=document.querySelector('style');s.textContent=css;return [...s.sheet.cssRules].map(r=>r.cssText);},reference);assert.equal(rules.length,10);
    const missing=rules.slice(0,-1).join('\n');
    for(const width of [1440,390,360])for(const [css,valid] of [
      [USER_MARKER+reference,true],[USER_MARKER+missing,false],[USER_MARKER+reference+reference,false],
      [`/* ${POSTERS_SOURCE} */${reference}${USER_MARKER}${missing}`,false],
      [USER_MARKER+reference.replace('width:160px','width:161px'),false],
    ]){await page.setViewportSize({width,height:844});await page.locator('#custom_css').evaluate((el,css)=>el.textContent=css,css);assert.equal((await auditPosters(page,reference)).valid,valid);}
    await page.locator('#custom_css').evaluate((el,css)=>el.textContent=css,USER_MARKER+reference);
    const extra=await page.addStyleTag({content:reference});assert.equal((await auditPosters(page,reference)).valid,false);await extra.evaluate(el=>el.remove());
    for(const [posterCss,source,expected] of [[reference,reference,true],[missing,reference,false],[reference,'',false],[reference+reference,reference,false],[reference.replace('content:""','content:"changed"'),reference,false],[reference.replace('content:""','content:"changed"'),reference.replace('content:""','content:"changed"'),false]]){
      await page.locator('#custom_css').evaluate((el,css)=>el.textContent=css,USER_MARKER+posterCss+history+HISTORY_COMPAT);
      assert.equal((await auditHistory(page,history,source)).valid,expected,'History compatibility must retain its poster assumption after migration');
    }
  }finally{await browser.close();}
});

test('placing posters before AUTO preserves exact parsed cascade; placing them after AUTO is detectable',async()=>{
  const browser=await chromium.launch();try{const page=await browser.newPage();await page.setContent('<style></style>');
    const parse=css=>page.evaluate(css=>{const s=document.querySelector('style');s.textContent=css;return [...s.sheet.cssRules].map(r=>r.cssText);},css);
    const auto='@media(min-width:1025px){.l-top_menu-v2{position:sticky;top:0}}';
    const imports=`@import "https://example.test/base.css";@import "${POSTERS_SOURCE}";`;
    const source=imports+auto+history+HISTORY_COMPAT;
    const block='/* BEGIN LOCAL CUSTOM POSTERS */'+reference+'/* END LOCAL CUSTOM POSTERS */';
    const local=block+source.replace(`@import "${POSTERS_SOURCE}";`,'');
    const prefix=`/* https://example.test/base.css */a{color:red}/* ${POSTERS_SOURCE} */${reference}`;
    const plan=planFoundation(local,source,prefix);
    const before=joinCompiled(prefix,prepareUser(source));
    const after=joinCompiled(plan.foundation,prepareUser(local));
    assert.deepEqual(await parse(after),await parse(before));
    const misplaced=local.replace(block,'').replace(auto,auto+block);
    assert.notDeepEqual(await parse(joinCompiled(plan.foundation,prepareUser(misplaced))),await parse(before));
  }finally{await browser.close();}
});
