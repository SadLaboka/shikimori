import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {auditActivity} from './audit.mjs';
import {ACTIVITY_SOURCE,USER_MARKER,planFoundation} from './css.mjs';
const reference=await readFile(new URL('../../vendor/q05_animated_activity_graph.css',import.meta.url),'utf8');
const posters='/* https://example.test/posters.css */a{color:red}';

test('q05 removal requires complete migration markers and preserves every other import',()=>{
  const published=`@import url("${ACTIVITY_SOURCE}");@import url("https://example.test/posters.css");`;
  const local=`@import url("https://example.test/posters.css");/* BEGIN LOCAL ACTIVITY GRAPH */${reference}/* END LOCAL ACTIVITY GRAPH */`;
  const result=planFoundation(local,published,`/* ${ACTIVITY_SOURCE} */${reference}${posters}`);
  assert.equal(result.foundation,posters);
  assert.equal(result.migration.snapshot,'vendor/q05_animated_activity_graph.css');
  assert.throws(()=>planFoundation(local.replace('BEGIN LOCAL ACTIVITY GRAPH','unmarked'),published,`/* ${ACTIVITY_SOURCE} */${reference}${posters}`));
  assert.throws(()=>planFoundation(local.replace('https://example.test/posters.css','https://example.test/new.css'),published,`/* ${ACTIVITY_SOURCE} */${reference}${posters}`));
});

test('activity audit covers styles and both parsed keyframes, and detects omissions, duplicates and masked old imports',async()=>{
  const missing=reference.replace(/\.bar\.vertical \.line:nth-child\(34\)\s*\{[^}]*\}/,'');
  const missingHover=reference.replace(/\.bar\.vertical \.line:nth-child\(-n \+ 34\):hover\s*\{[^}]*\}/,'');
  const missingFrames=reference.slice(0,reference.indexOf('@keyframes fluctuations'));
  assert.notEqual(missing,reference);assert.notEqual(missingHover,reference);assert.notEqual(missingFrames,reference);
  const browser=await chromium.launch();try{const page=await browser.newPage();await page.setContent('<style id="custom_css"></style>');
    for(const width of [1440,390,360])for(const [css,valid] of [
      [USER_MARKER+reference,true],['.bar.vertical .line{padding:2px}'+USER_MARKER+reference,true],[USER_MARKER+missing,false],[USER_MARKER+missingHover,false],
      [USER_MARKER+missingFrames,false],[USER_MARKER+reference+reference,false],
      [`/* ${ACTIVITY_SOURCE} */${reference}${USER_MARKER}${missing}`,false],
      [USER_MARKER+reference.replaceAll('2.5s 1.6s','2.5s 1.7s'),false],
    ]){await page.setViewportSize({width,height:844});await page.locator('#custom_css').evaluate((el,text)=>el.textContent=text,css);const audit=await auditActivity(page,reference);assert.equal(audit.rules.length,40);assert.equal(audit.valid,valid,`${width}px structural activity audit`);}
    await page.locator('#custom_css').evaluate((el,text)=>el.textContent=text,USER_MARKER+reference);
    const extra=await page.addStyleTag({content:reference});assert.equal((await auditActivity(page,reference)).valid,false);await extra.evaluate(el=>el.remove());
    await page.locator('#custom_css').evaluate((el,text)=>el.textContent=text,'.bar.vertical .line{padding:2px}'+USER_MARKER+reference);
    const before=await auditActivity(page,reference);
    await page.locator('#custom_css').evaluate((el,text)=>el.textContent=text,'.bar.vertical .line{padding:3px}'+USER_MARKER+reference);
    const after=await auditActivity(page,reference);
    assert.equal(before.valid,true);assert.equal(after.valid,true);
    assert.notEqual(before.nonLayoutCascadeHash,after.nonLayoutCascadeHash,'Other declarations with the same selector must remain in the cascade comparison');
  }finally{await browser.close();}
});

test('unoptimized q05 fallback retains all delays, fluctuation phases and hover pause after moving past unrelated rules',async()=>{
  const browser=await chromium.launch();try{const page=await browser.newPage();
    await page.setContent(`<style id="custom_css"></style><div class="bar vertical">${'<div class="line"><div class="bar-container"><div class="bar"></div></div></div>'.repeat(34)}</div>`);
    const read=async(css,phase)=>{await page.locator('#custom_css').evaluate((el,text)=>el.textContent=text,css);return page.evaluate(phase=>{for(const a of document.getAnimations()){a.pause();const t=a.effect.getTiming();a.currentTime=Number(t.delay)+Number(t.duration)*phase;}return [...document.querySelectorAll('.line')].map(el=>{const cs=getComputedStyle(el);return [cs.height,cs.marginTop,cs.marginBottom,cs.animationName,cs.animationDelay,cs.animationDuration,cs.animationPlayState,cs.backgroundColor];});},phase);};
    const unrelated='a{width:160px}';const old=reference+unrelated,newCss=unrelated+reference;
    for(const width of [1440,390,360]){await page.setViewportSize({width,height:844});for(const phase of [0,0.5,1])assert.deepEqual(await read(newCss,phase),await read(old,phase));
      const states=await read(old,0.5);assert.equal(states.length,34);assert.equal(states[0][4],'1.6s');assert.equal(states[33][4],'0s');assert.equal(states[0][3],'fluctuations');assert.equal(states[0][0],'95px');assert.equal(states[0][5],'2.5s');
      await page.locator('.line').first().hover();const hovered=await read(newCss,0.5);assert.equal(hovered[0][6],'paused');assert.deepEqual(hovered,await read(old,0.5));await page.mouse.move(0,0);
    }
  }finally{await browser.close();}
});
