import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const profileScope='.b-catalog_entry > .cover, .b-catalog_entry > .cover .image-cutter, .b-catalog_entry > .cover img, .b-catalog_entry-tooltip, .b-catalog_entry-tooltip *';
const collectionScope='.b-collection-topic .collection-row, .b-collection-topic .collection-row .cover, .b-collection-topic .collection-row .image-cutter, .b-collection-topic .collection-row img';
const freeze='*,*::before,*::after{animation-play-state:paused!important;transition:none!important;caret-color:transparent!important}';

export function posterFixtureHtml(){return `<!doctype html><html data-locale="ru"><head><base href="https://shikimori.io/"><style id="custom_css"></style><style>${freeze}</style></head><body><section class="l-page"><div class="history-page"><div class="b-catalog_entry-tooltip"><div class="entry-tooltip_container"><a href="/a/1" style="--custom-image:linear-gradient(red,blue);--show-default:0;--custom-image-ratio:2/3"><img width="80" height="120"></a></div></div></div><div class="b-collection-topic"><div class="inner">${['','is-censored','is-spoilers','is-censored is-spoilers'].map(flag=>`<div class="collection-row ${flag}" style="--custom-image:linear-gradient(red,blue);--custom-settings:center / contain;--custom-images-radius:12px;--custom-images-filter-transition:.3s"><a class="cover" href="/a/1" style="display:block;width:80px;height:120px"><span class="image-cutter" style="display:block;position:relative;width:80px;height:120px"><img width="80" height="120"></span></a></div>`).join('')}</div></div></section></body></html>`;}

