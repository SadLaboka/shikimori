import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { splitCompiled, prepareUser, joinCompiled } from './css.mjs';
import { readFile } from 'node:fs/promises';

test('browser replacement removes deleted rules, preserves foundation and respects media', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const original = '/* https://example.test/base.css */#target{color:rgb(10,20,30)}\n/* User Custom Styles */#target{color:red;outline:7px solid blue}';
    await page.setContent(`<style id="custom_css">${original}</style><div id="target">preview</div>`);
    const { foundation } = splitCompiled(original);
    const candidate = joinCompiled(foundation, prepareUser('@media(min-width:1024px){#target{color:rgb(0,128,0)}}'));
    await page.locator('#custom_css').evaluate((el, css) => { el.textContent = css; }, candidate);
    const read = () => page.locator('#target').evaluate(el => ({ color: getComputedStyle(el).color,
      outline: getComputedStyle(el).outlineStyle, sheets: document.styleSheets.length }));
    assert.deepEqual(await read(), { color: 'rgb(0, 128, 0)', outline: 'none', sheets: 1 });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.deepEqual(await read(), { color: 'rgb(10, 20, 30)', outline: 'none', sheets: 1 });
    assert.equal(splitCompiled(await page.locator('#custom_css').textContent()).foundation, foundation);
  } finally { await browser.close(); }
});

test('migrated layout parses as the upstream ten rules and keeps the 768px breakpoint', async () => {
  const browser = await chromium.launch();
  try {
    const upstream = await readFile(new URL('../../vendor/profile-content-layout-v1.css', import.meta.url), 'utf8');
    const local = await readFile(new URL('../../styles_optimized.css', import.meta.url), 'utf8');
    const start = local.indexOf('/* BEGIN LOCAL PROFILE LAYOUT');
    const end = local.indexOf('/* END LOCAL PROFILE LAYOUT */');
    const module = local.slice(local.indexOf('*/', start) + 2, end);
    const page = await browser.newPage();
    const rules = css => page.evaluate(text => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(text);
      return [...sheet.cssRules].map(rule => rule.cssText);
    }, css);
    assert.deepEqual(await rules(module), await rules(upstream));
    assert.equal(await page.evaluate(css => {
      const sheet = new CSSStyleSheet(); sheet.replaceSync(css);
      return sheet.cssRules[0].cssRules.length;
    }, module), 10);
    await page.setContent(`<style>${module}</style><div id="profiles_show"><div class="profile-content"><div class="activity"><div class="graph x26">26</div><div class="graph x34">34</div></div></div></div>`);
    for (const width of [767, 768]) {
      await page.setViewportSize({ width, height: 844 });
      const display = await page.locator('.x26').evaluate(el => getComputedStyle(el).display);
      assert.equal(display, width >= 768 ? 'none' : 'block');
    }
  } finally { await browser.close(); }
});
