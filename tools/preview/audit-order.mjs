// Counterfactual order audit only. No stylesheet build or publication.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { splitCompiled } from './css.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: { 'historical-compiled': { type: 'string' } } });
if (!values['historical-compiled']) throw new Error('Pass --historical-compiled with a real pre-migration snapshot.');
const historical = await readFile(path.resolve(root, values['historical-compiled']), 'utf8');
const reference = await readFile(path.join(root, 'vendor/profile-content-layout-v1.css'), 'utf8');
const mainBefore = await readFile(path.join(root, 'styles_optimized.css'));
const digest = x => createHash('sha256').update(typeof x === 'string' || Buffer.isBuffer(x) ? x : JSON.stringify(x)).digest('hex');
const output = path.join(root, '.preview', `order-audit-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(output, { recursive: true });
const report = { widths: [1440, 390, 360, 767, 768, 1024, 1025], cases: [], mainHash: digest(mainBefore) };
const freeze = '*,*::before,*::after{animation-play-state:paused!important;transition:none!important;caret-color:transparent!important}';
const props = ['display', 'position', 'float', 'width', 'height', 'box-sizing', 'padding-right',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'overflow-x', 'overflow-y',
  'background-image', 'background-position', 'background-size', 'border-radius', 'opacity',
  'aspect-ratio', 'filter', 'transform', 'z-index', 'content', 'color', 'align-self', 'flex-shrink'];

// This intentionally accepts only the simple selectors observed in these two files.
// Reject new selector syntax instead of pretending to implement a full selector parser.
function specificity(selector) {
  if (/[\[\]()\\]/.test(selector)) throw new Error(`Unsupported specificity syntax: ${selector}`);
  const elements = selector.match(/::[\w-]+/g) ?? [];
  let rest = selector.replace(/::[\w-]+/g, ' ');
  const ids = rest.match(/#[\w-]+/g) ?? [];
  const classes = rest.match(/\.[\w-]+|:[\w-]+/g) ?? [];
  rest = rest.replace(/#[\w-]+|\.[\w-]+|:[\w-]+/g, ' ');
  const types = rest.split(/[\s>+~*]+/).filter(Boolean);
  if (types.some(type => !/^[a-zA-Z][\w-]*$/.test(type))) throw new Error(`Unsupported selector: ${selector}`);
  return [ids.length, classes.length, types.length + elements.length];
}
const compareSpecificity = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (const animation of document.getAnimations()) {
      try { animation.pause(); animation.currentTime = 0; } catch {}
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function sample(page, css, scope) {
  await page.locator('#custom_css').evaluate((el, text) => { el.textContent = text; }, css);
  await settle(page);
  return page.evaluate(({ props, scope }) => {
    const selector = scope === 'profile'
      ? '.profile-content > .cc-2, .profile-content > .cc-2 *, .b-catalog_entry-tooltip, .b-catalog_entry-tooltip *, .l-top_menu-v2, .l-top_menu-v2 *'
      : 'body, body *';
    return [...document.querySelectorAll(selector)].filter(el => el.tagName !== 'STYLE').map((el, index) => {
      const style = pseudo => { const cs = getComputedStyle(el, pseudo); return Object.fromEntries(props.map(p => [p, cs.getPropertyValue(p)])); };
      const r = el.getBoundingClientRect();
      return { index, tag: el.tagName, class: el.className,
        rect: el.getClientRects().length ? [r.x + scrollX, r.y + scrollY, r.width, r.height] : [0, 0, 0, 0],
        normal: style(null), before: style('::before'), after: style('::after') };
    });
  }, { props, scope });
}

async function stableSample(page, css, scope) {
  let previous = await sample(page, css, scope);
  for (let attempt = 0; attempt < 7; attempt++) {
    await page.waitForTimeout(150);
    const next = await sample(page, css, scope);
    if (digest(previous) === digest(next)) return next;
    previous = next;
  }
  throw new Error(`Unstable ${scope} DOM: cannot attribute differences to CSS order.`);
}

async function compare(page, oldCss, currentCss, scope, width, state, screenshot = false) {
  const before = await stableSample(page, oldCss, scope);
  if (screenshot) await page.locator(scope === 'profile' ? '.profile-content > .cc-2' : 'body')
    .screenshot({ path: path.join(output, `${scope}-${width}-${state}-old.png`), animations: 'allow' });
  const after = await stableSample(page, currentCss, scope);
  if (screenshot) await page.locator(scope === 'profile' ? '.profile-content > .cc-2' : 'body')
    .screenshot({ path: path.join(output, `${scope}-${width}-${state}-current.png`), animations: 'allow' });
  const indices = Array.from({ length: Math.max(before.length, after.length) }, (_, i) => i);
  const changes = indices.filter(i => JSON.stringify(before[i]) !== JSON.stringify(after[i]));
  const details = changes.map(i => ({ index: i, before: before[i], after: after[i] }));
  const result = { scope, width, state, nodes: before.length, changedNodes: changes.length,
    beforeHash: digest(before), afterHash: digest(after),
    realTooltipVisible: scope === 'profile' && after.some(row => row.class === 'b-catalog_entry-tooltip' && row.rect[2] > 0), details };
  report.cases.push(result);
  console.log(`${scope} ${width}px ${state}: ${changes.length} differences / ${before.length} nodes`);
}

const browser = await chromium.launch();
try {
  report.browser = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await context.route('**/*', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort());
  await context.routeWebSocket('**/*', socket => socket.close());
  const page = await context.newPage();
  await page.goto('https://shikimori.io/SadLaboka', { waitUntil: 'domcontentloaded' });
  await page.locator('#custom_css').waitFor({ state: 'attached' });
  const current = await page.locator('#custom_css').textContent();
  report.currentCompiledHash = digest(current);
  report.historicalCompiledHash = digest(historical);
  const marker = '/* https://css-club.web.app/css/custom_posters.min.css */';
  const foundation = splitCompiled(current).foundation;
  if (foundation.split(marker).length !== 2) throw new Error('Poster source boundary missing or duplicated.');
  const posters = foundation.slice(foundation.indexOf(marker) + marker.length);
  await writeFile(path.join(output, 'posters-observed.css'), posters);
  report.postersHash = digest(posters);
  const analysis = await page.evaluate(({ reference, current, historical, posters }) => {
    function parse(text) {
      const el = document.createElement('style'); el.media = 'not all'; el.textContent = text; document.head.append(el);
      function walk(rules, conditions = []) {
        const rows = [];
        for (const rule of rules) {
          if (rule.type === CSSRule.STYLE_RULE) {
            const properties = Object.fromEntries([...rule.style].map(p => [p, { value: rule.style.getPropertyValue(p), important: rule.style.getPropertyPriority(p) === 'important' }]));
            for (const shorthand of ['margin', 'padding', 'overflow']) {
              if (!properties[shorthand]) continue;
              const names = shorthand === 'overflow' ? ['overflow-x', 'overflow-y'] : ['top', 'right', 'bottom', 'left'].map(side => `${shorthand}-${side}`);
              for (const p of names) properties[p] = { value: rule.style.getPropertyValue(p), important: rule.style.getPropertyPriority(p) === 'important' };
              delete properties[shorthand];
            }
            rows.push({ selector: rule.selectorText, conditions, properties, cssText: rule.cssText.replace(/https?:\/\//g, '//') });
          } else if (rule.cssRules && rule.type !== CSSRule.KEYFRAMES_RULE) {
            rows.push(...walk(rule.cssRules, [...conditions, `${rule.constructor.name}:${rule.conditionText ?? rule.name ?? ''}`]));
          } else rows.push({ selector: null, conditions, properties: {}, cssText: rule.cssText.replace(/https?:\/\//g, '//') });
        }
        return rows;
      }
      try { return walk(el.sheet.cssRules); } finally { el.remove(); }
    }
    const ref = parse(reference), oldRows = parse(historical), currentRows = parse(current);
    const key = row => JSON.stringify([row.conditions, row.selector, row.cssText]);
    const referenceKeys = new Set(ref.map(key));
    const isLayout = row => referenceKeys.has(key(row));
    const oldPositions = oldRows.flatMap((row, i) => isLayout(row) ? [i] : []);
    const currentPositions = currentRows.flatMap((row, i) => isLayout(row) ? [i] : []);
    const unchangedRest = JSON.stringify(oldRows.filter(r => !isLayout(r)).map(key)) === JSON.stringify(currentRows.filter(r => !isLayout(r)).map(key));
    const crossed = currentRows.slice(oldPositions[0], currentPositions[0]);
    const posterRows = parse(posters), posterKeys = new Set(posterRows.map(key));
    for (const row of crossed) row.source = posterKeys.has(key(row)) ? 'posters' : row.selector?.startsWith('.l-top_menu-v2') ? 'AUTO sticky' : 'unexpected';
    return { ref, posterRows, crossed, oldPositions, currentPositions, unchangedRest,
      exactlyTenCopies: oldPositions.length === 10 && currentPositions.length === 10,
      domCounts: [...ref, ...posterRows].filter(r => r.selector).map(row => ({ selector: row.selector,
        count: document.querySelectorAll(row.selector.replace(/::(?:before|after)\b/g, '')).length })) };
  }, { reference, current, historical, posters });
  if (!analysis.unchangedRest || !analysis.exactlyTenCopies || analysis.crossed.some(row => row.source === 'unexpected')) {
    throw new Error('Snapshots differ beyond the known relocation; order audit cannot isolate this change.');
  }
  report.structure = analysis;
  report.pairs = [];
  for (const layout of analysis.ref) for (const crossed of analysis.crossed) {
    for (const layoutSelector of layout.selector.split(',').map(s => s.trim())) {
      for (const otherSelector of crossed.selector.split(',').map(s => s.trim())) {
        const common = Object.keys(layout.properties).filter(p => p in crossed.properties);
        if (!common.length) continue;
        const specificityLayout = specificity(layoutSelector), specificityOther = specificity(otherSelector);
        for (const property of common) {
          const a = layout.properties[property], b = crossed.properties[property];
          const differentPseudo = /::/.test(layoutSelector) !== /::/.test(otherSelector);
          const winner = a.important !== b.important ? (a.important ? 'layout' : 'other')
            : compareSpecificity(specificityLayout, specificityOther) > 0 ? 'layout'
              : compareSpecificity(specificityLayout, specificityOther) < 0 ? 'other' : 'source-order';
          report.pairs.push({ layoutSelector, otherSelector, source: crossed.source, property, layout: a, other: b,
            specificityLayout, specificityOther, differentPseudo, winner,
            orderSensitive: !differentPseudo && a.value !== b.value && winner === 'source-order' });
        }
      }
    }
  }
  report.actualSharedTargets = await page.evaluate(pairs => pairs.map(pair => ({
    ...pair, sharedTargets: pair.differentPseudo ? 0 : [...document.querySelectorAll(pair.layoutSelector)]
      .filter(el => el.matches(pair.otherSelector)).length,
  })), report.pairs);
  await page.addStyleTag({ content: freeze });
  for (const width of report.widths) {
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.activeElement?.blur?.());
    await page.waitForTimeout(1200); // Let the previous tooltip close before resizing.
    await page.setViewportSize({ width, height: width >= 1024 ? 900 : 844 });
    await page.waitForTimeout(250); // The site's resize handler also updates tooltip positioning.
    await page.locator('.cc-favourites').evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.mouse.move(0, 0);
    await compare(page, historical, current, 'profile', width, 'idle', [1440, 390, 360].includes(width));
    const cover = page.locator('.cc-favourites .cover').first();
    await cover.hover();
    await page.waitForTimeout(1000); // Allow the site's hover-tooltip timer to settle before both measurements.
    await compare(page, historical, current, 'profile', width, 'hover');
    await cover.focus();
    await compare(page, historical, current, 'profile', width, 'focus');
    await cover.hover();
    await page.mouse.down();
    try { await compare(page, historical, current, 'profile', width, 'active'); }
    finally { await page.mouse.move(0, 0); await page.mouse.up(); }
    if (new URL(page.url()).pathname !== '/SadLaboka') throw new Error('Unexpected navigation after state test.');
  }
  await page.locator('#custom_css').evaluate((el, css) => { el.textContent = css; }, current);

  // These are explicit fixtures: collection censor/spoiler states and tooltip
  // markup are not guaranteed to be present on the profile itself.
  const fixture = await context.newPage();
  await fixture.setContent(`<!doctype html><style id="custom_css"></style><style>${freeze}</style>
    <body id="profiles_show" style="--top-menu-height:48px; font:14px sans-serif">
    <div class="profile-content b-catalog_entry-tooltip" style="width:280px">
      <div class="cc-2 entry-tooltip_container"><a id="collision" class="c-column c-right" href="#">Tooltip/column collision <img width="80" height="40" alt="fixture"></a></div></div>
    <div class="b-collection-topic"><div class="inner">${['normal', 'is-censored', 'is-spoilers', 'is-censored is-spoilers'].map((classes, i) => `<div class="collection-row ${classes}"><a class="cover" id="cover-${i}" href="#" style="display:inline-block"><span class="image-cutter" style="display:block;position:relative;width:100px;height:60px;--custom-image:linear-gradient(#123,#789)"><img width="100" height="60" alt="${classes}"></span></a></div>`).join('')}</div></div>
    <div class="profile-content l-top_menu-v2" style="width:280px"><div class="cc-2"><div id="menu-state" class="c-right active"><div class="block submenu" style="height:40px">active submenu</div></div></div></div></body>`);
  const sticky = analysis.crossed.filter(r => r.source === 'AUTO sticky').map(r =>
    `@media screen and (min-width: 1025px){${r.cssText}}`).join('\n');
  const fixtureOld = `${reference}\n${posters}\n${sticky}`;
  const fixtureCurrent = `${posters}\n${sticky}\n${reference}`;
  for (const width of report.widths) {
    await fixture.setViewportSize({ width, height: 844 });
    for (const state of ['idle', 'hover-censored', 'hover-spoilers', 'hover-both', 'focus', 'active', 'menu-inactive']) {
      await fixture.locator('#custom_css').evaluate((el, css) => { el.textContent = css; }, fixtureCurrent);
      await fixture.locator('#menu-state').evaluate((el, active) => el.classList.toggle('active', active), state !== 'menu-inactive');
      await fixture.mouse.move(0, 0);
      if (state.startsWith('hover-')) await fixture.locator(`#cover-${state === 'hover-censored' ? 1 : state === 'hover-spoilers' ? 2 : 3}`).hover();
      if (state === 'focus') await fixture.locator('#collision').focus();
      if (state === 'active') { await fixture.locator('#collision').hover(); await fixture.mouse.down(); }
      try { await compare(fixture, fixtureOld, fixtureCurrent, 'fixture', width, state, width === 1440 && state === 'hover-both'); }
      finally { await fixture.mouse.move(0, 0); await fixture.mouse.up(); }
    }
  }
  await context.close();
  report.mainUnchanged = digest(await readFile(path.join(root, 'styles_optimized.css'))) === report.mainHash;
  report.orderSensitivePairs = report.pairs.filter(pair => pair.orderSensitive).length;
  report.verdict = report.orderSensitivePairs === 0 && report.cases.every(c => c.changedNodes === 0) && report.mainUnchanged ? 'PASS' : 'FAIL';
  if (report.verdict !== 'PASS') process.exitCode = 1;
} catch (error) {
  report.error = error.message.split('\n')[0]; report.verdict = 'ERROR'; process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  const escape = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  await writeFile(path.join(output, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Аудит порядка CSS</title><style>body{font:16px system-ui;margin:24px}table{border-collapse:collapse}td,th{padding:6px;border:1px solid #aaa}img{max-width:48%;vertical-align:top}pre{white-space:pre-wrap}</style>
    <h1>Аудит порядка: ${report.verdict}</h1><p>Опубликованный профиль и основной CSS не изменены. Сравниваются старый и текущий порядок на одном DOM.</p>
    <p><a href="report.json">Селекторы, специфичность, приоритеты и вычисленные свойства</a></p>${report.error ? `<pre>${escape(report.error)}</pre>` : ''}
    <table><tr><th>Область</th><th>Ширина</th><th>Состояние</th><th>Изменений узлов</th></tr>${report.cases.map(c => `<tr><td>${c.scope}</td><td>${c.width}</td><td>${c.state}</td><td>${c.changedNodes}</td></tr>`).join('')}</table>
    ${[1440,390,360].map(w => `<h2>${w}px — старый / текущий порядок, CSS-анимации остановлены</h2><img src="profile-${w}-idle-old.png"><img src="profile-${w}-idle-current.png">`).join('')}`);
  console.log(`Order audit: ${report.verdict}. Report: ${path.join(output, 'index.html')}`);
  if (report.error) console.error(report.error);
}
