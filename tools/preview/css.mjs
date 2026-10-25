import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export const E_DESIGN_PINS = JSON.parse(readFileSync(new URL('../../vendor/edesign-pins.json', import.meta.url), 'utf8'));
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
