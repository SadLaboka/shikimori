import test from 'node:test';
import assert from 'node:assert/strict';
import { schemeImports, IMPORT_MIRRORS } from '../extensions/firefox/catalog.mjs';
import { recompileStyle, cacheSource, formToken, needsCompilation, CACHE_PATH, PROFILE_PATH } from '../extensions/firefox/recompile.mjs';

const token = 'synthetic-form-token-test-only';
const form = `<form action="https://shikimori.io${CACHE_PATH}" method="post"><input name="authenticity_token" value="${token}"></form>`;
test('recompilation uses one owned cache entry and the public page, never sends CSS', async () => {
  const calls = [];
  await recompileStyle(schemeImports('emerald-scarlet'), async (path, options) => {
    calls.push({ path, ...options });
    assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    return new Response(calls.length === 1 ? form : calls.length === 2 ? 'Success. Url is used in 1 style' : 'profile');
  });
  assert.deepEqual(calls.map(item => [item.method, item.path]), [['GET', CACHE_PATH], ['POST', CACHE_PATH], ['GET', PROFILE_PATH]]);
  const fields = new URLSearchParams(calls[1].body);
  assert.equal(fields.get('authenticity_token'), token); assert.equal(fields.get('url'), IMPORT_MIRRORS[0].url);
  assert.equal(fields.size, 2); assert.equal(calls.some(item => item.body?.includes('@import')), false);
  assert.equal(cacheSource(schemeImports('main').replace(IMPORT_MIRRORS[0].url, IMPORT_MIRRORS[0].source)), IMPORT_MIRRORS[0].source);
});
test('foreign sources, malformed forms and unconfirmed resets stop without retries', async () => {
  let calls = 0;
  await assert.rejects(recompileStyle('body{}', async () => { calls++; }), /approved/); assert.equal(calls, 0);
  for (const html of [form.replace('shikimori.io', 'example.invalid'), form.replace('post', 'get'), form.replace(token, ''), '<input name="authenticity_token" value="arbitrary">']) {
    assert.throws(() => formToken(html), /unavailable/);
  }
  for (const failureAt of [1, 2, 3]) {
    calls = 0;
    await assert.rejects(recompileStyle(schemeImports('main'), async () => {
      calls++;
      return new Response(calls === 1 ? form : calls === 2 ? 'Success. Url is used in 1 style' : 'profile', { status: calls === failureAt ? 503 : 200 });
    }));
    assert.equal(calls, failureAt);
  }
});
test('compilation status distinguishes saved source from complete compiled output', () => {
  assert.equal(needsCompilation({ failed_imports: [], compiledPresent: true }), false);
  assert.equal(needsCompilation({ failed_imports: ['missing'], compiledPresent: true }), true);
  assert.equal(needsCompilation({ failed_imports: [], compiled_css: '' }), true);
  assert.equal(needsCompilation({ failed_imports: [], compiled_css: null }), true);
  assert.equal(needsCompilation({ failed_imports: [], compiled_css: 'body{}' }), false);
});
