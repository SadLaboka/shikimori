import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ADDON_ID, REPOSITORY, UPDATE_TAG, assertCanUpdate, hash, releaseInfo, updateManifest } from './firefox-release-info.mjs';

export class GitHubRelease {
  constructor({ token, fetchImpl = fetch }) { if (!token) throw Error('GitHub release token is missing.'); Object.assign(this, { token, fetchImpl }); }
  async request(method, route, body, type = 'application/json') {
    const url = new URL(route, `https://api.github.com/repos/${REPOSITORY}/`);
    if (!['https://api.github.com', 'https://uploads.github.com'].includes(url.origin) ||
        !url.pathname.startsWith(`/repos/${REPOSITORY}/`)) throw Error('Unexpected GitHub API URL.');
    const response = await this.fetchImpl(url, { method, redirect: 'error', signal: AbortSignal.timeout(60000),
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        ...(body === undefined ? {} : { 'Content-Type': type }) },
      ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }) });
    if (response.status === 404 && method === 'GET') return null;
    if (!response.ok) throw Error(`GitHub release request failed (HTTP ${response.status}).`);
    return response.status === 204 ? null : response.json();
  }
  get(tag) { return this.request('GET', `releases/tags/${encodeURIComponent(tag)}`); }
  create(tag, commit, draft) { return this.request('POST', 'releases', { tag_name: tag, target_commitish: commit, draft,
    name: tag === UPDATE_TAG ? 'Firefox auto-update feed' : tag, prerelease: false, make_latest: tag === UPDATE_TAG ? 'false' : 'true',
    body: tag === UPDATE_TAG ? 'Update metadata for the signed personal Firefox extension.' : 'Signed Shikimori Firefox extension. Install the XPI file to use this version.' }); }
  async bytes(asset) {
    const response = await this.fetchImpl(`https://api.github.com/repos/${REPOSITORY}/releases/assets/${asset.id}`, {
      redirect: 'manual', signal: AbortSignal.timeout(60000), headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/octet-stream' } });
    // Asset data can redirect to a public GitHub storage URL. Never forward the token.
    if (response.status === 302) {
      const destination = new URL(response.headers.get('location'));
      if (destination.protocol !== 'https:' || !['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(destination.hostname)) throw Error('Unexpected GitHub asset redirect.');
      const download = await this.fetchImpl(destination, { redirect: 'error', signal: AbortSignal.timeout(60000) });
      if (!download.ok) throw Error('GitHub asset download failed.');
      return Buffer.from(await download.arrayBuffer());
    }
    if (!response.ok) throw Error('GitHub asset download failed.');
    return Buffer.from(await response.arrayBuffer());
  }
  async upload(release, name, bytes, type) {
    const existing = release.assets.find(asset => asset.name === name);
    if (existing) {
      if (hash(await this.bytes(existing)) !== hash(bytes)) throw Error('An existing release asset has different bytes.');
      return existing;
    }
    const base = release.upload_url.replace(/\{.*$/, '');
    return this.request('POST', `${base}?name=${encodeURIComponent(name)}`, bytes, type);
  }
  rename(asset, name) { return this.request('PATCH', `releases/assets/${asset.id}`, { name }); }
}

export async function publishRelease(info, signedBytes, commit, api) {
  const next = updateManifest(info, signedBytes);
  let index = await api.get(UPDATE_TAG);
  const previousAsset = index?.assets.find(asset => asset.name === 'updates.json');
  const previousBytes = previousAsset ? await api.bytes(previousAsset) : null;
  assertCanUpdate(previousBytes ? JSON.parse(previousBytes.toString('utf8')) : null, next);
  let release = await api.get(info.tag);
  release ??= await api.create(info.tag, commit, true);
  await api.upload(release, info.file, signedBytes, 'application/x-xpinstall');
  if (release.draft) await api.request('PATCH', `releases/${release.id}`, { draft: false, make_latest: 'true' });
  index ??= await api.create(UPDATE_TAG, commit, false);
  const manifestBytes = Buffer.from(JSON.stringify(next, null, 2) + '\n');
  if (!previousBytes || hash(previousBytes) !== hash(manifestBytes)) {
    // Upload first; preserve the old feed and restore its name if the final
    // rename fails. Versioned XPIs are immutable and published before the feed.
    const candidate = await api.upload(index, `updates-${info.version}.json`, manifestBytes, 'application/json');
    if (previousAsset) await api.rename(previousAsset, `updates-backup-${previousAsset.id}.json`);
    try { await api.rename(candidate, 'updates.json'); }
    catch (error) {
      if (previousAsset) await api.rename(previousAsset, 'updates.json');
      throw error;
    }
  }
  return next;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = new URL('../', import.meta.url);
    const manifest = JSON.parse(await readFile(new URL('extensions/firefox/manifest.json', root), 'utf8'));
    const info = releaseInfo(manifest, process.env.RELEASE_TAG);
    if (!/^[a-f0-9]{40}$/.test(process.env.RELEASE_COMMIT ?? '')) throw Error('A verified release commit is required.');
    const bytes = await readFile(new URL(`.preview/firefox-release/signed/${info.file}`, root));
    const update = await publishRelease(info, bytes, process.env.RELEASE_COMMIT,
      new GitHubRelease({ token: process.env.GH_TOKEN }));
    await writeFile(new URL('.preview/firefox-release/updates.json', root), JSON.stringify(update, null, 2) + '\n');
    console.log(`Published signed Firefox ${info.version} and updated its feed.`);
  } catch { console.error('Release stopped. Check the GitHub release assets before resuming.'); process.exitCode = 1; }
}