// Same full baseline/candidate as preview.mjs. No overlay of candidate onto baseline.
export async function checkPosterStates({context,page,baseline,candidate,widths,output}) {
  if(!widths.length)throw new Error('Poster state widths are empty.');
  const result={cases:[],coverage:{},screenshots:[],changed:0,limitations:[
    'Chromium viewports, not Firefox or physical phones; animated image frames are not frozen.',
    'Collections use the actual anonymous public DOM, with this profile theme temporarily replacing the existing custom_css slot.',
    'Missing censor/custom-variable branches are explicit fixtures, not claimed as real-site coverage.',
    'Mobile real tooltip DOM is hidden by a responsive container; visible mobile tooltip geometry is covered only in an explicit fixture.',
  ]};
  async function settle(target){await target.evaluate(async()=>{await document.fonts.ready;for(const a of document.getAnimations())try{a.pause();a.currentTime=0;}catch{}await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});}
  async function read(target,scope){return target.evaluate(scope=>[...document.querySelectorAll(scope)].map((el,i)=>{const rect=el.getBoundingClientRect();const style=p=>{const cs=getComputedStyle(el,p);return Object.fromEntries([...cs].map(k=>[k,cs.getPropertyValue(k)]));};return {i,tag:el.tagName,class:el.className,href:el.getAttribute('href'),rect:[rect.x+scrollX,rect.y+scrollY,rect.width,rect.height],normal:style(null),before:style('::before'),after:style('::after')};}),scope);}
  async function sample(target,css,scope){await target.locator('#custom_css').evaluate((s,text)=>s.textContent=text,css);await settle(target);let previous=await read(target,scope);for(let n=0;n<5;n++){await target.waitForTimeout(80);const next=await read(target,scope);if(digest(next)===digest(previous))return next;previous=next;}throw new Error('Poster state did not stabilize.');}
  async function compare(target,scope,width,state,kind){const before=await sample(target,baseline,scope),after=await sample(target,candidate,scope);if(!before.length)throw new Error('No actual poster targets.');const changes=Array.from({length:Math.max(before.length,after.length)},(_,i)=>i).filter(i=>JSON.stringify(before[i])!==JSON.stringify(after[i]));const row={width,state,kind,nodes:before.length,changed:changes.length,beforeHash:digest(before),afterHash:digest(after),details:changes.slice(0,3).map(i=>({index:i,before:before[i],after:after[i]}))};result.cases.push(row);result.changed+=changes.length;return after;}
  async function screenshots(target,locator,width,kind){for(const [phase,css] of [['before',baseline],['after',candidate]]){await target.locator('#custom_css').evaluate((s,text)=>s.textContent=text,css);await settle(target);const name=`posters-${kind}-${width}-${phase}.png`;await locator.screenshot({path:path.join(output,name),animations:'allow'});result.screenshots.push({width,kind,phase,file:name});}}
  const collection=await context.newPage();
  const sheetResponses=new Map();
  collection.on('response',response=>{if(response.request().resourceType()==='stylesheet')sheetResponses.set(response.url(),response);});
  const fixture=await context.newPage();
  try{
    result.coverage.profile=await page.locator('.cc-favourites .b-catalog_entry').count();
    if(!result.coverage.profile)throw new Error('No real profile posters.');
    for(const width of widths){
      console.log(`poster states profile ${width}px...`);
      await page.setViewportSize({width,height:width>=1024?900:844});await page.mouse.move(0,0);
      await page.locator('#custom_css').evaluate((s,text)=>s.textContent=text,baseline+'\n/* recalculate */');await settle(page);
      await page.locator('.cc-favourites').evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
      await compare(page,profileScope,width,'idle','profile');
      await screenshots(page,page.locator('.cc-favourites').first(),width,'profile');
      const link=page.locator('.cc-favourites .b-catalog_entry > a.cover').first();
      await link.hover();await page.waitForTimeout(1200);
      await page.locator('.b-catalog_entry-tooltip').first().waitFor({state:'attached',timeout:10000});
      const visibleTooltip=await page.locator('.b-catalog_entry-tooltip').first().isVisible();
      (result.coverage.tooltips??=[]).push({width,visible:visibleTooltip,mode:visibleTooltip?'real visible popup':'real DOM hidden by responsive container'});
      if(width===1440 && !visibleTooltip)throw new Error('Desktop poster tooltip is not visible.');
      result.coverage.realTooltip=true;
      for(const state of ['hover','focus','active']){
        if(state==='focus')await link.focus();if(state==='active')await page.mouse.down();
        try{if(!await link.evaluate((el,state)=>el.matches(`:${state}`),state))throw new Error(`Poster :${state} not activated.`);await compare(page,profileScope,width,state,'profile-tooltip');if(state==='hover' && visibleTooltip)await screenshots(page,page.locator('.b-catalog_entry-tooltip').first(),width,'tooltip');}
        finally{if(state==='active'){await page.mouse.move(0,0);await page.mouse.up();}}
      }
      await page.mouse.move(0,0);await page.evaluate(()=>document.activeElement?.blur?.());await page.waitForTimeout(800);
    }
    await collection.goto('https://shikimori.io/collections',{waitUntil:'domcontentloaded'});
    if(await collection.locator('#custom_css').count()!==1)throw new Error('Collection custom_css slot missing.');
    await collection.addStyleTag({content:freeze});
    result.coverage.collections=await collection.locator('.b-collection-topic .collection-row .image-cutter').count();
    result.coverage.realSpoilerRows=await collection.locator('.b-collection-topic .collection-row.is-spoilers').count();
    result.coverage.realCensoredRows=await collection.locator('.b-collection-topic .collection-row.is-censored').count();
    if(!result.coverage.collections)throw new Error('No actual collection covers.');
    for(const width of widths){
      console.log(`poster states collections ${width}px...`);
      await collection.setViewportSize({width,height:844});await collection.mouse.move(0,0);
      await collection.locator('#custom_css').evaluate((s,text)=>s.textContent=text,baseline+'\n/* recalculate */');await settle(collection);
      await compare(collection,collectionScope,width,'idle','collections');
      const cover=collection.locator('.b-collection-topic .collection-row.is-spoilers .cover').first();
      if(await cover.count()){await cover.hover();await collection.waitForTimeout(600);await compare(collection,collectionScope,width,'hover-spoiler','collections');await collection.mouse.move(0,0);}
      await screenshots(collection,collection.locator('.b-collection-topic').first(),width,'collections');
    }
    // Missing flag combinations and non-default custom variables use explicit fixtures.
    const html=posterFixtureHtml();
    const siteSheets=await collection.evaluate(freeze=>[...document.styleSheets]
      .filter(sheet=>sheet.ownerNode?.textContent!==freeze)
      .map(sheet=>{if(sheet.ownerNode?.id==='custom_css')return {custom:true};
        try{return {css:[...sheet.cssRules].map(r=>r.cssText).join('\n')};}
        catch{return {unreadable:true,href:sheet.href};}}),freeze);
    result.coverage.capturedCrossOriginSheets=[];
    for(const row of siteSheets)if(row.unreadable){
      // Read the exact stylesheet response already loaded by this anonymous page,
      // rather than ignoring it or issuing a potentially different second request.
      const response=sheetResponses.get(row.href);
      if(!response?.ok())throw new Error('Unreadable base stylesheet has no captured response.');
      row.css=await response.text();
      result.coverage.capturedCrossOriginSheets.push(row.href);
    }
    await fixture.setContent(html);
    // Include the actual site's base styles: a bare fixture omits the l-page
    // stacking/layout rules and may leave body decorations intercepting pointers.
    await fixture.evaluate(({sheets,freeze})=>{
      document.querySelectorAll('style').forEach(el=>el.remove());
      for(const row of [...sheets,{css:freeze}]){const s=document.createElement('style');
        if(row.custom)s.id='custom_css';else s.textContent=row.css;document.head.append(s);}
    },{sheets:siteSheets,freeze});
    for(const width of widths)for(const locale of ['ru','en']){
      console.log(`poster fixture ${width}px ${locale}...`);
      await fixture.setViewportSize({width,height:844});await fixture.locator('html').evaluate((el,l)=>el.dataset.locale=l,locale);
      await fixture.mouse.move(0,0);
      const scope='.b-collection-topic, .b-collection-topic *, .b-catalog_entry-tooltip, .b-catalog_entry-tooltip *';
      await compare(fixture,scope,width,`idle-${locale}`,'fixture');
      for(const flag of ['is-censored','is-spoilers','is-censored.is-spoilers']){
        const cover=fixture.locator(`.collection-row.${flag} > .cover`).first();await cover.hover();
        const rows=await compare(fixture,scope,width,`hover-${flag}-${locale}`,'fixture');
        const visible=await cover.locator('.image-cutter').evaluate(el=>getComputedStyle(el,'::before').filter);
        if(visible!=='blur(0px) grayscale(0)')throw new Error(`Expected hover filter restoration, got ${visible}`);
        await fixture.mouse.move(0,0);
      }
    }
    result.valid=result.changed===0&&result.coverage.realTooltip&&result.coverage.collections>0&&result.cases.length>0;
    await writeFile(path.join(output,'posters.json'),JSON.stringify(result,null,2));
    await writeFile(path.join(output,'posters.html'),`<!doctype html><meta charset="utf-8"><title>Poster comparison</title><style>body{background:#171717;color:#ddd;font:16px system-ui}img{max-width:100%}a{color:#9bf}</style><h1>Постеры: ${result.valid?'PASS':'FAIL'}</h1><a href="posters.json">Покрытие, состояния и ограничения</a>${['profile','tooltip','collections'].map(kind=>widths.map(w=>`<h2>${kind}: ${w}px</h2>${result.screenshots.filter(r=>r.kind===kind&&r.width===w).map(r=>`<p>${r.phase}</p><img src="${r.file}">`).join('')}`).join('')).join('')}`);
    return result;
  }finally{await page.mouse.move(0,0);await page.mouse.up();await collection.close();await fixture.close();}
}
