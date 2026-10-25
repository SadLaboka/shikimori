import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {MAIN3_SPEC,RADIUS_BEFORE,RADIUS_AFTER,verifyRadiusCandidate,applyRadiusCandidate,verifyRadiusDelta,sampleRadiusMargins} from './main3-radius.mjs';
import {MAIN3_RELEASE,radiusReleaseRevision,planRadiusRelease} from './main3-radius.mjs';

test('main3 release restricts repository, hash and source; preserves every other import and user rule',()=>{
  assert.match(radiusReleaseRevision(),/^[a-f0-9]{40}$/);
  for(const change of [{source:'https://other.test/a.css'},{sha256:'0'.repeat(64)},
    {target:MAIN3_RELEASE.target.replace('SadLaboka','Other')},{target:MAIN3_RELEASE.target.replace('main_code_3','main_code_2')}])
    assert.throws(()=>radiusReleaseRevision({...MAIN3_RELEASE,...change}),/Unapproved/);
  const before=`@import "${MAIN3_RELEASE.source}";@import "https://other.test/a.css";a{color:red}`;
  const after=before.replace(MAIN3_RELEASE.source,MAIN3_RELEASE.target);
  const compiled=`/* ${MAIN3_RELEASE.source} */${RADIUS_BEFORE}/* https://other.test/a.css */a{color:blue}`;
  const planned=planRadiusRelease(after,before,compiled);
  assert.equal(planned.foundation,compiled.replace(RADIUS_BEFORE,RADIUS_AFTER).replace(MAIN3_RELEASE.source,MAIN3_RELEASE.target));
  for(const bad of [after+'b{color:red}',after.replace('https://other.test/a.css','https://other.test/b.css')])
    assert.throws(()=>planRadiusRelease(bad,before,compiled),/only/);
  assert.equal(planRadiusRelease(after,after,planned.foundation).foundation,planned.foundation);
});

test('main3 radius candidate permits only exact declaration removal inside its source block',async()=>{
  const snapshot=await readFile(new URL('../../'+MAIN3_SPEC.snapshot,import.meta.url));
  const candidate=Buffer.from(snapshot.toString().replace(RADIUS_BEFORE,RADIUS_AFTER));
  assert.ok(verifyRadiusCandidate(snapshot,candidate).removedBytes>0);
  for(const bad of [snapshot,Buffer.concat([candidate,Buffer.from('a{color:red}')])])
    assert.throws(()=>verifyRadiusCandidate(snapshot,bad),/only/);
  const foundation=`/* ${MAIN3_SPEC.target} */${snapshot}/* https://other.test/a.css */a{color:red}`;
  assert.equal(applyRadiusCandidate(foundation),foundation.replace(RADIUS_BEFORE,RADIUS_AFTER));
  assert.throws(()=>applyRadiusCandidate(foundation.replace(RADIUS_BEFORE,'')),/exact/);
  assert.throws(()=>applyRadiusCandidate(foundation+`/* ${MAIN3_SPEC.target} */`),/unique/);
});

test('real main3 CSSOM changes one declaration; negative control detects unrelated and winning-radius changes',async()=>{
  const snapshot=await readFile(new URL('../../'+MAIN3_SPEC.snapshot,import.meta.url),'utf8');
  const browser=await chromium.launch();try{
    const page=await browser.newPage();await page.setContent('<!doctype html><style></style><main class="l-page">Page</main>');
    const parse=async css=>page.evaluate(css=>{const s=document.querySelector('style');s.textContent=css;return [...s.sheet.cssRules].map(r=>r.cssText);},css);
    const original=await parse(snapshot),candidate=await parse(snapshot.replace(RADIUS_BEFORE,RADIUS_AFTER));
    const oldRule=await parse(RADIUS_BEFORE),newRule=await parse(RADIUS_AFTER);
    assert.ok(original.slice(original.indexOf(oldRule[0])+1).some(rule=>rule.startsWith('.l-page {')&&rule.includes('border-radius: 8px;')),
      'The winner must be a later unconditional rule with the same selector');
    assert.equal(verifyRadiusDelta(original,candidate,oldRule,newRule).onlyApprovedChange,true);
    assert.throws(()=>verifyRadiusDelta(original,[...candidate,'a { color: red; }'],oldRule,newRule),/outside/);
    const missingWinner=candidate.filter(rule=>!(rule.startsWith('.l-page {')&&rule.includes('border-radius: 8px;')));
    assert.throws(()=>verifyRadiusDelta(original,missingWinner,oldRule,newRule),/outside/);
    await parse(`${RADIUS_BEFORE}.l-page{border-radius:8px}`);
    assert.equal(await page.locator('.l-page').evaluate(el=>getComputedStyle(el).borderRadius),'8px');
    await parse(`${RADIUS_AFTER}.l-page{border-radius:8px}`);
    assert.equal(await page.locator('.l-page').evaluate(el=>getComputedStyle(el).borderRadius),'8px');
    await parse(RADIUS_BEFORE); // Intentionally omit the winning rule.
    assert.equal(await page.locator('.l-page').evaluate(el=>getComputedStyle(el).borderRadius),'0px');
    await parse('.l-page{width:100px;margin:0 auto}');
    const auto=await page.locator('.l-page').evaluate(sampleRadiusMargins);
    const rectBefore=await page.locator('.l-page').boundingBox();
    assert.equal(auto.computed['margin-left'],'auto');
    await parse('.l-page{width:100px;margin:0 10px}');
    const fixed=await page.locator('.l-page').evaluate(sampleRadiusMargins);
    assert.equal(fixed.computed['margin-left'],'10px');
    assert.notDeepEqual(auto.computed,fixed.computed);
    assert.notDeepEqual(rectBefore,await page.locator('.l-page').boundingBox());
  }finally{await browser.close();}
});
