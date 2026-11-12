import { AVATAR_HOVER_CSS } from './avatar-hover.mjs';
import { LEGACY_AVATAR_HOVER_CSS } from './avatar-hover-legacy.mjs';
import { INLINE_SCHEMES } from './inline-schemes.mjs';
export const ACCOUNT = Object.freeze({ nickname: 'SadLaboka', userId: 1408017, styleId: 1343722 });
export const ORIGIN = 'https://shikimori.io';
export const REVISION = '178429b453a7a5fb3ebf6d63bc666d2e8cf83b1c';
// Only these two approved, byte-identical sources use a mirror. Keep the full
// commit IDs: neither the CDN nor recognition may silently follow a branch.
export const IMPORT_MIRRORS = Object.freeze([
  Object.freeze({
    source: 'https://raw.githubusercontent.com/SadLaboka/shikimori/2d919a08e191c50b9293c73f7cc6504f59e4b51a/css/base/main_code_3.css',
    url: 'https://cdn.jsdelivr.net/gh/SadLaboka/shikimori@2d919a08e191c50b9293c73f7cc6504f59e4b51a/css/base/main_code_3.css',
    sha256: '9241c9bf7a7e0e526a4d7f642df54e52a0ee8a9f8d15337245eeec92585e1217',
  }),
  Object.freeze({
    source: 'https://raw.githubusercontent.com/SadLaboka/shikimori/178429b453a7a5fb3ebf6d63bc666d2e8cf83b1c/css/themes/emerald-scarlet/styles.css',
    url: 'https://cdn.jsdelivr.net/gh/SadLaboka/shikimori@178429b453a7a5fb3ebf6d63bc666d2e8cf83b1c/css/themes/emerald-scarlet/styles.css',
    sha256: 'fe50ed06eb1023099f8ce9d3546947c9ecf03622237956812cfbf4c6fb407548',
  }),
]);
export const BASE_IMPORTS = Object.freeze([
  "@import url('https://fonts.googleapis.com/css2?family=Rubik+Spray+Paint&display=swap');",
  "@import url('https://fonts.googleapis.com/css2?family=DynaPuff:wght@400..700&display=swap');",
  "@import url(\"https://raw.githubusercontent.com/SadLaboka/shikimori/2d919a08e191c50b9293c73f7cc6504f59e4b51a/css/base/main_code_1.css\");",
  "@import url(\"https://raw.githubusercontent.com/SadLaboka/shikimori/a96dc9d93e8ae8edb76912f8f3ca970a96241c8b/css/base/main_code_2.css\");",
  "@import url(\"https://raw.githubusercontent.com/SadLaboka/shikimori/2d919a08e191c50b9293c73f7cc6504f59e4b51a/css/base/main_code_3.css\");",
  "@import url(\"https://raw.githubusercontent.com/SadLaboka/shikimori/2d919a08e191c50b9293c73f7cc6504f59e4b51a/css/base/main_code_4mob.css\");"
]);
export const LEGACY_BASE_IMPORTS = Object.freeze([
  "@import url('https://fonts.googleapis.com/css2?family=Rubik+Spray+Paint&display=swap');",
  "@import url('https://fonts.googleapis.com/css2?family=DynaPuff:wght@400..700&display=swap');",
  '@import url("https://raw.githubusercontent.com/SadLaboka/shikimori/9c8e3373f0d65490823e609f56472fc168a9b8a7/css/base/main_code_1.css");',
  '@import url("https://raw.githubusercontent.com/SadLaboka/shikimori/a96dc9d93e8ae8edb76912f8f3ca970a96241c8b/css/base/main_code_2.css");',
  '@import url("https://raw.githubusercontent.com/SadLaboka/shikimori/8fc0b68fa3578b6e8a3884dbb23651d86d885f73/css/base/main_code_3.css");',
  '@import url("https://raw.githubusercontent.com/SadLaboka/shikimori/8912ca67ab5e4915c6ba9ea065f9ee609481ccd3/css/base/main_code_4mob.css");',
]);
export const SCHEMES = Object.freeze([
  Object.freeze({
    "id": "main",
    "name": "Основная",
    "description": "Индиго и бордовый",
    "file": "styles_optimized.css",
    "sourceSha256": "900530e4dc7d73c9599be8bcb069ed167a73369f320c43b3610f4204aa151f62",
    "previousSourceSha256": "612eadae22be9c1d6f1b47418983f3da00d04d82dabb6d1ee584340d11bf895f",
    "currentSourceSha256": "900530e4dc7d73c9599be8bcb069ed167a73369f320c43b3610f4204aa151f62",
    "historicalSources": [
      {
        "revision": "2f87c1be8a3c3800d1eeca859ec4e79594fdec35",
        "sourceSha256": "773c0f9d0a7aaca7469ead910b755a1b3c7389782f3c37bdb0cd935813c61af2"
      },
      {
        "revision": "e4f9fe9118d6d81397e069254da91ee4f728d3da",
        "sourceSha256": "7d831865199d403d5bafce8f290ac97c91cee589b25f44b2049f33a8f674e4ac"
      },
      {
        "revision": "fdf3a2da9ad402894c82e57375fb69001c101cd5",
        "sourceSha256": "984b618abe9ca4929035c1fbc71e5c8df81a5fea7c89ed7a533698f135d08143"
      }
    ]
  }),
  Object.freeze({
    "id": "emerald-scarlet",
    "name": "Emerald & Scarlet",
    "description": "Зоро и Шанкс",
    "file": "css/themes/emerald-scarlet/styles.css",
    "sourceSha256": "fe50ed06eb1023099f8ce9d3546947c9ecf03622237956812cfbf4c6fb407548",
    "previousSourceSha256": "63a3556f67d7ab4116f25f6f400264f9ab33617985d8dfceed14958821cc1e64",
    "currentSourceSha256": "fe50ed06eb1023099f8ce9d3546947c9ecf03622237956812cfbf4c6fb407548",
    "historicalSources": [
      {
        "revision": "2f87c1be8a3c3800d1eeca859ec4e79594fdec35",
        "sourceSha256": "9a11fe7fcb12da54fe27284b704b100e7215e71243fe17d1b11acaa414d188cf"
      },
      {
        "revision": "e4f9fe9118d6d81397e069254da91ee4f728d3da",
        "sourceSha256": "536db8d921938cf5041858bae76550f1845fd606e29a17e77047bf2146af41e3"
      },
      {
        "revision": "fdf3a2da9ad402894c82e57375fb69001c101cd5",
        "sourceSha256": "1e4144345c5a5efa26317c08ff5ae6ec1b767410bd6b86d6aac0a404b5d439bf"
      }
    ]
  }),
  Object.freeze({
    "id": "gold-jade",
    "name": "Gold & Jade",
    "description": "Улькиорра и Йоруичи",
    "file": "css/themes/gold-jade/styles.css",
    "revision": "0609262a74d2551d265167e5c5590b1f1b8319bc",
    "previousRevision": "ed4ab4191c58f9ebdfe4f1a8293195d27d9498d5",
    "previousSourceTag": "firefox-v0.3.2",
    "historicalSources": [
      {
        "revision": "3b23783249af954943741a37b317a121c1623ad6",
        "sourceSha256": "fe7e8afd281490f99a9e16a1d6bd1626972417035318582e7015c5f9a5d9230b"
      },
      {
        "revision": "178429b453a7a5fb3ebf6d63bc666d2e8cf83b1c",
        "sourceSha256": "a7f25b1c8bc45e8e1881ba41351dd40b19b6c1803997f44d52f42508f9c94a6a"
      },
      {
        "revision": "2f87c1be8a3c3800d1eeca859ec4e79594fdec35",
        "sourceSha256": "a09eeab9331e990e22caee1d42534a1969d611727237c177f2335f18cc7d6e6b"
      },
      {
        "revision": "c3eebb1774dc31d9c1bcd7666a64ddf7979d004d",
        "sourceSha256": "2569aaeba25ea5495a179b3a0b3ae834746cc7bbeecbca717e71af9d3426285f"
      },
      {
        "revision": "c2254b7f25250de7bf5f7924691595e909f50779",
        "sourceSha256": "5a108c3f1e27190d62432f889846bfda99cc19ddaeba39053dc165c521c398e5"
      },
      {
        "revision": "fdf3a2da9ad402894c82e57375fb69001c101cd5",
        "sourceSha256": "5a108c3f1e27190d62432f889846bfda99cc19ddaeba39053dc165c521c398e5"
      }
    ],
    "sourceSha256": "dab09335328eb2626f8651e71f49371a8288b3fedbd4f0697f730b9322931d10",
    "previousSourceSha256": "db4b0a10ee5523ba8c4fad7ce85932386c7b579c56844a38c45ec5e1d04454bc",
    "currentSourceSha256": "dab09335328eb2626f8651e71f49371a8288b3fedbd4f0697f730b9322931d10"
  })
]);
// Explicit order: do not silently rearrange it when the popup catalog changes.
export const CYCLE_ORDER = Object.freeze(['main', 'emerald-scarlet', 'gold-jade']);
export function nextSchemeId(current) {
  const index = CYCLE_ORDER.indexOf(current);
  return index < 0 ? null : CYCLE_ORDER[(index + 1) % CYCLE_ORDER.length];
}
export function schemeImports(id, revisionOverride, baseImports = BASE_IMPORTS, useMirrors = true) {
  const scheme = SCHEMES.find(item => item.id === id);
  if (!scheme) throw new Error('Неизвестная схема.');
  const url = `https://raw.githubusercontent.com/SadLaboka/shikimori/${revisionOverride ?? scheme.revision ?? REVISION}/${scheme.file}`;
  const css = [...baseImports, `@import url("${url}");`].join('\n');
  return useMirrors ? IMPORT_MIRRORS.reduce((text, mirror) => text.replaceAll(mirror.source, mirror.url), css) : css;
}
export function schemeCss(id) {
  if (!Object.hasOwn(INLINE_SCHEMES, id)) throw new Error('Неизвестная схема.');
  return INLINE_SCHEMES[id];
}
export async function sha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}
export async function recognize(css) {
  // The site's textarea saves CRLF and may add a final newline. Normalize only
  // recognition; transaction hashes and backups must retain the exact bytes.
  const normalized = css.replaceAll('\r\n', '\n');
  const hash = await sha256(normalized);
  const matchesBlock = candidate => normalized.trim() === candidate.trim();
  for (const scheme of SCHEMES) {
    const historicalSources = [{ revision: scheme.revision ?? REVISION }, ...(scheme.historicalSources ?? []),
      ...(scheme.previousRevision ? [{ revision: scheme.previousRevision, sourceSha256: scheme.previousSourceSha256 }] : [])];
    for (const source of historicalSources) {
      if (hash === source.sourceSha256) return scheme.id;
      for (const imports of [BASE_IMPORTS, LEGACY_BASE_IMPORTS]) {
        for (const useMirrors of [false, true]) {
          const previous = schemeImports(scheme.id, source.revision, imports, useMirrors);
          if (matchesBlock(previous) || matchesBlock(`${previous}\n\n${AVATAR_HOVER_CSS}`) ||
              matchesBlock(`${previous}\n\n${LEGACY_AVATAR_HOVER_CSS}`)) return scheme.id;
        }
      }
    }
    if (hash === scheme.sourceSha256 || hash === scheme.previousSourceSha256 || hash === scheme.currentSourceSha256 ||
        matchesBlock(`${schemeImports(scheme.id)}\n\n${LEGACY_AVATAR_HOVER_CSS}`) || matchesBlock(schemeImports(scheme.id)) ||
        matchesBlock(schemeCss(scheme.id))) return scheme.id;
  }
  return null;
}
