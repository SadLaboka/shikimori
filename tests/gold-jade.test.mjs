import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {assembleCss} from '../scripts/build-css.mjs';
import {assembleVariant, variants, variantSpec} from '../scripts/build-gold-jade.mjs';
import {assembleVariant as emerald} from '../scripts/build-emerald-scarlet.mjs';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = (await assembleCss(root)).toString('utf8');
const urls = css => [...css.matchAll(/url\([^)]*\)/g)].map(m => m[0]);
const animations = css => [...css.matchAll(/(?:animation[\w-]*|transition[\w-]*):[^;]+;/g)].map(m => m[0]);

for (const variant of variants) test(`variant ${variant}: imports, assets, timing, alpha and layout`, async () => {
  const css = (await assembleVariant(variant)).toString('utf8');
  const translatedBase = css.slice(0, css.indexOf(`\n/* Variant ${variant.replace('-', '.')}:`));
  assert.deepEqual(urls(translatedBase), urls(base));
  assert.deepEqual(animations(translatedBase), animations(base));
  // Undo only the agreed literal substitutions: every other original byte must survive.
  const {colors} = variantSpec(variant);
  const normalize = text => text.replace(/#[\da-f]{6}\b|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?=\s*[,\)])/gi,
    v => v.startsWith('#') ? (colors.hex[v.toLowerCase()] ? '<hex>' : v) :
      (colors.rgb[v.slice(v.indexOf('(') + 1).replace(/\s/g, '')] ? v.slice(0, v.indexOf('(') + 1) + '<rgb>' : v));
  // Compare a token stream after substituting each known color, retaining alpha and declarations.
  let expected = normalize(base);
  let actual = translatedBase;
  for (const hex of new Set(Object.values(colors.hex))) actual = actual.replaceAll(hex, '<hex>');
  for (const rgb of new Set(Object.values(colors.rgb))) {
    actual = actual.replaceAll(`rgb(${rgb}`, 'rgb(<rgb>').replaceAll(`rgba(${rgb}`, 'rgba(<rgb>');
  }
  assert.equal(actual, expected);
  assert.equal(urls(css).length, urls(base).length + (variant === '2-2' ? 9 : 3));
  assert.ok(!css.includes('file:///'));
});
test('reflection swaps characters; same accents occur in cross-paired variants', async () => {
  for (const suffix of ['1', '2']) {
    const normal = (await assembleVariant(`1-${suffix}`)).toString('utf8');
    const mirrored = (await assembleVariant(`2-${suffix === '1' ? '2' : '1'}`)).toString('utf8');
    const normalize = s => s.split('\n/* BEGIN GOLD & JADE 2.2')[0].replace(/\/\* Variant[^\n]+\*\//, '').replace(/--gj-positions:[^;]+;/, '').replace(/--gj-mirror:[^;]+;/, '');
    assert.equal(normalize(normal), normalize(mirrored));
  }
});
test('character-matching and opposite accents follow the visible side after reflection', () => {
  for (const variant of variants) {
    const {palette, colors} = variantSpec(variant);
    const mirrored = variant.startsWith('2');
    const opposite = variant.endsWith('2');
    assert.ok(palette.includes('--gj-positions: left center, right center;'));
    assert.ok(palette.includes(`--gj-mirror: ${mirrored ? '-1' : '1'};`));
    assert.equal(colors.hex['#333dff'], mirrored !== opposite ? '#3bebc0' : '#ffd842');
    assert.equal(colors.hex['#bd0f56'], mirrored !== opposite ? '#ffd842' : '#3bebc0');
  }
});
test('existing Emerald & Scarlet assembly stays byte identical', async () => {
  assert.deepEqual(await emerald(root), await readFile(new URL('../css/themes/emerald-scarlet/styles.css', import.meta.url)));
});
test('other three Gold & Jade variants remain byte identical', async () => {
  for (const variant of variants.filter(v => v !== '2-2'))
    assert.deepEqual(await assembleVariant(variant, root), await readFile(new URL(`../css/themes/gold-jade/variants/${variant}/styles.css`, import.meta.url)));
});
test('standalone scheme matches verified 2.2 and the default CLI checks both outputs', async () => {
  const canonical = await readFile(new URL('../css/themes/gold-jade/styles.css', import.meta.url));
  assert.deepEqual(canonical, await assembleVariant('2-2', root));
  const result = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/build-gold-jade.mjs', import.meta.url)), '--check'], {encoding: 'utf8'}));
  assert.equal(result.variant, '2-2');
  assert.deepEqual(result.output, ['css/themes/gold-jade/variants/2-2/styles.css', 'css/themes/gold-jade/styles.css']);
});
test('reject unknown variant names', () => assert.throws(() => variantSpec('../other')));
