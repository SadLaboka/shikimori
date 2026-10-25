import { createHash } from 'node:crypto';
import { LAYOUT_SOURCE, HISTORY_SOURCE, HISTORY_COMPAT, ACTIVITY_SOURCE, USER_MARKER } from './css.mjs';

// Inspect the LIVE stylesheet. Text snapshots alone cannot prove that an old
// imported copy stopped participating in the cascade.
export async function auditRules(page, referenceCss, { source = LAYOUT_SOURCE, expectedCount = 10, compatibility = '', allowOverrides = false } = {}) {
  const result = await page.evaluate(({ referenceCss, source, marker, expectedCount, compatibility, allowOverrides }) => {
    const element = document.querySelector('style#custom_css');
    const text = element.textContent;
    const index = text.indexOf(marker);
    function inventory(rules, conditions = []) {
      const rows = [];
      for (const rule of rules) {
        if (rule.type === CSSRule.STYLE_RULE) {
          rows.push({ conditions, selector: rule.selectorText,
            cssText: rule.cssText.replace(/https?:\/\//g, '//') });
          if (rule.cssRules?.length) rows.push(...inventory(rule.cssRules,
            [...conditions, `CSSStyleRule:${rule.selectorText}`]));
        } else if (rule.cssRules && rule.type !== CSSRule.KEYFRAMES_RULE) {
          rows.push(...inventory(rule.cssRules, [...conditions,
            `${rule.constructor.name}:${rule.conditionText ?? rule.name ?? ''}`]));
        } else {
          rows.push({ conditions, selector: rule.selectorText ?? null,
            cssText: rule.cssText.replace(/https?:\/\//g, '//') });
        }
      }
      return rows;
    }
    function parse(css) {
      const temporary = document.createElement('style');
      temporary.media = 'not all';
      temporary.textContent = css;
      document.head.append(temporary);
      try { return inventory(temporary.sheet.cssRules); }
      finally { temporary.remove(); }
    }
    const reference = parse(referenceCss);
    const compat = compatibility ? parse(compatibility) : [];
    const actual = inventory(element.sheet.cssRules);
    const foundation = parse(text.slice(0, index));
    const user = parse(text.slice(index + marker.length));
    const outside = [];
    const unreadableSheets = [];
    for (const sheet of document.styleSheets) {
      if (sheet === element.sheet) continue;
      try { outside.push(...inventory(sheet.cssRules)); }
      catch { unreadableSheets.push(sheet.href ?? '(inline)'); }
    }
    const sameSelector = (a, b) => a.selector === b.selector && (a.selector !== null || a.cssText.split('{')[0].trim() === b.cssText.split('{')[0].trim()) && JSON.stringify(a.conditions) === JSON.stringify(b.conditions);
    const exact = (a, b) => sameSelector(a, b) && a.cssText === b.cssText;
    const rules = reference.map(rule => ({
      selector: rule.selector, conditions: rule.conditions, cssText: rule.cssText,
      actualCopies: actual.filter(row => exact(row, rule)).length,
      outsideCopies: outside.filter(row => exact(row, rule)).length,
      foundationCopies: foundation.filter(row => exact(row, rule)).length,
      userCopies: user.filter(row => exact(row, rule)).length,
      selectorCopies: actual.filter(row => sameSelector(row, rule)).length,
      positions: actual.flatMap((row, position) => exact(row, rule) ? [position] : []),
    }));
    const selected = actual.filter(row => reference.some(rule => exact(row, rule)));
    const originalOrder = JSON.stringify(selected) === JSON.stringify(reference);
    const isCompat = row => compat.some(rule => exact(row, rule));
    const nonLayout = actual.filter(row => !reference.some(rule => exact(row, rule)) && !isCompat(row));
    const pseudos = nonLayout.filter(row => /::?(?:before|after)\b/.test(row.selector ?? ''));
    const compatibilityCopies = actual.filter(isCompat).length;
    const compatibilityValid = !compat.length || (compatibilityCopies === 1 && user.filter(isCompat).length === 1 &&
      foundation.filter(isCompat).length === 0 && outside.filter(isCompat).length === 0);
    let posterContentExpected = true;
    if (compat.length) {
      const label = '/* https://css-club.web.app/css/custom_posters.min.css */';
      const prefix = text.slice(0,index);
      const start = prefix.indexOf(label);
      if (start < 0) posterContentExpected = false;
      else {
        const tail = prefix.slice(start + label.length);
        const next = tail.search(/\/\*\s*https?:/);
        const posterRows = parse(next < 0 ? tail : tail.slice(0,next));
        const target = posterRows.filter(row => row.selector?.split(',').map(s=>s.trim()).includes(compat[0].selector));
        posterContentExpected = target.length === 1 && /content:\s*"";/.test(target[0].cssText) && !/content:[^;]*!important/.test(target[0].cssText);
      }
    }
    const importedMarkerPresent = text.slice(0, index).includes(`/* ${source} */`);
    return {
      customCssElements: document.querySelectorAll('style#custom_css').length,
      sheetIndex: [...document.styleSheets].indexOf(element.sheet),
      importedMarkerPresent, originalOrder, rules,
      compatibilityCopies, compatibilityValid, posterContentExpected,
      unreadableSheets,
      unexpandedImportRules: actual.filter(row => /^@import\b/i.test(row.cssText)).length,
      valid: !importedMarkerPresent && originalOrder && rules.length === expectedCount && unreadableSheets.length === 0 && compatibilityValid && posterContentExpected &&
        rules.every(rule => rule.actualCopies === 1 && rule.outsideCopies === 0 && rule.foundationCopies === 0 &&
          rule.userCopies === 1 && (allowOverrides || rule.selectorCopies === 1)),
      nonLayout, pseudos,
    };
  }, { referenceCss, source, marker: USER_MARKER, expectedCount, compatibility, allowOverrides });
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const { nonLayout, pseudos, ...audit } = result;
  return { ...audit, nonLayoutCascadeHash: digest(nonLayout),
    pseudoRuleHash: digest(pseudos), pseudoRuleCount: pseudos.length };
}

export const auditLayout = (page, referenceCss) => auditRules(page, referenceCss);
export const auditHistory = (page, referenceCss) => auditRules(page, referenceCss,
  { source: HISTORY_SOURCE, expectedCount: 7, compatibility: HISTORY_COMPAT });

export const auditActivity = (page, referenceCss) => auditRules(page, referenceCss,
  { source: ACTIVITY_SOURCE, expectedCount: 40, allowOverrides: true });
