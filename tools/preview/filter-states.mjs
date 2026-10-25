import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

export const CATALOG_URL='https://shikimori.io/animes';
export const FILTER_FREEZE='*,*::before,*::after{animation-play-state:paused!important;transition:none!important;caret-color:transparent!important}';
export function isCatalogPagination(url){
  const u=new URL(url);
  const page=u.pathname.match(/^\/animes\/page\/(\d+)(?:\/|$)/);
  return u.origin==='https://shikimori.io' &&
    (Number(page?.[1])>1||
      /^\/animes\/?$/.test(u.pathname)&&Number(u.searchParams.get('page'))>1);
}
export function isCatalogAdRequest(url,type){
  const u=new URL(url);
  return type==='script' && (u.origin!=='https://shikimori.io'||u.pathname.endsWith('/mobile_fullscreen_ad.js'));
}
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const properties=['display','visibility','position','top','right','bottom','left','z-index','color','background-color','background-image',
  'width','height','min-width','max-width','min-height','max-height','box-sizing','padding','margin','border','border-radius',
  'box-shadow','outline','outline-offset','opacity','filter','transform','font-family','font-size','font-weight','line-height',
  'text-align','text-decoration','text-overflow','white-space','overflow-x','overflow-y','cursor','content','gap','align-items',
  'justify-content','flex-direction','flex-wrap','order','pointer-events'];

export async function installCatalogTheme(page,css){
  if(await page.locator('style#custom_css').count()!==1)throw new Error('Catalog requires exactly one real custom_css slot.');
  if(!await page.locator('.b-collection-filters .c-ms').count()||!await page.locator('.l-content .b-catalog_entry').count())
    throw new Error('Catalog has no real filter or poster targets.');
  const slot=page.locator('style#custom_css');
  const position=await slot.evaluate(s=>[...document.styleSheets].indexOf(s.sheet));
  await slot.evaluate((s,text)=>{
    // Reset Blink's collapsed-margin layout cache for BOTH snapshots. Merely
    // reassigning equivalent text can retain a stale 5px catalogue offset.
    s.sheet.disabled=true;void document.body.offsetHeight;
    s.textContent=text;s.sheet.disabled=false;void document.body.offsetHeight;
  },css);
  return {position,customCssElements:1};
}

export async function ensureCatalogFilters(page){
  const control=page.locator('.b-collection-filters .c-ms-control').first();
  if(!await control.isVisible()){
    const toggler=page.locator('.menu-toggler .toggler');
    if(!await toggler.isVisible())throw new Error('Filters are hidden and the real mobile toggle is unavailable.');
    await toggler.click({timeout:5000});
    await control.waitFor({state:'visible',timeout:5000});
  }
}

export function compareFilterSnapshots(before,after){
  if(!before.nodes.length||!after.nodes.length)throw new Error('Empty filter snapshot cannot pass.');
  const changed=[];
  for(let i=0;i<Math.max(before.nodes.length,after.nodes.length);i++){
    const a=before.nodes[i],b=after.nodes[i];
    if(JSON.stringify(a)===JSON.stringify(b))continue;
    const properties={};
    for(const group of ['normal','before','after']){
      const keys=new Set([...Object.keys(a?.[group]??{}),...Object.keys(b?.[group]??{})]);
      for(const key of keys)if(a?.[group]?.[key]!==b?.[group]?.[key])
        properties[`${group}.${key}`]={before:a?.[group]?.[key],after:b?.[group]?.[key]};
    }
    changed.push({index:i,tag:a?.tag??b?.tag,field:a?.field??b?.field,
      geometryChanged:JSON.stringify(a?.rect)!==JSON.stringify(b?.rect),properties});
  }
  return {changedNodes:changed.length,changes:changed,beforeHash:digest(before),afterHash:digest(after)};
}

