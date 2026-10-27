import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assembleCss} from '../scripts/build-css.mjs';
import {assembleVariant, recolorCss} from '../scripts/build-emerald-scarlet.mjs';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
test('alternative preserves imports, resource URLs, media boundaries and animation timing', async () => {
  const base = (await assembleCss(root)).toString();
  const variant = (await assembleVariant(root)).toString();
  for (const pattern of [/@import[^;]+;/g, /animation:[^;]+;/g])
    assert.deepEqual(variant.match(pattern), base.match(pattern));
  const palette = await readFile(new URL('../css/themes/emerald-scarlet/palette.css', import.meta.url), 'utf8');
  assert.deepEqual(variant.match(/url\([^)]+\)/g), [...base.match(/url\([^)]+\)/g), ...palette.match(/url\([^)]+\)/g)]);
  assert.ok(variant.includes('--es-background-left: url("https://res.cloudinary.com/dostk7gvx/image/upload/v1793094848/zoro-1440p-compact_wr76ep.webp");'));
  assert.ok(variant.includes('--es-background-right: url("https://res.cloudinary.com/dostk7gvx/image/upload/v1793127787/shanks-1440p-under10mb_k7lf3t.webp");'));
  assert.equal((variant.match(/min-width: 1280px/g) ?? []).length, (base.match(/min-width: 1280px/g) ?? []).length + 1);
  assert.deepEqual(await assembleCss(root), await readFile(new URL('../styles_optimized.css', import.meta.url)));
});
test('color translation retains alpha and does not translate unrelated colors', () => {
  const colors = {hex: {'#333dff': '#38d982'}, rgb: {'51,61,255': '56, 217, 130'}};
  assert.equal(recolorCss('a{color:#333dff;box-shadow:0 0 8px rgba(51, 61, 255, 0.3);background:rgb(1,2,3)}', colors),
    'a{color:#38d982;box-shadow:0 0 8px rgba(56, 217, 130, 0.3);background:rgb(1,2,3)}');
  const unchanged = '/* #333dff */ @import "https://example.test/#333dff";a{background:url(https://example.test/#333dff);content:"#333dff"}';
  assert.equal(recolorCss(unchanged, colors), unchanged);
});
