import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const REPOSITORY = 'SadLaboka/shikimori';
export const ADDON_ID = 'shikimori-schemes@sadlaboka.local';
export const UPDATE_TAG = 'firefox-updates';
export const UPDATE_URL = `https://github.com/${REPOSITORY}/releases/download/${UPDATE_TAG}/updates.json`;
export const hash = (bytes, algorithm = 'sha512') => createHash(algorithm).update(bytes).digest('hex');
export function versionParts(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw Error('Expected a three-part numeric version.');
  const values = version.split('.').map(Number);
  if (values.some(value => !Number.isSafeInteger(value))) throw Error('Version component is too large.');
  return values;
}
export function compareVersions(a, b) {
  const left = versionParts(a), right = versionParts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return 0;
}
export function releaseInfo(manifest, tag) {
  versionParts(manifest.version);
  const gecko = manifest.browser_specific_settings?.gecko;
  if (gecko?.id !== ADDON_ID || gecko.update_url !== UPDATE_URL || gecko.strict_min_version !== '140.0') throw Error('Unexpected extension identity or update configuration.');
  if (tag !== `firefox-v${manifest.version}`) throw Error('The release tag must match the manifest version.');
  return { version: manifest.version, tag, id: ADDON_ID, minVersion: gecko.strict_min_version,
    file: `shikimori-schemes-${manifest.version}.xpi`, updateUrl: UPDATE_URL };
}
export function updateManifest(info, bytes) {
  return { addons: { [ADDON_ID]: { updates: [{ version: info.version,
    update_link: `https://github.com/${REPOSITORY}/releases/download/${info.tag}/${info.file}`,
    update_hash: `sha512:${hash(bytes)}`, applications: { gecko: { strict_min_version: info.minVersion } } }] } } };
}
export function assertCanUpdate(current, next) {
  if (!current) return;
  const oldRows = current.addons?.[ADDON_ID]?.updates;
  const nextRow = next.addons[ADDON_ID].updates[0];
  if (!Array.isArray(oldRows) || !oldRows.length) throw Error('Unexpected existing update manifest.');
  for (const row of oldRows) {
    const order = compareVersions(row.version, nextRow.version);
    if (order > 0) throw Error('Refusing to replace a newer published update.');
    if (order === 0 && (row.update_hash !== nextRow.update_hash || row.update_link !== nextRow.update_link)) throw Error('This version already has different published bytes.');
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const manifest = JSON.parse(await readFile(new URL('../extensions/firefox/manifest.json', import.meta.url), 'utf8'));
    const info = releaseInfo(manifest, process.env.RELEASE_TAG);
    const destination = new URL('../.preview/firefox-release/', import.meta.url);
    await mkdir(destination, { recursive: true });
    await writeFile(new URL('release.json', destination), JSON.stringify(info, null, 2) + '\n');
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${info.version}\ntag=${info.tag}\nfile=${info.file}\n`);
    console.log(`Validated Firefox release ${info.version}.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
