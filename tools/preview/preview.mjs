import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitCompiled, extractLocal, planFoundation, prepareUser, joinCompiled, HISTORY_SOURCE, ACTIVITY_SOURCE, POSTERS_SOURCE, E_DESIGN_PINS, assertVersionPinBytes, assertVersionPinRules, OWNED_IMPORTS, ownedImportRevision } from './css.mjs';
import { auditLayout, auditHistory, auditActivity, auditPosters } from './audit.mjs';
import { checkHistoryStates } from './history-states.mjs';
import { checkActivityStates } from './activity-states.mjs';
import { checkPosterStates } from './poster-states.mjs';
import { CATALOG_URL, installCatalogTheme, ensureCatalogFilters, checkFilterStates, isCatalogPagination, isCatalogAdRequest } from './filter-states.mjs';
import {MAIN1_SPEC,DUPLICATE_BUTTON_BLOCK,verifyMain1ButtonCandidate,applyMain1ButtonCandidate,verifyMain1ButtonCssomDelta} from './main1-button-pilot.mjs';
import {checkButtonStates} from './button-states.mjs';
import {MAIN1_OPTIMIZATION,optimizedMain1Revision} from './css.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { values } = parseArgs({ options: {
  css: { type: 'string' }, widths: { type: 'string', default: '1440,390,360' },
  headed: { type: 'boolean', default: false },
  'local-imports': { type: 'boolean', default: false },
  'check-posters': { type: 'boolean', default: false },
  'check-activity': { type: 'boolean', default: false },
  'check-layout': { type: 'boolean', default: false },
  component: { type: 'string', default: 'profile' },
  'check-history': { type: 'boolean', default: false },
  'check-filters': { type: 'boolean', default: false },
  'main1-button-candidate': { type: 'string' },
  'baseline-css': { type: 'string' }, 'baseline-compiled': { type: 'string' },
} });
if (!['profile','history','catalog'].includes(values.component)) throw new Error('Component must be profile, history or catalog.');
const posterMode = values['check-posters'];
const historyMode = values.component === 'history';
const catalogMode = values.component === 'catalog';
if (posterMode && values.component!=='profile') throw new Error('--check-posters requires the profile page.');
if (values['check-activity'] && values.component!=='profile') throw new Error('--check-activity requires the profile page.');
if (values['check-history'] && !historyMode) throw new Error('--check-history requires --component history.');
if (values['check-layout'] && values.component!=='profile') throw new Error('--check-layout requires the real profile component.');
if (values['check-filters'] && !catalogMode) throw new Error('--check-filters requires --component catalog.');
const buttonPilot=Boolean(values['main1-button-candidate']);
if(buttonPilot&&(values.component!=='profile'||values['local-imports']||values['baseline-css']||values['baseline-compiled']))
  throw new Error('--main1-button-candidate requires the live profile baseline and remote source verification.');
if (Boolean(values['baseline-css']) !== Boolean(values['baseline-compiled'])) {
  throw new Error('Historical replay requires both --baseline-css and --baseline-compiled.');
}
const widths = values.widths.split(',').map(Number);
if (!widths.length || widths.some(w => !Number.isInteger(w) || w < 320 || w > 3840)) {
  throw new Error('Widths must be integers from 320 to 3840.');
}
const localPath = path.resolve(root, values.css ?? 'styles_optimized.css');
const local = await readFile(localPath, 'utf8');
const buttonCandidatePath=buttonPilot?path.resolve(root,values['main1-button-candidate']):null;
if(buttonPilot&&(!buttonCandidatePath.startsWith(root)||path.extname(buttonCandidatePath)!=='.css'))
  throw new Error('Main1 candidate must be a workspace CSS file.');
