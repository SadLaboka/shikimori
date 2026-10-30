import { AVATAR_HOVER_CSS } from './avatar-hover.mjs';
import { LEGACY_AVATAR_HOVER_CSS } from './avatar-hover-legacy.mjs';
export const ACCOUNT = Object.freeze({ nickname: 'SadLaboka', userId: 1408017, styleId: 1343722 });
export const ORIGIN = 'https://shikimori.io';
export const REVISION = 'e4f9fe9118d6d81397e069254da91ee4f728d3da';
export const BASE_IMPORTS = Object.freeze([
  "@import url('https://fonts.googleapis.com/css2?family=Rubik+Spray+Paint&display=swap');",
  "@import url('https://fonts.googleapis.com/css2?family=DynaPuff:wght@400..700&display=swap');",
  '@import url("https://raw.githubusercontent.com/SadLaboka/shikimori/9c8e3373f0d65490823e609f56472fc168a9b8a7/css/base/main_code_1.css");',
  '@import url("https://raw.githubusercontent.com/SadLaboka/shikimori/a96dc9d93e8ae8edb76912f8f3ca970a96241c8b/css/base/main_code_2.css");',
  '@import url("https://raw.githubusercontent.com/SadLaboka/shikimori/8fc0b68fa3578b6e8a3884dbb23651d86d885f73/css/base/main_code_3.css");',
  '@import url("https://raw.githubusercontent.com/SadLaboka/shikimori/8912ca67ab5e4915c6ba9ea065f9ee609481ccd3/css/base/main_code_4mob.css");',
]);
export const SCHEMES = Object.freeze([
  Object.freeze({ id: 'main', name: 'Основная', description: 'Индиго и бордовый', file: 'styles_optimized.css',
    sourceSha256: '7d831865199d403d5bafce8f290ac97c91cee589b25f44b2049f33a8f674e4ac',
    previousSourceSha256: '612eadae22be9c1d6f1b47418983f3da00d04d82dabb6d1ee584340d11bf895f',
    currentSourceSha256: '984b618abe9ca4929035c1fbc71e5c8df81a5fea7c89ed7a533698f135d08143' }),
  Object.freeze({ id: 'emerald-scarlet', name: 'Emerald & Scarlet', description: 'Зоро и Шанкс', file: 'css/themes/emerald-scarlet/styles.css',
    sourceSha256: '536db8d921938cf5041858bae76550f1845fd606e29a17e77047bf2146af41e3',
    previousSourceSha256: '63a3556f67d7ab4116f25f6f400264f9ab33617985d8dfceed14958821cc1e64',
    currentSourceSha256: '1e4144345c5a5efa26317c08ff5ae6ec1b767410bd6b86d6aac0a404b5d439bf' }),
]);
// Explicit order: do not silently rearrange it when the popup catalog changes.
export const CYCLE_ORDER = Object.freeze(['main', 'emerald-scarlet']);
export function nextSchemeId(current) {
  const index = CYCLE_ORDER.indexOf(current);
  return index < 0 ? null : CYCLE_ORDER[(index + 1) % CYCLE_ORDER.length];
}
export function schemeImports(id) {
  const scheme = SCHEMES.find(item => item.id === id);
  if (!scheme) throw new Error('Неизвестная схема.');
  const url = `https://raw.githubusercontent.com/SadLaboka/shikimori/${REVISION}/${scheme.file}`;
  return [...BASE_IMPORTS, `@import url("${url}");`].join('\n');
}
export function schemeCss(id) { return `${schemeImports(id)}\n\n${AVATAR_HOVER_CSS}`; }
export async function sha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function recognize(css) {
  const hash = await sha256(css);
  for (const scheme of SCHEMES) {
    if (hash === scheme.sourceSha256 || hash === scheme.previousSourceSha256 || hash === scheme.currentSourceSha256 ||
        hash === await sha256(`${schemeImports(scheme.id)}\n\n${LEGACY_AVATAR_HOVER_CSS}`) || hash === await sha256(schemeImports(scheme.id)) ||
        hash === await sha256(schemeCss(scheme.id))) return scheme.id;
  }
  return null;
}
