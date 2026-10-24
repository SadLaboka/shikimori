import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { auditLayout } from './audit.mjs';
import { USER_MARKER, LAYOUT_SOURCE } from './css.mjs';

test('live CSSOM audit detects missing, duplicate and leaked foundation copies on every width', async () => {
  const reference = await readFile(new URL('../../vendor/profile-content-layout-v1.css', import.meta.url), 'utf8');
  const missing = reference.replace(/  #profiles_show \.profile-content > \.cc-2 > \.c-left \{\r?\n[\s\S]*?\r?\n  \}/, '');
  assert.notEqual(missing, reference);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<style id="custom_css">${USER_MARKER}\n${reference}</style>`);
    for (const width of [1440, 390, 360]) {
      await page.setViewportSize({ width, height: 844 });
      for (const [css, valid, copies] of [
        [`${USER_MARKER}\n${reference}`, true, 1],
        [`${USER_MARKER}\n${missing}`, false, 0],
        [`${USER_MARKER}\n${reference}\n${reference}`, false, 2],
        [`/* ${LAYOUT_SOURCE} */\n${reference}\n${USER_MARKER}\n${missing}`, false, 1],
      ]) {
        await page.locator('#custom_css').evaluate((el, text) => { el.textContent = text; }, css);
        const audit = await auditLayout(page, reference);
        assert.equal(audit.rules.length, 10); // CSSStyleRule.cssRules may exist even on leaf rules.
        assert.equal(audit.valid, valid, `${width}px ${copies} copies`);
        const left = audit.rules.find(rule => rule.selector.endsWith('> .c-left'));
        assert.equal(left.actualCopies, copies);
        if (css.startsWith('/* https:')) {
          assert.equal(left.foundationCopies, 1);
          assert.equal(left.userCopies, 0);
        }
      }
      await page.locator('#custom_css').evaluate((el, text) => { el.textContent = text; }, `${USER_MARKER}\n${reference}`);
      const ghost = await page.addStyleTag({ content: reference });
      const withGhost = await auditLayout(page, reference);
      assert.equal(withGhost.valid, false);
      assert.equal(withGhost.rules[0].outsideCopies, 1);
      await ghost.evaluate(el => el.remove());
    }
  } finally { await browser.close(); }
});
