import { createHash } from 'node:crypto';
import path from 'node:path';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const props = ['content','display','width','height','color','background-image','border','border-radius',
  'margin-top','margin-right','margin-bottom','margin-left','position','opacity','filter','transform'];

// Uses the same baseline/candidate strings as preview.mjs, never a CSS overlay.
export async function checkHistoryStates({ context, page, baseline, candidate, widths, output }) {
  const result = { cases: [], coverage: {}, fixtures: [], changed: 0 };
  const freeze='*,*::before,*::after{animation-play-state:paused!important;transition:none!important;caret-color:transparent!important}';
  async function sample(target,css) {
    await target.locator('#custom_css').evaluate((el,text)=>el.textContent=text,css);
    return target.evaluate(async props=>{
      await document.fonts.ready;
      for(const animation of document.getAnimations())try{animation.pause();animation.currentTime=0;}catch{}
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const nodes=[...document.querySelectorAll('.history-page, .history-page *, .b-catalog_entry-tooltip, .b-catalog_entry-tooltip *')];
      return nodes.map((el,i)=>{
        const rect=el.getBoundingClientRect();
        const read=pseudo=>{const cs=getComputedStyle(el,pseudo);return Object.fromEntries(props.map(p=>[p,cs.getPropertyValue(p)]));};
        return {i,tag:el.tagName,class:el.className,href:el.getAttribute('href'),
          rect:el.getClientRects().length?[rect.x+scrollX,rect.y+scrollY,rect.width,rect.height]:[0,0,0,0],
          normal:read(null),before:read('::before'),after:read('::after')};
      });
    },props);
  }
  async function stable(target,css){
    let previous=await sample(target,css);
    for(let i=0;i<8;i++){
      await target.waitForTimeout(120);
      const next=await sample(target,css);
      if(hash(previous)===hash(next))return next;
      previous=next;
    }
    throw new Error('History state is not stable; refusing equivalence verdict.');
  }
  async function compare(target,width,locale,state,fixture){
    const before=await stable(target,baseline),after=await stable(target,candidate);
    const changes=Array.from({length:Math.max(before.length,after.length)},(_,i)=>i)
      .filter(i=>JSON.stringify(before[i])!==JSON.stringify(after[i]));
    const row={width,locale,state,nodes:before.length,changedNodes:changes.length,
      beforeHash:hash(before),afterHash:hash(after),details:changes.slice(0,10).map(i=>({index:i,before:before[i],after:after[i]}))};
    (fixture?result.fixtures:result.cases).push(row);result.changed+=changes.length;
    return row;
  }
  const originalLocale=await page.locator('html').getAttribute('data-locale');
  const realTypes=[];
  for(const [type,prefix] of [['anime','/a'],['manga','/m'],['ranobe','/r']]){
    const count=await page.locator(`.history-page span > a[href^="${prefix}"]`).count();
    result.coverage[type]=count;if(count)realTypes.push([type,prefix]);
  }
  if(!realTypes.length)throw new Error('No real history entries; state coverage is empty.');
  for(const width of widths)for(const locale of ['ru','en']){
    await page.mouse.move(0,0);await page.evaluate(()=>document.activeElement?.blur?.());
    await page.waitForTimeout(1200);
    await page.setViewportSize({width,height:width>=1024?900:844});
    await page.locator('html').evaluate((el,value)=>el.dataset.locale=value,locale);
    await page.evaluate(()=>scrollTo(0,0));
    await compare(page,width,locale,'idle',false);
    for(const [type,prefix] of realTypes){
      const link=page.locator(`.history-page span > a[href^="${prefix}"]`).first();
      for(const state of ['hover','focus','active']){
        await page.locator('#custom_css').evaluate((el,text)=>el.textContent=text,candidate);
        await link.hover();await page.waitForTimeout(900);
        if(state==='focus')await link.focus();
        if(state==='active')await page.mouse.down();
        try{
          const activated=await link.evaluate((el,state)=>el.matches(`:${state}`),state);
          if(!activated)throw new Error(`Requested history :${state} was not activated.`);
          await compare(page,width,locale,`${state}-${type}`,false);
          if(width===1440&&locale==='ru'&&state==='hover'&&type==='anime')
            await page.screenshot({path:path.join(output,'history-hover-candidate.png'),animations:'allow'});
        }finally{await page.mouse.move(0,0);await page.mouse.up();}
      }
    }
    console.log(`history states ${width}px ${locale}: real types=${realTypes.length}`);
  }
  if(originalLocale===null)await page.locator('html').evaluate(el=>delete el.dataset.locale);
  else await page.locator('html').evaluate((el,value)=>el.dataset.locale=value,originalLocale);
  await page.locator('#custom_css').evaluate((el,text)=>el.textContent=text,baseline);

  const fixture=await context.newPage();
  await fixture.setContent(`<!doctype html><html data-locale="ru"><head><base href="https://shikimori.io/"><style id="custom_css"></style><style>${freeze}</style></head><body id="user_histories_index" class="p-user_histories p-user_histories-index x1200"><section class="l-page"><div class="history-page">${['animes','mangas','ranobe'].map(type=>`<div><span><a class="b-link" href="/${type}/1">${type}</a></span></div>`).join('')}<div class="b-catalog_entry-tooltip"><div class="entry-tooltip_container"><a href="/animes/1" style="display:block;width:160px;height:80px">nested tooltip</a></div></div></div></section></body></html>`);
  for(const width of widths)for(const locale of ['ru','en']){
    await fixture.setViewportSize({width,height:844});
    await fixture.locator('html').evaluate((el,value)=>el.dataset.locale=value,locale);
    // Interactive states are tested on real links above. This fixture covers
    // otherwise absent link types and the nested-tooltip cascade counterexample.
    for(const state of ['idle']){
      await fixture.locator('#custom_css').evaluate((el,text)=>el.textContent=text,candidate);
      const link=fixture.locator('.history-page span > a').first();
      await fixture.mouse.move(0,0);
      if(state!=='idle')await link.hover();
      if(state==='focus')await link.focus();
      if(state==='active')await fixture.mouse.down();
      try{await compare(fixture,width,locale,state,true);}
      finally{await fixture.mouse.move(0,0);await fixture.mouse.up();}
    }
  }
  await fixture.close();
  result.valid=result.changed===0 && result.cases.length>0 && result.fixtures.length>0;
  result.limitations=['Ranobe has no entries in the real history sample; covered in an explicit fixture.',
    'English labels on the real DOM use a temporary data-locale attribute; account settings are unchanged.'];
  return result;
}