export async function sampleFilterState(page,css,activate){
  const slot=await installCatalogTheme(page,css);
  if(activate)await activate();
  return page.evaluate(async({slot,css,properties})=>{
    void document.body.offsetHeight;
    await document.fonts.ready;
    for(const a of document.getAnimations())try{a.pause();a.currentTime=0;}catch{}
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    if(document.querySelector('#custom_css').textContent!==css)throw new Error('Catalog theme was reset while sampling.');
    const panel=document.querySelector('.b-collection-filters');
    const targets=[panel,...panel.querySelectorAll('*')];
    const cards=[...document.querySelectorAll('.l-content .b-catalog_entry')].slice(0,3);
    targets.push(...cards.flatMap(el=>[el,...el.querySelectorAll('*')]));
    const read=(el,p)=>{const cs=getComputedStyle(el,p);return Object.fromEntries(properties.map(k=>[k,cs.getPropertyValue(k)]));};
    return {slot,nodes:targets.map((el,index)=>{
      const r=el.getBoundingClientRect();return {index,tag:el.tagName,class:el.className,
        field:el.closest('.c-ms')?.dataset.field??null,visible:!!el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden',
        rect:[r.x+scrollX,r.y+scrollY,r.width,r.height],normal:read(el,null),before:read(el,'::before'),after:read(el,'::after')};
    })};
  },{slot,css,properties});
}

async function stable(page,css,activate){
  let previous=await sampleFilterState(page,css,activate);
  for(let n=0;n<5;n++){
    const next=await sampleFilterState(page,css,activate);
    if(digest(previous)===digest(next))return next;
    previous=next;
  }
  throw new Error('Catalog filter state did not stabilize.');
}

