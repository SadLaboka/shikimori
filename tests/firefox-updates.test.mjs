import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUpdate, compareVersions, RELEASE_API } from '../extensions/firefox/updates.mjs';

const release = (version = '0.4.0') => ({ tag_name: `firefox-v${version}`, draft: false, prerelease: false,
  assets: [{ name: `shikimori-schemes-${version}.xpi`, state: 'uploaded',
    browser_download_url: `https://github.com/SadLaboka/shikimori/releases/download/firefox-v${version}/shikimori-schemes-${version}.xpi` }] });
test('manual update check sends no credentials and returns only the exact repository XPI', async () => {
  let calls = 0;
  const update = await checkUpdate('0.3.0', async (url, options) => {
    calls++; assert.equal(url, RELEASE_API); assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer'); assert.equal(options.cache, 'no-store');
    assert.deepEqual(Object.keys(options.headers), ['Accept']);
    return Response.json(release());
  });
  assert.equal(calls, 1); assert.equal(update.version, '0.4.0'); assert.ok(update.url.endsWith('shikimori-schemes-0.4.0.xpi'));
});
test('current and older releases never offer a downgrade', async () => {
  for (const version of ['0.3.0', '0.2.2']) assert.equal(await checkUpdate('0.3.0', async () => Response.json(release(version))), null);
  assert.equal(compareVersions('0.10.0', '0.3.0'), 1);
});
test('metadata cannot supply foreign, unsigned, draft, prerelease or missing downloads', async () => {
  const foreign = release(); foreign.assets[0].browser_download_url = 'https://example.org/other.xpi';
  const missing = release(); missing.assets = [];
  const unsigned = release(); unsigned.assets[0].name = 'source.zip';
  for (const value of [foreign, missing, unsigned, { ...release(), draft: true }, { ...release(), prerelease: true }, { ...release(), tag_name: 'unrelated' }])
    await assert.rejects(checkUpdate('0.3.0', async () => Response.json(value)));
});
test('network, invalid JSON, API throttling and malformed versions fail without retry', async () => {
  let calls = 0;
  await assert.rejects(checkUpdate('0.3.0', async () => { calls++; return new Response('', { status: 403 }); }));
  assert.equal(calls, 1);
  await assert.rejects(checkUpdate('0.3.0', async () => { throw Error('offline'); }));
  await assert.rejects(checkUpdate('0.3.0', async () => new Response('invalid json')));
  for (const value of ['v0.3.0', '00.3.0', '0.3', '0.3.0-beta', '999999999999999999.0.0']) assert.throws(() => compareVersions(value, '0.3.0'));
});
