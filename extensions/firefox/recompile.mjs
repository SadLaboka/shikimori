import { IMPORT_MIRRORS, ORIGIN } from './catalog.mjs';

export const CACHE_PATH = '/tests/reset_styles_cache';
export const PROFILE_PATH = '/SadLaboka';
const ownedSources = [IMPORT_MIRRORS[0].url, IMPORT_MIRRORS[0].source];
export function needsCompilation(style) {
  return style.failed_imports?.length > 0 || style.compiledPresent === false ||
    Object.hasOwn(style, 'compiled_css') && (typeof style.compiled_css !== 'string' || !style.compiled_css.trim());
}
export function cacheSource(css) {
  const imports = [...css.matchAll(/@import\s+url\(\s*(['"])(.*?)\1\s*\)\s*;/g)].map(match => match[2]);
  return ownedSources.find(url => imports.includes(url)) ?? null;
}
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/g)].map(match => [match[1].toLowerCase(), match[3]]));
}
export function formToken(html) {
  const form = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)].find(match => {
    const attrs = attributes(match[0].slice(0, match[0].indexOf('>') + 1));
    return attrs.method?.toLowerCase() === 'post' && attrs.action === ORIGIN + CACHE_PATH;
  });
  const input = form && [...form[0].matchAll(/<input\b[^>]*>/gi)].map(match => attributes(match[0]))
    .find(attrs => attrs.name === 'authenticity_token');
  if (!input?.value || !/^[\w+/=-]{20,1024}$/.test(input.value)) throw new Error('Cache reset form unavailable.');
  return input.value;
}
// This invalidates one owned import cache entry, then asks the normal page to
// compile the saved source. It never sends CSS or repeats the publication PATCH.
export async function recompileStyle(css, fetchImpl) {
  const source = cacheSource(css);
  if (!source) throw new Error('No approved owned import for recompilation.');
  const get = path => fetchImpl(path, { method: 'GET', redirect: 'error', cache: 'no-store' });
  const form = await get(CACHE_PATH);
  if (!form.ok) throw new Error('Cache reset page unavailable.');
  const token = formToken(await form.text());
  const reset = await fetchImpl(CACHE_PATH, { method: 'POST', redirect: 'error', cache: 'no-store',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: ORIGIN, Referer: ORIGIN + CACHE_PATH },
    body: new URLSearchParams({ authenticity_token: token, url: source }).toString() });
  if (!reset.ok || !(await reset.text()).includes('Success. Url is used in')) throw new Error('Cache reset not confirmed.');
  const profile = await get(PROFILE_PATH);
  if (!profile.ok) throw new Error('Profile compilation unavailable.');
  await profile.text();
}