const referenceLayout = await readFile(path.join(root, 'vendor/profile-content-layout-v1.css'), 'utf8');
const referenceHistory = await readFile(path.join(root, 'vendor/q03_history_bookmarks.css'), 'utf8');
const referenceActivity = await readFile(path.join(root, 'vendor/q05_animated_activity_graph.css'), 'utf8');
const activityMigrated = !extractLocal(local).imports.includes(ACTIVITY_SOURCE);
const referencePosters = await readFile(path.join(root, 'vendor/custom_posters.min.css'), 'utf8');
const postersMigrated = !extractLocal(local).imports.includes(POSTERS_SOURCE);
const historyMigrated = !extractLocal(local).imports.includes(HISTORY_SOURCE);
const run = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.join(root, '.preview', run);
await mkdir(output, { recursive: true });
const hash = s => createHash('sha256').update(s).digest('hex');
const PROFILE = 'https://shikimori.io/SadLaboka';
const PAGE = catalogMode ? CATALOG_URL : historyMode ? `${PROFILE}/history` : PROFILE;
const SOURCE_PAGE = catalogMode ? PROFILE : PAGE;
const STYLE = 'https://shikimori.io/api/styles/1343722';
const selectors = catalogMode ? {
  catalog: '.l-content .cc-entries', firstCard: '.l-content .b-catalog_entry',
  filters: '.b-collection-filters', filtersHead: '.c-filters-head',
  control: '.c-ms-control', rating: '.c-ms[data-field="rating"]',
} : historyMode ? {
  page: '.l-page', history: '.history-page', firstEntry: '.history-page span > a',
} : {
  page: '.l-page', head: '.profile-head', content: '.profile-content',
  top: '.solid', favorites: '.cc-favourites', achievements: '.achievements > .cc-2',
  headline: '.profile-content .subheadline', graph: '.activity .graph.x34 .bar-container',
  layout: '.profile-content > .cc-2', left: '.profile-content > .cc-2 > .c-left',
  right: '.profile-content > .cc-2 > .c-right', side: '.profile-content > .cc-2 > .c-right > .cc-2a',
  lifetime: '.profile-content .lifetime', graph26: '.activity .graph.x26', graph34: '.activity .graph.x34',
};
const freeze = `*,*::before,*::after{animation-play-state:paused!important;transition:none!important;caret-color:transparent!important}`;
const activeOwned = OWNED_IMPORTS.filter(spec=>extractLocal(local).imports.includes(spec.target));
if(values['local-imports'] && !activeOwned.length) throw new Error('--local-imports requires an approved owned-module candidate.');
const report = {
  sourceMode: values['local-imports'] ? 'local-owned-imports' : 'remote-imports',
  profile: PAGE, component: values.component, created: new Date().toISOString(), localHash: hash(local),
  mode: catalogMode ? 'replace-profile-theme-in-catalog-style-element' : 'replace-user-section-in-existing-style-element', engine: 'chromium',
  warnings: [
    'Fresh anonymous browser context; no user cookies, tokens or storageState.',
    'CSS animations paused at time 0; transitions disabled equally before and after.',
    'Animated GIF/WebP frames are NOT frozen. Pixel differences are diagnostic, not a pass/fail verdict.',
    'Mobile viewport widths are not physical devices. Existing mobile defects are not regressions.',
    'Server sanitizer/Camo is not fully reimplemented. Fidelity is validated for the published baseline only.',
    'Only explicitly supported complete migrations may remove their own foundation section; all other imports are preserved.',
  ],
  widths: [], blockedRequests: {},
};

