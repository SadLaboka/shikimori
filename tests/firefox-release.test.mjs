import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ADDON_ID, UPDATE_URL, assertCanUpdate, hash, releaseInfo, updateManifest } from '../scripts/firefox-release-info.mjs';
import { authorization, amoVersion, downloadSigned, ensureSigned } from '../scripts/sign-firefox.mjs';
import { GitHubRelease, publishRelease } from '../scripts/publish-firefox.mjs';

const manifest = JSON.parse(await readFile(new URL('../extensions/firefox/manifest.json', import.meta.url), 'utf8'));
const info = releaseInfo(manifest, `firefox-v${manifest.version}`);
const credentials = { key: 'user:test-only', secret: 'synthetic-secret-only' };
const bytes = Buffer.from('synthetic-signed-package');
const version = () => ({ version: info.version, channel: 'unlisted', file: { status: 'public',
  url: 'https://addons.mozilla.org/firefox/downloads/file/123/test.xpi', hash: `sha256:${hash(bytes, 'sha256')}` } });
test('release identity, tag and update feed bind exact signed bytes to the right version', () => {
  assert.equal(info.updateUrl, UPDATE_URL);
  const row = updateManifest(info, bytes).addons[ADDON_ID].updates[0];
  assert.equal(row.update_hash, `sha512:${hash(bytes)}`);
  assert.ok(row.update_link.endsWith(`/${info.tag}/${info.file}`));
  for (const tag of ['main', `${info.tag}.1`, `${info.tag};echo test`]) assert.throws(() => releaseInfo(manifest, tag));
  assert.throws(() => releaseInfo({ ...manifest, version: '1.0.0-beta' }, 'firefox-v1.0.0-beta'));
  assert.throws(() => releaseInfo({ ...manifest, browser_specific_settings: {} }, info.tag));
});
test('feed cannot move backwards or change the bytes of an existing version', () => {
  const next = updateManifest(info, bytes);
  assert.doesNotThrow(() => assertCanUpdate(next, next));
  assert.throws(() => assertCanUpdate(updateManifest({ ...info, version: '999.0.0' }, bytes), next), /newer/);
  assert.throws(() => assertCanUpdate(updateManifest(info, Buffer.from('other')), next), /different/);
  assert.throws(() => assertCanUpdate({ addons: {} }, next), /Unexpected/);
});
test('AMO JWT expires quickly; authenticated version reads reject wrong channels and do not redirect', async () => {
  const token = authorization(credentials.key, credentials.secret, 1000000);
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  assert.equal(payload.iss, credentials.key); assert.equal(payload.exp - payload.iat, 60); assert.ok(payload.jti);
  let calls = 0;
  await assert.rejects(amoVersion(info, { ...credentials, fetchImpl: async (url, options) => {
    calls++; assert.equal(options.redirect, 'error'); assert.ok(url.includes(encodeURIComponent(ADDON_ID)));
    assert.match(options.headers.Authorization, /^JWT /); return Response.json({ ...version(), channel: 'listed' });
  } }), /channel/);
  assert.equal(calls, 1);
  await assert.rejects(amoVersion(info, { ...credentials, fetchImpl: async () => new Response('', { status: 403 }) }), /403/);
});
test('existing approved or pending AMO versions never cause another submission', async () => {
  let submits = 0;
  const fetchImpl = async url => url.includes('/api/v5/') ? Response.json(version()) : new Response(bytes);
  assert.deepEqual(await ensureSigned(info, { ...credentials, fetchImpl, submit: async () => submits++ }), bytes);
  assert.equal(submits, 0);
  await assert.rejects(ensureSigned(info, { ...credentials, submit: async () => submits++, fetchImpl: async () =>
    Response.json({ ...version(), file: { status: 'unreviewed' } }) }), /pending/);
  assert.equal(submits, 0);
});
test('one submission is followed by AMO verification even when the CLI loses its response', async () => {
  let reads = 0, submits = 0;
  const result = await ensureSigned(info, { ...credentials, submit: async () => { submits++; }, fetchImpl: async url => {
    if (!url.includes('/api/v5/')) return new Response(bytes);
    reads++; return reads === 1 ? new Response('', { status: 404 }) : Response.json(version());
  } });
  assert.deepEqual(result, bytes); assert.equal(submits, 1); assert.equal(reads, 2);
});
test('signed download strips credentials at the CDN and checks the exact API hash', async () => {
  const seen = [];
  assert.deepEqual(await downloadSigned(version(), { ...credentials, fetchImpl: async (url, options) => {
    seen.push({ url, options });
    return seen.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://addons.cdn.mozilla.net/file.xpi' } }) : new Response(bytes);
  } }), bytes);
  assert.match(seen[0].options.headers.Authorization, /^JWT /); assert.deepEqual(seen[1].options.headers, {});
  let calls = 0;
  await assert.rejects(downloadSigned(version(), { ...credentials, fetchImpl: async () => {
    calls++; return new Response(null, { status: 302, headers: { location: 'https://example.invalid/stolen' } });
  } }), /redirect/); assert.equal(calls, 1);
  await assert.rejects(downloadSigned(version(), { ...credentials, fetchImpl: async () => new Response('corrupted') }), /checksum/);
});

