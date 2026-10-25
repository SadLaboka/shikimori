import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export const E_DESIGN_PINS = JSON.parse(readFileSync(new URL('../../vendor/edesign-pins.json', import.meta.url), 'utf8'));
export const OWNED_IMPORTS = JSON.parse(readFileSync(new URL('../../css/imports.json', import.meta.url), 'utf8'));
// A deliberately limited model, not a replacement for Shikimori's sanitizer.
export const USER_MARKER = '/* User Custom Styles */';
export const LAYOUT_SOURCE = 'https://css-club.web.app/css/profile-content-layout-v1.css';
export const HISTORY_SOURCE = 'https://raw.githubusercontent.com/ed-main/ed-main.github.io/master/cssfiles/q03_history_bookmarks.css';
export const ACTIVITY_SOURCE = 'https://raw.githubusercontent.com/ed-main/ed-main.github.io/master/cssfiles/q05_animated_activity_graph.css';
export const POSTERS_SOURCE = 'https://css-club.web.app/css/custom_posters.min.css';
export const HISTORY_COMPAT = '.b-catalog_entry-tooltip > .entry-tooltip_container > a::before { content: ""; }';

export function planFoundation(localText, publishedText, foundation) {
  const local = extractLocal(localText).imports;
  const published = extractLocal(publishedText).imports;
  assertSameImports(published, published, foundation);
  if (JSON.stringify(local) === JSON.stringify(published)) return { foundation, migration: null };
  // A source relocation is separate from pinning/removal and must be byte-verified.
  if (local.length === published.length) {
    const changes = local.flatMap((url,i)=>url===published[i]?[]:
      [{ spec: OWNED_IMPORTS.find(row=>row.source===published[i]&&row.target===url) }]);
    if(changes.length && changes.every(row=>row.spec)) {
      let next=foundation;
      const ownedImports=changes.map(({spec})=>{
        ownedImportRevision(spec);
        const markers=[...foundation.matchAll(/\/\*\s*(https?:[^*]+?)\s*\*\//g)];
        const index=markers.findIndex(m=>m[1]===spec.source);
        if(index<0 || published.filter(url=>url===spec.source).length!==1)
          throw new Error('Owned source marker is missing or duplicated.');
        const marker=markers[index];
        next=next.replace(marker[0],marker[0].replace(spec.source,spec.target));
        return {...spec,originalBlock:foundation.slice(marker.index,markers[index+1]?.index??foundation.length)};
      });
      return {foundation:next,migration:null,ownedImports};
    }
  }
  // Version pinning preserves every CSS byte in the compiled foundation.
  // Only approved URL labels may change; source verification is mandatory in preview.mjs.
  if (local.length === published.length) {
    const changes = local.flatMap((url, i) => url === published[i] ? [] :
      [{ spec: E_DESIGN_PINS.find(pin => pin.source === published[i] && pin.target === url), i }]);
    if (changes.length && changes.every(change => change.spec)) {
      let next = foundation;
      const versionPins = changes.map(({ spec }) => {
        const markers = [...foundation.matchAll(/\/\*\s*(https?:[^*]+?)\s*\*\//g)];
        const index = markers.findIndex(m => m[1] === spec.source);
        if (index < 0) throw new Error('Version pin source marker missing.');
        const marker = markers[index];
        const end = markers[index + 1]?.index ?? foundation.length;
        next = next.replace(marker[0], marker[0].replace(spec.source, spec.target));
        return { ...spec, originalBlock: foundation.slice(marker.index, end) };
      });
      return { foundation: next, migration: null, versionPins };
    }
  }
  const approved = [
    { source: POSTERS_SOURCE, begin: '/* BEGIN LOCAL CUSTOM POSTERS', end: '/* END LOCAL CUSTOM POSTERS */', snapshot: 'vendor/custom_posters.min.css' },
    { source: ACTIVITY_SOURCE, begin: '/* BEGIN LOCAL ACTIVITY GRAPH', end: '/* END LOCAL ACTIVITY GRAPH */', snapshot: 'vendor/q05_animated_activity_graph.css' },
    { source: LAYOUT_SOURCE, begin: '/* BEGIN LOCAL PROFILE LAYOUT', end: '/* END LOCAL PROFILE LAYOUT */', snapshot: 'vendor/profile-content-layout-v1.css' },
    { source: HISTORY_SOURCE, begin: '/* BEGIN LOCAL HISTORY BOOKMARKS', end: '/* END LOCAL HISTORY BOOKMARKS */', snapshot: 'vendor/q03_history_bookmarks.css' },
  ];
  const selected = approved.find(spec => published.filter(url => url === spec.source).length === 1 &&
    JSON.stringify(local) === JSON.stringify(published.filter(url => url !== spec.source)) &&
    localText.split(spec.begin).length === 2 && localText.split(spec.end).length === 2);
  if (!selected) throw new Error('Unapproved import change; only one explicitly supported complete migration is allowed.');
  const markers = [...foundation.matchAll(/\/\*\s*(https?:[^*]+?)\s*\*\//g)];
  const index = markers.findIndex(m => m[1] === selected.source);
  if (index < 0) throw new Error('Migrated import boundary missing.');
  const start = markers[index].index;
  const end = markers[index + 1]?.index ?? foundation.length;
  return {
    foundation: foundation.slice(0, start) + foundation.slice(end),
    migration: { source: selected.source, originalBlock: foundation.slice(start, end), snapshot: selected.snapshot },
  };
}

export function splitCompiled(text) {
  if (text.split(USER_MARKER).length !== 2) {
    throw new Error('Expected exactly one User Custom Styles boundary; refusing replacement.');
  }
  const index = text.indexOf(USER_MARKER);
  return { foundation: text.slice(0, index), user: text.slice(index + USER_MARKER.length) };
}

export function extractLocal(text) {
  // Mirrors the documented legacy comment-removal behavior, including AUTO comments.
  let user = text.replace(/^\uFEFF/, '').replace(/\/\*[\s\S]*?\*\/\s*[\n\r]*/g, '');
  const imports = [];
  user = user.replace(/@import\s+(?:url\(\s*(['"]?)(.*?)\1\s*\)|(['"])(.*?)\3)\s*;[\n\r]*/gi,
    (_, _quote, url, _quote2, quotedUrl) => {
      imports.push(url ?? quotedUrl);
      return '';
    });
  if (/@import\b/i.test(user)) {
    throw new Error('Unsupported @import syntax (e.g. media/layer/supports); refusing replacement.');
  }
  return { imports, user };
}

export function assertSameImports(local, published, foundation) {
  if (JSON.stringify(local) !== JSON.stringify(published)) {
    throw new Error('Local imports differ from published imports. Updating the foundation is not supported.');
  }
  const markers = [...foundation.matchAll(/\/\*\s*(https?:[^*]+?)\s*\*\//g)].map(m => m[1]);
  // Shikimori's source-label sanitizer removes @ (including the Google Fonts weight separator).
  const label = value => value.trim().replace(/@/g, '').replace(/^https?:/, '');
  if (JSON.stringify(markers.map(label)) !== JSON.stringify(published.map(label))) {
    throw new Error('Compiled import markers differ from the published source; refusing replacement.');
  }
}

export function prepareUser(text) {
  const { user } = extractLocal(text);
  // Current observed image URLs become protocol-relative on the site.
  // Camo, arbitrary sanitization, nested imports and new URL forms are NOT reproduced.
  const prepared = user.replace(/https?:\/\//g, '//').trim();
  return prepared.includes('@media') ? prepared : `@media only screen and (min-width: 1024px) {\n${prepared}\n}`;
}

export function joinCompiled(foundation, user) {
  return `${foundation}${USER_MARKER}\n${user}`;
}

export function assertVersionPinBytes(spec, snapshot, fetched) {
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  if (!/^[a-f0-9]{64}$/.test(spec.sha256) || hash(snapshot) !== spec.sha256 || hash(fetched) !== spec.sha256) {
    throw new Error('Pinned source or vendor byte hash differs; refusing unverified source.');
  }
}

// Explicit observed compiler rewrites only. Never discard or normalize arbitrary URLs.
export function assertVersionPinRules(spec, sourceRules, compiledRules) {
  const hash = text => createHash('sha256').update(text).digest('hex');
  const expected = [...sourceRules];
  const entries = spec.compiledUrlRewrites ?? [];
  const seen = new Set();
  let rewrittenUrls = 0;
  for (const entry of entries) {
    if (!Number.isInteger(entry.rule) || entry.rule < 0 || entry.rule >= expected.length ||
        seen.has(entry.rule) || hash(expected[entry.rule]) !== entry.sourceRuleSha256)
      throw new Error('Observed URL rewrite rule fingerprint changed.');
    seen.add(entry.rule);
    if (!entry.urls?.length) throw new Error('Empty URL rewrite entry.');
    const fromUrls = new Set();
    for (const pair of entry.urls) {
      if (fromUrls.has(pair.from) || !Number.isInteger(pair.occurrences) || pair.occurrences < 1)
        throw new Error('Ambiguous URL rewrite count.');
      fromUrls.add(pair.from);
      const legacy = pair.from.startsWith('/x/');
      const direct = legacy ? '//' + pair.from.slice(3) : pair.from;
      if (!direct.startsWith('//')) throw new Error('Unsupported source URL rewrite.');
      const resource = 'https:' + direct;
      const parsedResource = new URL(resource);
      if (parsedResource.href !== resource || parsedResource.username || parsedResource.password)
        throw new Error('Non-canonical source URL.');
      if (!(legacy && pair.to === direct)) {
        const proxy = new URL('https:' + pair.to);
        if (!pair.to.startsWith('//camo-v3.shikimori.io/') ||
            proxy.origin !== 'https://camo-v3.shikimori.io' || !/^\/[a-f0-9]{40}$/.test(proxy.pathname) ||
            proxy.hash || [...proxy.searchParams.keys()].length !== 1 ||
            proxy.searchParams.get('url') !== resource)
          throw new Error('Compiler URL rewrite changes the original resource.');
      }
    }
    const counts = new Map(entry.urls.map(pair => [pair.from,0]));
    expected[entry.rule] = expected[entry.rule].replace(/url\("((?:\\.|[^"\\])*)"\)/g, (token,url) => {
      const pair = entry.urls.find(pair=>pair.from===url);
      if (!pair) return token;
      counts.set(url,counts.get(url)+1);
      return 'url("' + pair.to + '")';
    });
    for (const pair of entry.urls) {
      if (counts.get(pair.from) !== pair.occurrences) throw new Error('Observed URL occurrence count changed.');
      rewrittenUrls += pair.occurrences;
    }
  }
  if (spec.parsedRules !== undefined && sourceRules.length !== spec.parsedRules)
    throw new Error('Pinned source parsed rule count changed.');
  if (JSON.stringify(expected) !== JSON.stringify(compiledRules))
    throw new Error('Pinned snapshot differs from live compiled source outside approved URL rewrites.');
  return { rewrittenRules: entries.length, rewrittenUrls };
}

export function ownedImportRevision(spec) {
  const match = /^https:\/\/raw\.githubusercontent\.com\/SadLaboka\/shikimori\/([a-f0-9]{40})\/(css\/base\/[a-z0-9_-]+\.css)$/.exec(spec.target);
  const upstream = E_DESIGN_PINS.find(pin=>pin.target===spec.source);
  if(!match || match[2]!==spec.local || !upstream ||
      spec.snapshot!==upstream.snapshot || spec.sha256!==upstream.sha256)
    throw new Error('Owned import must name an approved byte-identical snapshot and exact repository commit/path.');
  return match[1];
}