// Real public catalogue, same full baseline/candidate replacement as preview.mjs.
export async function checkFilterStates({page,baseline,candidate,widths,output}){
  if(!widths.length)throw new Error('Filter state widths are empty.');
  const result={url:CATALOG_URL,checkedProperties:properties,cases:[],coverage:[],screenshots:[],changed:0,limitations:[
    'Anonymous Chromium; not Firefox, authenticated lists or physical phones.',
    'Profile theme replaces the real catalogue custom_css slot only in this browser.',
    'First three catalogue cards and all filter descendants are measured; other catalogue components are not covered.',
    'GIF/WebP remain animated. No fixtures or forced CSS visibility are used.',
    'Automatic catalogue pagination is blocked by the runner to keep the first page fixed.',
    'Third-party scripts and the site fullscreen-ad script are blocked; advertisement behavior is outside scope.',
  ]};
  async function load(url){
    const response=await page.goto(url,{waitUntil:'domcontentloaded'});
    if(!response?.ok())throw new Error(`Catalog GET failed: HTTP ${response?.status()}`);
    await page.locator('.c-ms-control').first().waitFor({state:'attached'});
    await page.waitForLoadState('load',{timeout:15000});
    await installCatalogTheme(page,baseline);
    await page.addStyleTag({content:FILTER_FREEZE});
  }
  async function compare(width,state,{shot=false,expect,activate}={}){
    const before=await stable(page,baseline,activate);
    if(expect&&!await expect()){
      const hovered=await page.locator(':hover').evaluateAll(nodes=>nodes.slice(-5).map(el=>el.className));
      throw new Error(`Baseline filter state was not activated: ${state}; hovered=${JSON.stringify(hovered)}`);
    }
    const after=await stable(page,candidate,activate);
    if(expect&&!await expect())throw new Error(`Candidate filter state was lost: ${state}`);
    if(before.slot.position!==after.slot.position)throw new Error('Catalog stylesheet cascade position changed.');
    const row={width,state,nodes:before.nodes.length,...compareFilterSnapshots(before,after)};
    result.cases.push(row);result.changed+=row.changedNodes;
    if(shot)for(const [phase,css] of [['before',baseline],['after',candidate]]){
      await stable(page,css);
      const file=`filters-${width}-${state}-${phase}.png`;
      await page.screenshot({path:path.join(output,file),animations:'allow'});
      result.screenshots.push({width,state,phase,file});
    }
  }
  try{
    for(const width of widths){
      await page.setViewportSize({width,height:width>=1024?900:844});
      await page.mouse.move(0,0);await load(CATALOG_URL);
      const initialVisible=await page.locator('.c-ms-control').first().isVisible();
      await compare(width,'initial');
      await ensureCatalogFilters(page);
      result.coverage.push({width,fields:await page.locator('.c-ms').count(),initialVisible,
        mobileOpened:!initialVisible,realCards:await page.locator('.l-content .b-catalog_entry').count()});
      await compare(width,'panel-open',{expect:()=>page.locator('.c-ms-control').first().isVisible()});
      let widget=page.locator('.c-ms[data-field="rating"]');
      const control=()=>widget.locator('.c-ms-control');
      await control().focus();
      await compare(width,'control-focus',{expect:()=>control().evaluate(el=>el.matches(':focus'))});
      await control().click();
      await widget.locator('.c-ms-dropdown').waitFor({state:'visible'});
      const option=()=>widget.locator('.c-ms-option[data-value="g"]');
      await control().evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
      await page.mouse.move(0,0);
      await compare(width,'dropdown-open',{shot:true,expect:()=>widget.locator('.c-ms-dropdown').isVisible()});
      await option().hover();
      await compare(width,'option-hover',{activate:async()=>{await page.mouse.move(0,0);await option().hover();},expect:()=>option().evaluate(el=>el.matches(':hover'))});
      await page.mouse.down();
      try{await compare(width,'option-active',{expect:()=>option().evaluate(el=>el.matches(':active'))});}
      finally{await page.mouse.move(0,0);await page.mouse.up();}
      // Releasing :active may itself select an option in the site widget.
      // Start the independent selection check from a fresh, unselected document.
      await load(CATALOG_URL);await ensureCatalogFilters(page);
      widget=page.locator('.c-ms[data-field="rating"]');
      await control().click();await widget.locator('.c-ms-dropdown').waitFor({state:'visible',timeout:5000});
      await option().click({timeout:5000});
      const selected=()=>widget.locator('.c-ms-option[data-value="g"]').evaluate(el=>el.classList.contains('is-on'));
      if(!await selected())throw new Error('Real selected option is missing after clicking.');
      await control().evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
      await page.mouse.move(0,0);
      await compare(width,'selected-open',{shot:true,expect:selected});
      await widget.locator('.c-ms-option.is-on').hover();
      await compare(width,'selected-hover',{activate:async()=>{await page.mouse.move(0,0);await widget.locator('.c-ms-option.is-on').hover();},expect:()=>widget.locator('.c-ms-option.is-on').evaluate(el=>el.matches(':hover'))});
      // The site commits multi-selection when the dropdown closes, not on each
      // option click. The resulting navigation clears the anonymous theme slot.
      // A selected chip inside the control cycles inclusion/exclusion when clicked.
      // Close by clicking the non-interactive header background instead.
      await Promise.all([page.waitForURL(url=>url.searchParams.get('rating')==='g',{timeout:10000}),
        page.locator('.c-filters-head').click({position:{x:5,y:5},timeout:5000})]);
      await load(`${CATALOG_URL}?rating=g`);await ensureCatalogFilters(page);
      widget=page.locator('.c-ms[data-field="rating"]');
      if(!await selected())throw new Error('Selected option did not survive the real catalogue reload.');
      await compare(width,'selected-chip',{expect:selected});
      const long=page.locator('.c-ms[data-field="genre"]').first();
      await long.locator('.c-ms-control').click();
      await long.locator('.c-ms-dropdown').waitFor({state:'visible'});
      await long.locator('.c-ms-control').evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
      await page.mouse.move(0,0);
      await compare(width,'genre-open',{shot:true,expect:()=>long.locator('.c-ms-dropdown').isVisible()});
      console.log(`catalog filters ${width}px: real fields=${result.coverage.at(-1).fields}`);
    }
    result.valid=result.changed===0&&result.coverage.length===widths.length&&result.cases.length===widths.length*10;
    return result;
  }finally{
    await page.mouse.up().catch(()=>{});
    await writeFile(path.join(output,'filters.json'),JSON.stringify(result,null,2));
    const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    await writeFile(path.join(output,'filters.html'),`<!doctype html><meta charset="utf-8"><title>Catalog filters</title><style>body{background:#171717;color:#ddd;font:16px system-ui}img{max-width:100%}</style><h1>Catalog filters: ${result.valid?'PASS':'FAIL / incomplete'}</h1><a href="filters.json">Coverage and changed properties</a><pre>${esc(JSON.stringify(result.coverage,null,2))}</pre>${result.screenshots.map(s=>`<h2>${s.width}px ${s.state} ${s.phase}</h2><img src="${s.file}">`).join('')}`);
  }
}
