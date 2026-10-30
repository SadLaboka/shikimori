import { createHmac, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ADDON_ID, hash, releaseInfo } from './firefox-release-info.mjs';

export function authorization(key, secret, now = Date.now()) {
  if (!key || !secret) throw Error('Configure AMO_API_KEY and AMO_API_SECRET in repository secrets.');
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const issued = Math.floor(now / 1000);
  const payload = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: key, jti: randomUUID(), iat: issued, exp: issued + 60 })}`;
  return `JWT ${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
export async function amoVersion(info, { key, secret, fetchImpl = fetch }) {
  const url = `https://addons.mozilla.org/api/v5/addons/addon/${encodeURIComponent(ADDON_ID)}/versions/${info.version}/`;
  const response = await fetchImpl(url, { headers: { Authorization: authorization(key, secret), Accept: 'application/json' },
    redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (response.status === 404) return null;
  if (!response.ok) throw Error(`Mozilla version check failed (HTTP ${response.status}).`);
  const value = await response.json();
  if (value.version !== info.version || value.channel !== 'unlisted' || value.is_disabled) throw Error('Unexpected Mozilla version or distribution channel.');
  return value;
}
export async function downloadSigned(value, { key, secret, fetchImpl = fetch }) {
  if (value.file?.status !== 'public') throw Error('Mozilla review is pending. Re-run this release after approval; the existing version will not be uploaded again.');
  if (!/^sha(256|512):[a-f0-9]+$/.test(value.file.hash ?? '')) throw Error('Mozilla did not provide a supported file checksum.');
  let url = new URL(value.file.url);
  // The first URL must be reported by AMO; credentials never go to a CDN.
  if (url.origin !== 'https://addons.mozilla.org') throw Error('Unexpected Mozilla download origin.');
  for (let hop = 0; hop < 5; hop++) {
    if (!['https://addons.mozilla.org', 'https://addons.cdn.mozilla.net'].includes(url.origin) || url.username || url.password) throw Error('Unexpected download redirect.');
    const headers = url.origin === 'https://addons.mozilla.org' ? { Authorization: authorization(key, secret) } : {};
    const response = await fetchImpl(url.href, { headers, redirect: 'manual', signal: AbortSignal.timeout(60000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) { url = new URL(response.headers.get('location'), url); continue; }
    if (!response.ok) throw Error(`Signed file download failed (HTTP ${response.status}).`);
    const chunks = []; let length = 0;
    for await (const chunk of response.body) { length += chunk.length; if (length > 10000000) throw Error('Signed file is unexpectedly large.'); chunks.push(chunk); }
    const bytes = Buffer.concat(chunks), [algorithm, expected] = value.file.hash.split(':');
    if (hash(bytes, algorithm) !== expected) throw Error('Signed file checksum differs from Mozilla metadata.');
    return bytes;
  }
  throw Error('Too many signed file redirects.');
}
export async function ensureSigned(info, options) {
  let current = await amoVersion(info, options);
  if (!current) {
    // Exactly one submission attempt. Always inspect AMO again, including when
    // web-ext times out, so a later re-run can resume an existing version.
    await options.submit();
    current = await amoVersion(info, options);
  }
  if (!current) throw Error('Mozilla has not confirmed the submitted version. Check Developer Hub before retrying.');
  return downloadSigned(current, options);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = new URL('../', import.meta.url);
    const manifest = JSON.parse(await readFile(new URL('extensions/firefox/manifest.json', root), 'utf8'));
    const info = releaseInfo(manifest, process.env.RELEASE_TAG);
    const credentials = { key: process.env.WEB_EXT_API_KEY, secret: process.env.WEB_EXT_API_SECRET };
    const submit = () => new Promise(resolve => {
      const child = spawn(process.execPath, [fileURLToPath(new URL('tools/firefox-release/node_modules/web-ext/bin/web-ext.js', root)),
        'sign', '--channel=unlisted', '--no-input', '--no-config-discovery',
        '--source-dir', fileURLToPath(new URL('.preview/firefox-release/staging/', root)),
        '--artifacts-dir', fileURLToPath(new URL('.preview/firefox-release/amo-download/', root)), '--approval-timeout=900000'],
      { stdio: 'inherit', windowsHide: true });
      child.once('error', () => resolve()); child.once('exit', () => resolve());
    });
    const bytes = await ensureSigned(info, { ...credentials, submit });
    const folder = new URL('.preview/firefox-release/signed/', root);
    await mkdir(folder, { recursive: true }); await writeFile(new URL(info.file, folder), bytes);
    console.log(`Downloaded approved Firefox ${info.version}; checksum verified.`);
  } catch (error) {
    const safe = /^(Configure AMO_|Mozilla version check failed|Unexpected Mozilla|Mozilla review is pending|Mozilla did not provide|Unexpected download|Signed file|Too many signed|Mozilla has not confirmed)/.test(error.message);
    console.error(safe ? error.message : 'Signing stopped. Check the AMO version/review state and repository secrets.');
    process.exitCode = 1;
  }
}