// Compare parsed rules, not a whitespace-stripped string that could hide changes in content:"...".
async function signature(page, text) {
  return page.evaluate(css => {
    const style = document.createElement('style');
    style.media = 'not all';
    style.textContent = css;
    document.head.append(style);
    try {
      return [...style.sheet.cssRules].map(r => r.cssText.replace(/https?:\/\//g, '//'));
    } finally { style.remove(); }
  }, text);
}

async function settle(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (const animation of document.getAnimations()) {
      try { animation.pause(); animation.currentTime = 0; } catch { /* detached effect */ }
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function warmup(page) {
  for (const selector of catalogMode ? [] : ['.solid', '.activity', '.cc-favourites', '.achievements', '.l-footer']) {
    const element = page.locator(selector).first();
    if (await element.count() && await element.isVisible()) {
      // Some responsive blocks are hidden; CSS animations can also prevent Playwright's
      // stability-based scroll helper from completing. Scrolling itself is synchronous.
      await element.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
      await settle(page);
    }
  }
  // Wait for rendered images, including CSS pseudo-element replacements and both backgrounds.
  return page.evaluate(async () => {
    const urls = new Set();
    for (const el of [document.body, ...document.querySelectorAll('.l-page *')]) {
      for (const pseudo of [null, '::before', '::after']) {
        const css = getComputedStyle(el, pseudo).backgroundImage;
        for (const m of css.matchAll(/url\(["']?(.*?)["']?\)/g)) urls.add(m[1]);
      }
      if (el instanceof HTMLImageElement && el.getBoundingClientRect().height > 0) {
        if (el.currentSrc) urls.add(el.currentSrc);
      }
    }
    const failed = [];
    const list = [...urls];
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(8, list.length) }, async () => {
      while (index < list.length) {
        const url = list[index++];
        const ok = await new Promise(resolve => {
          const image = new Image();
          const timer = setTimeout(() => resolve(false), 12000);
          image.onload = () => { clearTimeout(timer); resolve(true); };
          image.onerror = () => { clearTimeout(timer); resolve(false); };
          image.src = url;
        });
        if (!ok) failed.push(url);
      }
    }));
    return { checked: list.length, failed };
  });
}

async function computed(page) {
  return page.evaluate(selectors => ({
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    elements: Object.fromEntries(Object.entries(selectors).map(([name, selector]) => {
      const el = document.querySelector(selector);
      if (!el) return [name, { missing: true }];
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const props = ['display', 'position', 'width', 'height', 'order', 'color', 'background-color',
        'font-family', 'font-size', 'padding-top','padding-right','padding-bottom','padding-left',
        'margin-top','margin-right','margin-bottom','margin-left', 'outline', 'box-shadow', 'border-radius',
        'background-image', 'overflow', 'content-visibility', 'contain-intrinsic-block-size',
        'animation-name', 'animation-play-state'];
      const pseudoState = pseudo => { const style = getComputedStyle(el, pseudo); return {
        content: style.content, display: style.display, width: style.width, height: style.height,
        backgroundImage: style.backgroundImage, animationName: style.animationName,
        position: style.position, zIndex: style.zIndex, transform: style.transform,
      }; };
      return [name, {
        rect: { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height },
        style: Object.fromEntries(props.map(p => [p, cs.getPropertyValue(p)])),
        before: pseudoState('::before'), after: pseudoState('::after'),
      }];
    })),
  }), selectors);
}

async function layoutState(page) {
  return page.evaluate(({historyMode,catalogMode}) => {
    const elements = [...document.querySelectorAll(catalogMode ? '.b-collection-filters, .b-collection-filters *, .l-content .b-catalog_entry, .l-content .b-catalog_entry *' : historyMode ? '.history-page, .history-page *' : '.profile-content > .cc-2, .profile-content > .cc-2 *')];
    return elements.map((el, index) => {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return { index, tag: el.tagName, class: el.className,
        rect: { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height },
        // All resolved CSS properties, including rules inherited from later imports.
        style: Object.fromEntries([...style].map(property => [property, style.getPropertyValue(property)])),
        ...(historyMode||catalogMode ? { pseudos: Object.fromEntries(['::before','::after'].map(p => { const cs=getComputedStyle(el,p); return [p,
          Object.fromEntries(['content','display','width','height','color','border','margin-right','border-radius','position','filter'].map(k=>[k,cs.getPropertyValue(k)]))]; })) } : {}) };
    });
  }, {historyMode,catalogMode});
}

async function capture(page, width, phase, css) {
  if(catalogMode) await ensureCatalogFilters(page);
  const assets = await warmup(page);
  if(catalogMode){
    await installCatalogTheme(page,css);
    await ensureCatalogFilters(page);
  }
  await page.evaluate(() => scrollTo(0, 0));
  await settle(page);
  const state = await computed(page);
  if(catalogMode && Object.values(state.elements).some(el=>el.missing))throw new Error('Required catalogue measurement target is missing.');
  const component = await layoutState(page);
  const layoutAudit = await auditLayout(page, referenceLayout);
  const historyAudit = await auditHistory(page, referenceHistory, referencePosters);
  const activityAudit = await auditActivity(page, referenceActivity);
  const posterAudit = await auditPosters(page, referencePosters);
  if (historyMode && await page.locator('.history-page span > a').count() === 0) throw new Error('History component has no real targets.');
  if (catalogMode && (!await page.locator('.l-content .b-catalog_entry').count() || !await page.locator('.c-ms-control').first().isVisible())) throw new Error('Catalog component has no visible real targets.');
  // Already paused by settle(). 'disabled' would finish finite effects and fire
  // animationend, changing the page between the before/after measurements.
  await page.screenshot({ path: path.join(output, `${width}-${phase}-top.png`), animations: 'allow' });
  const detailSelector=catalogMode ? '.l-content' : historyMode ? '.history-page' : '.cc-favourites';
  await page.locator(detailSelector).first().evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
  // Align the section heading near the top, rather than relying on its old page Y coordinate.
  await page.evaluate(selector => {
    const element = document.querySelector(selector);
    scrollTo(0, element.getBoundingClientRect().top + scrollY - 110);
  }, detailSelector);
  await settle(page);
  await page.screenshot({ path: path.join(output, `${width}-${phase}-details.png`), animations: 'allow' });
  const layout = page.locator(catalogMode ? '.b-collection-filters' : historyMode ? '.history-page' : '.profile-content > .cc-2').first();
  await layout.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await settle(page);
  if (historyMode) await page.screenshot({ path: path.join(output, `${width}-${phase}-component.png`), animations: 'allow' });
  else await layout.screenshot({ path: path.join(output, `${width}-${phase}-component.png`), animations: 'allow' });
  return { state, assets, component, layoutAudit, historyAudit, activityAudit, posterAudit };
}

async function diff(width, section) {
  const before = PNG.sync.read(await readFile(path.join(output, `${width}-before-${section}.png`)));
  const after = PNG.sync.read(await readFile(path.join(output, `${width}-after-${section}.png`)));
  // A changed component size is a regression signal, not a reason to skip the
  // remaining viewports. Pad both images for a diagnostic comparison.
  const canvas = { width: Math.max(before.width, after.width), height: Math.max(before.height, after.height) };
  const padded = input => {
    const png = new PNG(canvas);
    png.data.fill(255);
    for (let y = 0; y < input.height; y++) {
      input.data.copy(png.data, y * canvas.width * 4, y * input.width * 4, (y + 1) * input.width * 4);
    }
    return png.data;
  };
  const result = new PNG(canvas);
  const pixels = pixelmatch(padded(before), padded(after), result.data, canvas.width, canvas.height, { threshold: 0.1 });
  await writeFile(path.join(output, `${width}-diff-${section}.png`), PNG.sync.write(result));
  return { pixels, ratio: pixels / (canvas.width * canvas.height),
    beforeSize: { width: before.width, height: before.height },
    afterSize: { width: after.width, height: after.height },
    sizeChanged: before.width !== after.width || before.height !== after.height };
}

const browser = await chromium.launch({ headless: !values.headed });
report.browserVersion = browser.version();
try {
  // Separate, empty context. No default user profile, cookies, auth headers or credential files.
  const context = await browser.newContext({ viewport: { width: widths[0], height: 900 },
    deviceScaleFactor: 1, serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const request = route.request();
    if(catalogMode && isCatalogAdRequest(request.url(),request.resourceType())){
      report.blockedRequests.catalogAds=(report.blockedRequests.catalogAds??0)+1;
      return route.abort();
    }
    if(catalogMode && isCatalogPagination(request.url())){
      report.blockedRequests.catalogPagination=(report.blockedRequests.catalogPagination??0)+1;
      return route.abort();
    }
    if (!['GET', 'HEAD'].includes(request.method())) {
      report.blockedRequests[request.method()] = (report.blockedRequests[request.method()] ?? 0) + 1;
      return route.abort();
    }
    return route.continue();
  });
  await context.routeWebSocket('**/*', socket => socket.close());
  // Public read only: obtain the raw published source for import and processing validation.
  const response = await context.request.get(STYLE);
  if (!response.ok()) throw new Error(`Public style GET failed: HTTP ${response.status()}`);
  const published = await response.json();
  if (published.id !== 1343722 || published.owner_id !== 1408017 || typeof published.css !== 'string') {
    throw new Error('Unexpected public style owner or source.');
  }
  const publishedSource = values['baseline-css']
    ? await readFile(path.resolve(root, values['baseline-css']), 'utf8') : published.css;
  const publishedImports = extractLocal(publishedSource).imports;
  report.publishedHash = hash(publishedSource);
  report.livePublishedHash = hash(published.css);
  report.historicalReplay = Boolean(values['baseline-css']);
  report.localEqualsPublishedSource = local === publishedSource;
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(SOURCE_PAGE, { waitUntil: 'domcontentloaded' });
  await page.locator('style#custom_css').waitFor({ state: 'attached' });
  if (new URL(page.url()).pathname !== new URL(SOURCE_PAGE).pathname) throw new Error('Component navigation was redirected.');
  const liveOriginal = await page.locator('style#custom_css').textContent();
  const original = values['baseline-compiled']
    ? await readFile(path.resolve(root, values['baseline-compiled']), 'utf8') : liveOriginal;
  const { foundation, user } = splitCompiled(original);
  const planned = planFoundation(local, publishedSource, foundation);
  const expectedBaseline = joinCompiled(foundation, prepareUser(publishedSource));
  const actualRules = await signature(page, original);
  const modelRules = await signature(page, expectedBaseline);
  const compatible = JSON.stringify(actualRules) === JSON.stringify(modelRules);
  report.foundationHash = hash(foundation);
  report.imports = publishedImports;
  report.compiledStructure = { totalCharacters: original.length, foundationCharacters: foundation.length,
    userCharacters: user.length, topLevelRules: actualRules.length };
  report.baselineCssomMatches = compatible;
  if (!compatible) throw new Error('Processing model differs from the published CSSOM. Refusing an unverified replacement.');
  if (planned.migration) {
    const upstream = await readFile(path.join(root, planned.migration.snapshot), 'utf8');
    if (JSON.stringify(await signature(page, upstream)) !== JSON.stringify(await signature(page, planned.migration.originalBlock))) {
      throw new Error('Vendor snapshot differs from the live imported block; refusing migration.');
    }
    report.migration = { source: planned.migration.source, snapshot: planned.migration.snapshot,
      snapshotHash: hash(upstream), removedBlockHash: hash(planned.migration.originalBlock),
      remainingFoundationHash: hash(planned.foundation) };
  }
  const activePins = E_DESIGN_PINS.filter(pin => extractLocal(local).imports.includes(pin.target));
  report.versionPins = await Promise.all(activePins.map(async pin => {
    const currentSource = publishedImports.includes(pin.target) ? pin.target : pin.source;
    const markers = [...foundation.matchAll(/\/\*\s*(https?:[^*]+?)\s*\*\//g)];
    const index = markers.findIndex(m => m[1] === currentSource);
    if (index < 0) throw new Error('Pinned source compiled marker is missing.');
    const originalBlock = foundation.slice(markers[index].index, markers[index+1]?.index ?? foundation.length);
    const snapshot = await readFile(path.join(root,pin.snapshot));
    const fetched = await context.request.get(pin.target);
    if (!fetched.ok()) throw new Error(`Pinned source GET failed: HTTP ${fetched.status()}`);
    assertVersionPinBytes(pin,snapshot,await fetched.body());
    const rules = await signature(page,snapshot.toString('utf8'));
    const urlVerification = assertVersionPinRules(pin,rules,await signature(page,originalBlock));
    return { source:pin.source,target:pin.target,snapshot:pin.snapshot,sha256:pin.sha256,
      parsedRules:rules.length,urlVerification,verified:true };
  }));
  report.ownedImports = await Promise.all(activeOwned.map(async spec=>{
    const revision=ownedImportRevision(spec);
    const currentSource=publishedImports.includes(spec.target)?spec.target:spec.source;
    const markers=[...foundation.matchAll(/\/\*\s*(https?:[^*]+?)\s*\*\//g)];
    const index=markers.findIndex(m=>m[1]===currentSource);
    if(index<0)throw new Error('Owned module compiled source is missing.');
    const block=foundation.slice(markers[index].index,markers[index+1]?.index??foundation.length);
    const snapshot=await readFile(path.join(root,spec.snapshot));
    const working=await readFile(path.join(root,spec.local));
    assertVersionPinBytes(spec,snapshot,working);
    let candidateBytes;
    if(values['local-imports']) {
      try{candidateBytes=execFileSync('git',['show',`${revision}:${spec.local}`],
        {cwd:root,maxBuffer:2*1024*1024,stdio:['ignore','pipe','ignore']});}
      catch{throw new Error('Owned module is unavailable at the declared local commit/path.');}
    }else{
      const response=await context.request.get(spec.target);
      if(!response.ok())throw new Error(`Owned module remote GET failed: HTTP ${response.status()}; no local fallback.`);
      candidateBytes=await response.body();
    }
    assertVersionPinBytes(spec,snapshot,candidateBytes);
    const rules=await signature(page,candidateBytes.toString('utf8'));
    const upstream=E_DESIGN_PINS.find(pin=>pin.target===spec.source);
    const urlVerification=assertVersionPinRules(upstream,rules,await signature(page,block));
    return {source:spec.source,target:spec.target,local:spec.local,revision,sha256:spec.sha256,
      parsedRules:rules.length,urlVerification,verified:true,remoteVerified:!values['local-imports']};
  }));
  report.remoteSourcesVerified=report.ownedImports.every(row=>row.remoteVerified);
  const optimizedMain1=extractLocal(local).imports.includes(MAIN1_OPTIMIZATION.target);
  if(optimizedMain1){
    if(values['local-imports']||buttonPilot)throw new Error('Optimized main1 requires remote verification, without a local pilot.');
    const revision=optimizedMain1Revision();
    const snapshot=await readFile(path.join(root,MAIN1_SPEC.snapshot));
    const working=await readFile(path.join(root,MAIN1_SPEC.local));
    verifyMain1ButtonCandidate(snapshot,working);
    const fetched=await context.request.get(MAIN1_OPTIMIZATION.target);
    if(!fetched.ok())throw new Error(`Optimized main1 GET failed: HTTP ${fetched.status()}`);
    const candidate=await fetched.body();
    verifyMain1ButtonCandidate(snapshot,candidate);
    if(hash(candidate)!==MAIN1_OPTIMIZATION.sha256)throw new Error('Optimized main1 remote hash differs.');
    const source=publishedImports.includes(MAIN1_OPTIMIZATION.target)?MAIN1_OPTIMIZATION.target:MAIN1_OPTIMIZATION.source;
    const markers=[...foundation.matchAll(/\/\*\s*(https?:[^*]+?)\s*\*\//g)];
    const matching=markers.filter(m=>m[1]===source);
    if(matching.length!==1)throw new Error('Optimized main1 requires a unique compiled source marker.');
    const index=markers.indexOf(matching[0]);
    const block=foundation.slice(markers[index].index,markers[index+1]?.index??foundation.length);
    let rules=await signature(page,snapshot.toString('utf8'));
    let upstream=E_DESIGN_PINS.find(pin=>pin.target===MAIN1_SPEC.source);
    const removed=(await signature(page,DUPLICATE_BUTTON_BLOCK))[0];
    const removedIndex=rules.indexOf(removed);
    if(removedIndex<0||rules.filter(rule=>rule===removed).length!==1)throw new Error('Main1 removed rule is ambiguous.');
    if(source===MAIN1_OPTIMIZATION.target){
      rules=rules.filter((_,i)=>i!==removedIndex);
      upstream={...upstream,parsedRules:upstream.parsedRules-1,compiledUrlRewrites:upstream.compiledUrlRewrites.map(entry=>({...entry,rule:entry.rule>removedIndex?entry.rule-1:entry.rule}))};
    }else{
      const previous=await context.request.get(MAIN1_OPTIMIZATION.source);
      if(!previous.ok())throw new Error('Main1 previous remote source unavailable.');
      assertVersionPinBytes(MAIN1_SPEC,snapshot,await previous.body());
    }
    const urlVerification=assertVersionPinRules(upstream,rules,await signature(page,block));
    report.main1Optimization={...MAIN1_OPTIMIZATION,revision,remoteVerified:true,urlVerification,
      alreadyPublished:source===MAIN1_OPTIMIZATION.target};
    report.publicationReady=false; // Real component coverage remains incomplete.
  }
  let candidateFoundation=planned.foundation;
  if(buttonPilot){
    if(local!==published.css||planned.migration)throw new Error('Main1 pilot cannot be combined with other CSS/import changes.');
    const snapshot=await readFile(path.join(root,MAIN1_SPEC.snapshot));
    const candidate=await readFile(buttonCandidatePath);
    report.buttonPilot=verifyMain1ButtonCandidate(snapshot,candidate);
    candidateFoundation=applyMain1ButtonCandidate(candidateFoundation);
    report.sourceMode='local-main1-button-pilot';
    report.publicationReady=false;
  }
  const replacement = joinCompiled(candidateFoundation, prepareUser(local));
  report.candidateCompiledHash = hash(replacement);
  report.candidateCssomMatchesPublished = JSON.stringify(await signature(page, original)) === JSON.stringify(await signature(page, replacement));
  if(buttonPilot)Object.assign(report.buttonPilot,verifyMain1ButtonCssomDelta(
    await signature(page,original),await signature(page,replacement),await signature(page,DUPLICATE_BUTTON_BLOCK)));
  if(optimizedMain1&&!report.main1Optimization.alreadyPublished)Object.assign(report.main1Optimization,verifyMain1ButtonCssomDelta(
    await signature(page,original),await signature(page,replacement),await signature(page,DUPLICATE_BUTTON_BLOCK)));
  report.candidateImports = extractLocal(local).imports;
  await writeFile(path.join(output, 'published-compiled.css'), original);
  await writeFile(path.join(output, 'candidate-compiled.css'), replacement);
  await writeFile(path.join(output, 'local-source.css'), local);
  if(catalogMode)report.catalogTheme={source:PROFILE,target:PAGE,viewports:[]};
  await page.addStyleTag({ content: freeze });
  for (const width of widths) {
    const height = width >= 1024 ? 900 : 844;
    await page.setViewportSize({ width, height });
    if(catalogMode){
      // A fresh catalogue document avoids carrying its JS responsive-menu state
      // from the previous viewport into the baseline measurement.
      const response=await page.goto(PAGE,{waitUntil:'load'});
      if(!response?.ok())throw new Error(`Catalog GET failed: HTTP ${response?.status()}`);
      if(new URL(page.url()).pathname!==new URL(PAGE).pathname)throw new Error('Catalog navigation was redirected.');
      await page.locator('.c-ms-control').first().waitFor({state:'attached'});
      report.catalogTheme.viewports.push({width,...await installCatalogTheme(page,original)});
      await page.addStyleTag({content:freeze});
    }
    // Force a real baseline style recalculation too: assigning identical text may
    // reuse Blink's initial resolved auto-margin cache while the candidate reparses.
    await page.locator('style#custom_css').evaluate((style,text)=>{style.textContent=text+'\n/* preview baseline recalculation */';}, original);
    await settle(page);
    // Replace text in the SAME element at the SAME cascade position. Never append candidate CSS.
    await page.locator('style#custom_css').evaluate((style, text) => { style.textContent = text; }, original);
    const before = await capture(page, width, 'before', original);
    await page.locator('style#custom_css').evaluate((style, text) => { style.textContent = text; }, replacement);
    const applied = await page.locator('style#custom_css').textContent();
    if (splitCompiled(applied).foundation !== candidateFoundation || applied !== replacement) {
      throw new Error('Foundation preservation or replacement integrity failed.');
    }
    const after = await capture(page, width, 'after', replacement);
    const changes = Object.keys(selectors).filter(key =>
      JSON.stringify(before.state.elements[key]) !== JSON.stringify(after.state.elements[key]));
    const indices = Array.from({ length: Math.max(before.component.length, after.component.length) }, (_, i) => i);
    const componentChanges = indices.filter(index =>
      JSON.stringify(before.component[index]) !== JSON.stringify(after.component[index]));
    const componentGeometryChanges = indices.filter(index =>
      JSON.stringify(before.component[index]?.rect) !== JSON.stringify(after.component[index]?.rect));
    const componentStyleChanges = componentChanges.map(index => {
      const a = before.component[index]?.style ?? {};
      const b = after.component[index]?.style ?? {};
      return { index, properties: Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])]
        .filter(property => a[property] !== b[property]).map(property => [property, { before: a[property], after: b[property] }])) };
    });
    // Compare every property in memory, but don't duplicate ~65 MB of unchanged data in a report.
    for (const phase of [before, after]) {
      phase.component = phase.component.map(({ style, ...element }) =>
        ({ ...element, styleHash: hash(JSON.stringify(style)), checkedProperties: Object.keys(style).length }));
    }
    const pixels = { top: await diff(width, 'top'), details: await diff(width, 'details'), component: await diff(width, 'component') };
    report.widths.push({ width, height, before, after, appliedCompiledHash: hash(applied),
      changedElements: changes, componentChanges, componentGeometryChanges, componentStyleChanges, pixels });
    console.log(`${width}px: key changes=${changes.length}; component changes=${componentChanges.length}; geometry changes=${componentGeometryChanges.length}; diagnostic pixels top=${pixels.top.pixels}, details=${pixels.details.pixels}`);
  }
  if (values['check-history'] && report.widths.every(r=>r.after.historyAudit.valid)) {
    const stateWidths=widths.filter(w=>[1440,390,360].includes(w));
    report.historyStates = await checkHistoryStates({ context, page, baseline: original, candidate: replacement,
      widths: stateWidths.length?stateWidths:widths, output });
  }
  if (values['check-activity'] && report.widths.every(r=>r.after.activityAudit.valid)) {
    report.activityStates = await checkActivityStates({ page, baseline: original, candidate: replacement, widths, output });
  }
  if (posterMode && report.widths.every(r=>r.after.posterAudit.valid)) {
    report.posterStates = await checkPosterStates({context, page, baseline: original, candidate: replacement,
      widths: widths.filter(w=>[1440,390,360].includes(w)), output});
  }
  if(values['check-filters']) report.filterStates=await checkFilterStates({page,baseline:original,candidate:replacement,widths,output});
  if(buttonPilot||optimizedMain1)report.buttonStates=await checkButtonStates({page,baseline:original,candidate:replacement,widths,output});
  report.checks = {
    ownedImportsVerified: report.ownedImports.length===activeOwned.length && report.ownedImports.every(row=>row.verified),
    versionPinsVerified: report.versionPins.length === activePins.length && report.versionPins.every(pin=>pin.verified),
    singleLocalPosterCopy: !postersMigrated || report.widths.every(r=>r.after.posterAudit.valid),
    exactPosterCascade: !postersMigrated || report.candidateCssomMatchesPublished,
    posterStatesVerified: !posterMode || report.posterStates?.valid === true,
    exactAppliedCandidate: report.widths.every(r => r.appliedCompiledHash === report.candidateCompiledHash),
    singleLocalCopyWithoutOldImport: report.widths.every(r => r.after.layoutAudit.valid),
    singleLocalActivityCopy: !activityMigrated || report.widths.every(r => r.after.activityAudit.valid),
    activityStatesVerified: !values['check-activity'] || report.activityStates?.valid === true,
    singleLocalHistoryCopy: !historyMigrated || report.widths.every(r => r.after.historyAudit.valid),
    unchangedNonLayoutCascade: report.widths.every(r => {
      const key=postersMigrated?'posterAudit':activityMigrated?'activityAudit':historyMigrated?'historyAudit':'layoutAudit';return r.before[key].nonLayoutCascadeHash === r.after[key].nonLayoutCascadeHash; }),
    unchangedPseudoRules: report.widths.every(r => {
      const key=postersMigrated?'posterAudit':activityMigrated?'activityAudit':historyMigrated?'historyAudit':'layoutAudit';return r.before[key].pseudoRuleHash === r.after[key].pseudoRuleHash; }),
    sameStylesheetPosition: report.widths.every(r => r.before.layoutAudit.sheetIndex === r.after.layoutAudit.sheetIndex &&
      r.after.layoutAudit.customCssElements === 1),
    unchangedMeasuredElements: report.widths.every(r => r.changedElements.length === 0 && r.componentChanges.length === 0),
    historyStatesVerified: !values['check-history'] || report.historyStates?.valid === true,
    filterStatesVerified: !values['check-filters'] || report.filterStates?.valid === true,
  };
  report.verdict = Object.values(report.checks).every(Boolean) ? (values['local-imports'] ? 'LOCAL PASS' : 'PASS') : 'FAIL';
  if ((catalogMode || values['check-layout'] || values['check-history'] || values['check-activity'] || values['check-filters'] || posterMode) && report.verdict === 'FAIL') process.exitCode = 1;
  if(buttonPilot||optimizedMain1){
    report.strictMigrationVerdict=report.verdict;
    const expectedDelta=new Set(['exactPosterCascade','unchangedNonLayoutCascade']);
    report.pilotChecks={onlyApprovedRemoval:buttonPilot?report.buttonPilot.onlyApprovedRemoval:
      report.main1Optimization.alreadyPublished?report.candidateCssomMatchesPublished:report.main1Optimization.onlyApprovedRemoval,
      otherChecksPassed:Object.entries(report.checks).every(([key,value])=>value||expectedDelta.has(key)),
      buttonStatesEquivalent:report.buttonStates.valid,
      realButtonCoverage:report.buttonStates.realCoverageComplete};
    const technical=report.pilotChecks.onlyApprovedRemoval&&report.pilotChecks.otherChecksPassed&&report.pilotChecks.buttonStatesEquivalent;
    report.verdict=!technical?'FAIL':report.pilotChecks.realButtonCoverage?'LOCAL PILOT PASS':'INCOMPLETE';
    process.exitCode=!technical?1:report.pilotChecks.realButtonCoverage?0:2;
  }
  console.log(`${values.component} audit: ${report.verdict}`);
  await page.locator('style#custom_css').evaluate((style, text) => { style.textContent = text; }, liveOriginal);
  await context.close();
} catch (error) {
  // Do not dump requests, headers, response bodies, cookies, or raw page HTML.
  report.error = String(error.message).split('\n')[0];
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const html = `<!doctype html><meta charset="utf-8"><title>Shikimori local CSS preview</title>
<style>body{font:16px system-ui;margin:24px;background:#171717;color:#ddd}a{color:#9bf}.pair{display:flex;gap:12px;align-items:flex-start}.pair figure{margin:0;flex:1;min-width:0}img{width:100%;height:auto}pre{white-space:pre-wrap}</style>
<h1>Локальный предпросмотр CSS</h1>${values['local-imports'] ? '<p><strong>Локальная копия модуля и Git-коммит проверены. Удалённый URL не проверен; этот результат не подтверждает готовность публикации.</strong></p>' : ''}<p>Стиль на сайте не изменён этим прогоном. ${report.migration ? `Только проверенный блок ${report.migration.source === POSTERS_SOURCE ? 'механизма постеров' : report.migration.source === ACTIVITY_SOURCE ? 'графика активности' : report.migration.source === HISTORY_SOURCE ? 'подписей истории' : 'раскладки'} перенесён из импорта в локальную часть; остальные импорты сохранены.` : 'Импортированная основа сохранена.'} Слева — опубликованный CSS, справа — локальная замена.</p>
${buttonPilot ? '<p><strong>Локальный пилот: из основы убран только проверенный дубль кнопки main1. Новый удалённый источник не подключён. Это не готовность публикации.</strong></p>' : ''}
${report.main1Optimization ? '<p><strong>Оптимизированный main1: удалённый источник и точное удаление дубля проверены. Покрытие реального компонента указано отдельно; INCOMPLETE не означает общий PASS.</strong></p>' : ''}
${catalogMode ? '<p>Настоящий анонимный каталог: опубликованная тема профиля и кандидат временно заменяют его реальный custom_css slot. Настройки аккаунта не меняются.</p>' : ''}
<p>CSS-анимации остановлены; GIF/WebP продолжают менять кадры. Pixel diff не является автоматическим вердиктом.</p>
<p>Совпадение модели обработки с опубликованным CSSOM: ${report.baselineCssomMatches ?? false}. <a href="report.json">Вычисленные стили и полный отчёт</a>.</p>
<p>Аудит ${catalogMode ? 'каталога' : historyMode ? 'истории' : 'раскладки'}: <strong>${report.verdict ?? 'ERROR'}</strong>. ${report.historicalReplay ? 'Повторяется сохранённый CSS до публикации на текущем DOM.' : 'База сравнения — текущий опубликованный CSS.'}</p>
${report.filterStates ? `<p>Фильтры реального каталога: ${report.filterStates.cases.length} проверок; <a href="filters.html">состояния и снимки</a>.</p>` : ''}
${report.buttonStates ? `<p>Кнопки: реальных ${report.buttonStates.realButtons}, примеров ${report.buttonStates.fixtures.length}. <a href="buttons.html">Покрытие и снимки</a>. Строгий миграционный вердикт: ${report.strictMigrationVerdict}.</p><pre>${escape(JSON.stringify(report.pilotChecks,null,2))}</pre>` : ''}
${report.historyStates ? `<p>Состояния истории: ${report.historyStates.cases.length} сравнений реального DOM и ${report.historyStates.fixtures.length} тестовых примеров; изменённых узлов: ${report.historyStates.changed}. Реальных записей ранобэ: ${report.historyStates.coverage.ranobe}.</p>` : ''}
${report.activityStates ? `<p>График: ${report.activityStates.cases.length} сравнений фаз и состояний; изменённых узлов: ${report.activityStates.changed}. <a href="activity.html">Снимки графика и состояния</a>.</p>` : ''}
${report.posterStates ? `<p>Постеры: ${report.posterStates.cases.length} проверок; <a href="posters.html">страницы, состояния и снимки</a>.</p>` : ''}
${report.versionPins?.length ? `<p>Проверено фиксаций версии: ${report.versionPins.length}; исходники сверены по SHA256 и CSSOM.</p>` : ''}
<pre>${escape(JSON.stringify(report.checks ?? {}, null, 2))}</pre>
${report.error ? `<p>Ошибка: ${escape(report.error)}</p>` : ''}
${report.widths.map(r => `<h2>${r.width} × ${r.height}</h2><p>Изменённые ключевые элементы: ${escape(r.changedElements.join(', ') || 'нет')}. Изменённые узлы компонента: ${r.componentChanges.length}; геометрия: ${r.componentGeometryChanges.length}.</p>${['top', 'details', 'component'].map(section => `<h3>${section}</h3><div class="pair">${['before', 'after'].map(phase => `<figure><figcaption>${phase}</figcaption><a href="${r.width}-${phase}-${section}.png"><img src="${r.width}-${phase}-${section}.png"></a></figure>`).join('')}</div><p><a href="${r.width}-diff-${section}.png">Диагностическая разница</a>: ${r.pixels[section].pixels} пикселей.</p>`).join('')}`).join('')}`;
  await writeFile(path.join(output, 'index.html'), html);
  console.log(`Report: ${path.join(output, 'index.html')}`);
  if (report.error) console.error(report.error);
}
