import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { auditHistory } from './audit.mjs';
import { HISTORY_SOURCE, HISTORY_COMPAT, USER_MARKER, planFoundation } from './css.mjs';
const poster = '/* https://css-club.web.app/css/custom_posters.min.css */\n.b-catalog_entry-tooltip > .entry-tooltip_container > a::before { content: ""; position:absolute; }\n';

test('q03 is the only approved import removed and a component marker is mandatory', () => {
  const published=`@import url("${HISTORY_SOURCE}");@import url("https://css-club.web.app/css/custom_posters.min.css");`;
  const local='@import url("https://css-club.web.app/css/custom_posters.min.css");/* BEGIN LOCAL HISTORY BOOKMARKS */a{}/* END LOCAL HISTORY BOOKMARKS */';
  const prefix=`/* ${HISTORY_SOURCE} */a{}\n${poster}`;
  const result=planFoundation(local,published,prefix);
  assert.equal(result.foundation,poster);
  assert.equal(result.migration.snapshot,'vendor/q03_history_bookmarks.css');
  assert.throws(()=>planFoundation(local.replace('BEGIN LOCAL HISTORY BOOKMARKS','unmarked'),published,prefix));
  assert.throws(()=>planFoundation(local.replace('custom_posters.min.css','other.css'),published,prefix));
});

test('history audit rejects missing rules, duplicates, retained old rules, missing compatibility and changed poster assumptions', async () => {
  const reference=await readFile(new URL('../../vendor/q03_history_bookmarks.css',import.meta.url),'utf8');
  const missing=reference.replace(/\.history-page span > a:before\s*\{[^}]*\}/,'');
  assert.notEqual(missing,reference);
  const browser=await chromium.launch();
  try {
    const page=await browser.newPage();
    await page.setContent(`<style id="custom_css"></style>`);
    for(const width of [1440,390,360]){
      await page.setViewportSize({width,height:844});
      for(const [css,valid] of [
        [`${poster}${USER_MARKER}${reference}${HISTORY_COMPAT}`,true],
        [`${poster}${USER_MARKER}${missing}${HISTORY_COMPAT}`,false],
        [`${poster}${USER_MARKER}${reference}${reference}${HISTORY_COMPAT}`,false],
        [`/* ${HISTORY_SOURCE} */${reference}${poster}${USER_MARKER}${missing}${HISTORY_COMPAT}`,false],
        [`${poster}${USER_MARKER}${reference}`,false],
        [`${poster.replace('content: ""','content: "changed"')}${USER_MARKER}${reference}${HISTORY_COMPAT}`,false],
      ]) {
        await page.locator('#custom_css').evaluate((el,text)=>el.textContent=text,css);
        const audit=await auditHistory(page,reference);
        assert.equal(audit.rules.length,7);
        assert.equal(audit.valid,valid,`${width}px history structural audit`);
      }
    }
  }finally{await browser.close();}
});

test('q03 compatibility preserves all three link types and both locales, including nested tooltips', async()=>{
  const reference=await readFile(new URL('../../vendor/q03_history_bookmarks.css',import.meta.url),'utf8');
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage();
    await page.setContent(`<html data-locale="ru"><style id="custom_css"></style><body><div class="history-page">${['a','m','r'].map(t=>`<span><a href="/${t}/1">entry</a></span>`).join('')}<div class="b-catalog_entry-tooltip"><div class="entry-tooltip_container"><a href="/a/1">nested</a></div></div></div></body></html>`);
    const read=()=>page.locator('a').evaluateAll(links=>links.map(el=>{const cs=getComputedStyle(el,'::before');return [cs.content,cs.width,cs.height,cs.color,cs.borderTop,cs.marginRight,cs.borderRadius];}));
    for(const width of [1440,390,360])for(const locale of ['ru','en']){
      await page.setViewportSize({width,height:844});
      await page.locator('html').evaluate((el,value)=>el.dataset.locale=value,locale);
      await page.locator('#custom_css').evaluate((el,text)=>el.textContent=text,reference+poster);
      const old=await read();
      await page.locator('#custom_css').evaluate((el,text)=>el.textContent=text,poster+reference+HISTORY_COMPAT);
      assert.deepEqual(await read(),old,`${width}px ${locale}`);
      if(locale==='ru'){
        await page.locator('#custom_css').evaluate((el,text)=>el.textContent=text,poster+reference);
        assert.notDeepEqual(await read(),old,'Omitted compatibility must produce a visible semantic difference');
      }
    }
  }finally{await browser.close();}
});
