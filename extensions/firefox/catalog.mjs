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
  Object.freeze({ id: 'gold-jade', name: 'Gold & Jade', description: 'Улькиорра и Йоруичи', file: 'css/themes/gold-jade/styles.css',
    revision: 'c2254b7f25250de7bf5f7924691595e909f50779',
    previousRevision: 'ed4ab4191c58f9ebdfe4f1a8293195d27d9498d5', previousSourceTag: 'firefox-v0.3.2',
    historicalSources: Object.freeze([Object.freeze({ revision: 'c3eebb1774dc31d9c1bcd7666a64ddf7979d004d',
      sourceSha256: '2569aaeba25ea5495a179b3a0b3ae834746cc7bbeecbca717e71af9d3426285f' })]),
    sourceSha256: '5a108c3f1e27190d62432f889846bfda99cc19ddaeba39053dc165c521c398e5',
    previousSourceSha256: 'db4b0a10ee5523ba8c4fad7ce85932386c7b579c56844a38c45ec5e1d04454bc',
    currentSourceSha256: '5a108c3f1e27190d62432f889846bfda99cc19ddaeba39053dc165c521c398e5' }),
]);
// Explicit order: do not silently rearrange it when the popup catalog changes.
export const CYCLE_ORDER = Object.freeze(['main', 'emerald-scarlet', 'gold-jade']);
export function nextSchemeId(current) {
  const index = CYCLE_ORDER.indexOf(current);
  return index < 0 ? null : CYCLE_ORDER[(index + 1) % CYCLE_ORDER.length];
}
export function schemeImports(id, revisionOverride) {
  const scheme = SCHEMES.find(item => item.id === id);
  if (!scheme) throw new Error('Неизвестная схема.');
  const url = `https://raw.githubusercontent.com/SadLaboka/shikimori/${revisionOverride ?? scheme.revision ?? REVISION}/${scheme.file}`;
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
    const historicalSources = [...(scheme.historicalSources ?? []),
      ...(scheme.previousRevision ? [{ revision: scheme.previousRevision, sourceSha256: scheme.previousSourceSha256 }] : [])];
    for (const source of historicalSources) {
      const previous = schemeImports(scheme.id, source.revision);
      if (hash === source.sourceSha256 || hash === await sha256(previous) ||
          hash === await sha256(`${previous}\n\n${AVATAR_HOVER_CSS}`)) return scheme.id;
    }
    if (hash === scheme.sourceSha256 || hash === scheme.previousSourceSha256 || hash === scheme.currentSourceSha256 ||
        hash === await sha256(`${schemeImports(scheme.id)}\n\n${LEGACY_AVATAR_HOVER_CSS}`) || hash === await sha256(schemeImports(scheme.id)) ||
        hash === await sha256(schemeCss(scheme.id))) return scheme.id;
  }
  return null;
}
