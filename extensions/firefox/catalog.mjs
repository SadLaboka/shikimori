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
    sourceSha256: '7d831865199d403d5bafce8f290ac97c91cee589b25f44b2049f33a8f674e4ac' }),
  Object.freeze({ id: 'emerald-scarlet', name: 'Emerald & Scarlet', description: 'Зоро и Шанкс', file: 'css/themes/emerald-scarlet/styles.css',
    sourceSha256: '536db8d921938cf5041858bae76550f1845fd606e29a17e77047bf2146af41e3' }),
]);
export function schemeCss(id) {
  const scheme = SCHEMES.find(item => item.id === id);
  if (!scheme) throw new Error('Неизвестная схема.');
  const url = `https://raw.githubusercontent.com/SadLaboka/shikimori/${REVISION}/${scheme.file}`;
  return [...BASE_IMPORTS, `@import url("${url}");`].join('\n');
}
export async function sha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function recognize(css) {
  const hash = await sha256(css);
  for (const scheme of SCHEMES) {
    if (hash === scheme.sourceSha256 || hash === await sha256(schemeCss(scheme.id))) return scheme.id;
  }
  return null;
}
