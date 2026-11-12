import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateInlineSchemes, checkedSource, pinnedSource } from '../scripts/build-inline-schemes.mjs';
import { SCHEMES, schemeCss, schemeImports, recognize, sha256 } from '../extensions/firefox/catalog.mjs';
import { AVATAR_HOVER_CSS } from '../extensions/firefox/avatar-hover.mjs';

test('runtime payloads reproduce the reviewed snapshots, contain no CSS imports and fit after textarea CRLF conversion', async () => {
  const generated = await generateInlineSchemes();
  assert.equal(await readFile(new URL('../extensions/firefox/inline-schemes.mjs', import.meta.url), 'utf8'), generated.module);
  for (const scheme of SCHEMES) {
    const css = schemeCss(scheme.id);
    assert.equal(css, generated.schemes[scheme.id]);
    assert.equal(/@import\b/i.test(css), false);
    assert.ok((css.match(/@font-face/g) ?? []).length >= 5);
    const saved = css.replaceAll('\n', '\r\n');
    assert.ok(saved.length < 512000); assert.ok(Buffer.byteLength(saved) < 512000);
    assert.equal(await sha256(css), generated.meta.schemes[scheme.id].sha256);
    assert.equal(await recognize(saved), scheme.id);
    assert.equal(await recognize(`${schemeImports(scheme.id)}\n\n${AVATAR_HOVER_CSS}`), scheme.id);
    assert.equal(await recognize(css + '\n@media(max-width:1px){html{color:red}}'), null);
    assert.equal(await recognize(css.replace('fonts.gstatic.com', 'example.invalid')), null);
  }
});
test('bundle generation refuses mutable revisions, foreign paths and altered source hashes', async () => {
  for (const url of ['https://raw.githubusercontent.com/SadLaboka/shikimori/main/styles_optimized.css',
    `https://example.invalid/${'a'.repeat(40)}/styles_optimized.css`,
    `https://raw.githubusercontent.com/SadLaboka/shikimori/${'a'.repeat(40)}/deploy.local.json`]) assert.throws(() => pinnedSource(url));
  const meta = JSON.parse(await readFile(new URL('../extensions/firefox/inline-sources.json', import.meta.url), 'utf8'));
  await assert.rejects(checkedSource(meta.bases[0].url, '0'.repeat(64)), /hash differs/);
});
