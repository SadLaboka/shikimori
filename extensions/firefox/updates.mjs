// Read public release metadata only. Firefox owns signature checks and installation.
export const RELEASE_API = 'https://api.github.com/repos/SadLaboka/shikimori/releases/latest';
const REPOSITORY_URL = 'https://github.com/SadLaboka/shikimori';
export function compareVersions(left, right) {
  const parts = value => {
    if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) throw Error('Invalid release version');
    const result = value.split('.').map(Number);
    if (!result.every(Number.isSafeInteger)) throw Error('Invalid release version');
    return result;
  };
  const a = parts(left), b = parts(right);
  for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return Math.sign(a[index] - b[index]);
  return 0;
}
export async function checkUpdate(currentVersion, fetchImpl = fetch) {
  const response = await fetchImpl(RELEASE_API, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw Error('Release check failed');
  const release = await response.json();
  const version = /^firefox-v(\d+\.\d+\.\d+)$/.exec(release.tag_name)?.[1];
  if (!version || release.draft || release.prerelease) throw Error('Unexpected release');
  if (compareVersions(version, currentVersion) <= 0) return null;
  const name = `shikimori-schemes-${version}.xpi`;
  const url = `${REPOSITORY_URL}/releases/download/firefox-v${version}/${name}`;
  const asset = release.assets?.find(item => item.name === name && item.state === 'uploaded' && item.browser_download_url === url);
  if (!asset) throw Error('Signed release file is missing');
  return { version, url };
}