function fakeGitHub({ existing, failRename = false } = {}) {
  const releases = new Map(), contents = new Map(), events = []; let id = 1;
  const api = {
    releases, events, async get(tag) { return releases.get(tag) ?? null; },
    async create(tag, commit, draft) { const value = { id: id++, tag, draft, assets: [] }; releases.set(tag, value); events.push(`create:${tag}`); return value; },
    async bytes(asset) { return contents.get(asset.id); },
    async upload(release, name, data) {
      const previous = release.assets.find(asset => asset.name === name);
      if (previous) { if (hash(contents.get(previous.id)) !== hash(data)) throw Error('different bytes'); return previous; }
      const value = { id: id++, name }; contents.set(value.id, data); release.assets.push(value); events.push(`upload:${name}`); return value;
    },
    async request(method, route, body) { events.push(`public:${route}`); for (const release of releases.values()) if (route === `releases/${release.id}`) release.draft = body.draft; },
    async rename(asset, name) { events.push(`rename:${asset.name}:${name}`); if (failRename && asset.name.startsWith('updates-') && !asset.name.startsWith('updates-backup-') && name === 'updates.json') throw Error('rename failed'); asset.name = name; },
  };
  if (existing) { const asset = { id: id++, name: 'updates.json' }; contents.set(asset.id, Buffer.from(JSON.stringify(existing)));
    releases.set('firefox-updates', { id: id++, assets: [asset], draft: false }); }
  return api;
}
test('publishing makes the immutable XPI public before switching the feed; re-run is idempotent', async () => {
  const api = fakeGitHub(); await publishRelease(info, bytes, 'a'.repeat(40), api);
  const publishedIndex = api.events.findIndex(event => event.startsWith('public:'));
  const feedIndex = api.events.findIndex(event => event.endsWith(':updates.json'));
  assert.ok(publishedIndex >= 0 && feedIndex > publishedIndex);
  const uploadCount = api.events.filter(event => event.startsWith('upload:')).length;
  await publishRelease(info, bytes, 'a'.repeat(40), api);
  assert.equal(api.events.filter(event => event.startsWith('upload:')).length, uploadCount);
});
test('a failed feed rename restores the previous feed and newer feeds stop before any mutation', async () => {
  const old = updateManifest({ ...info, version: '0.0.1' }, Buffer.from('old'));
  const api = fakeGitHub({ existing: old, failRename: true });
  await assert.rejects(publishRelease(info, bytes, 'a'.repeat(40), api), /rename failed/);
  const asset = api.releases.get('firefox-updates').assets.find(item => item.name === 'updates.json');
  assert.deepEqual(JSON.parse((await api.bytes(asset)).toString()), old);
  const newer = fakeGitHub({ existing: updateManifest({ ...info, version: '999.0.0' }, bytes) });
  await assert.rejects(publishRelease(info, bytes, 'a'.repeat(40), newer), /newer/); assert.deepEqual(newer.events, []);
});
test('GitHub client never sends its release token to arbitrary upload URLs', async () => {
  let calls = 0; const api = new GitHubRelease({ token: 'synthetic-token', fetchImpl: async () => { calls++; } });
  await assert.rejects(api.request('POST', 'https://example.invalid/repos/SadLaboka/shikimori/upload', bytes), /Unexpected/);
  await assert.rejects(api.request('POST', 'https://uploads.github.com/repos/Other/Repo/assets', bytes), /Unexpected/);
  assert.equal(calls, 0);
});
test('release creation verifies the existing tag without requesting extra workflow permissions', async () => {
  const calls = [], commit = 'a'.repeat(40);
  const api = new GitHubRelease({ token: 'synthetic-token', fetchImpl: async (url, options) => {
    calls.push({ url: String(url), options });
    return options.method === 'GET' ? Response.json({ object: { type: 'commit', sha: commit } }) : Response.json({ id: 1 });
  } });
  await api.create(info.tag, commit, true);
  const versionBody = JSON.parse(calls.at(-1).options.body);
  assert.equal(versionBody.tag_name, info.tag); assert.equal(Object.hasOwn(versionBody, 'target_commitish'), false);
  await api.create('firefox-updates', commit, false);
  assert.equal(JSON.parse(calls.at(-1).options.body).target_commitish, 'main');
  let writes = 0;
  const wrong = new GitHubRelease({ token: 'synthetic-token', fetchImpl: async (url, options) => {
    if (options.method !== 'GET') writes++; return Response.json({ object: { type: 'commit', sha: 'b'.repeat(40) } });
  } });
  await assert.rejects(wrong.create(info.tag, commit, true), /verified commit/); assert.equal(writes, 0);
});
