import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Fixtures are labelled separately; absence of real buttons is never a live PASS.
export async function checkButtonStates({page,baseline,candidate,widths,output}){
  const realButtons=page.locator('.b-link_button:not([data-pilot-button])');
  const realCount=await realButtons.count();
  const result={realButtons:realCount,realCases:[],fixtures:[],screenshots:[],changed:0,
    limitations:['Anonymous Chromium only; real button coverage is required separately.',
      'Fixtures exercise anchor/button/input tags and an alternate inherited palette.',
      'CSS animations and transitions are frozen; pointer click actions are prevented in this test tab.']};
  await page.evaluate(()=>{
    const fixture=document.createElement('section');fixture.id='preview-button-fixture';
    fixture.style.cssText='padding:12px;margin:12px 0;background:#161616;color:white;border:1px dashed #888;position:relative;z-index:1';
    fixture.innerHTML='<p>Explicit button fixtures — not live interface</p>'+['default','alternate'].map(palette=>
      `<div style="display:flex;flex-wrap:wrap;gap:12px;padding:8px;${palette==='alternate'?'--white-color:220,210,200;--buttoms-color:12,24,36;--hover-buttoms-2:80,100,130;':''}">
      <a href="#preview-only" class="b-link_button" data-pilot-button="${palette}-anchor">Link</a>
      <button type="button" class="b-link_button" data-pilot-button="${palette}-button">Button</button>
      <input type="button" class="b-link_button" data-pilot-button="${palette}-input" value="Input"></div>`).join('');
    document.querySelector('.l-page').append(fixture);
    window.__previewButtonGuard=event=>{if(event.target.closest('.b-link_button')){event.preventDefault();event.stopImmediatePropagation();}};
    document.addEventListener('click',window.__previewButtonGuard,true);
    document.addEventListener('dragstart',window.__previewButtonGuard,true);
  });
  async function sample(css,target,state){
    await page.locator('#custom_css').evaluate((s,text)=>{
      s.sheet.disabled=true;void document.body.offsetHeight;
      s.textContent=text;s.sheet.disabled=false;void document.body.offsetHeight;
    },css);
    await page.evaluate(async()=>{await document.fonts.ready;for(const a of document.getAnimations())try{a.pause();a.currentTime=0;}catch{};await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
    await page.mouse.move(0,0);await page.evaluate(()=>document.activeElement?.blur?.());
    if(state!=='normal'){
      await target.hover({timeout:5000});
      // A sheet replacement can invalidate the previous hit-test position.
      const box=await target.boundingBox();
      if(!box)throw new Error('Button has no visible geometry.');
      await page.mouse.move(box.x+box.width/2,box.y+box.height/2,{steps:3});
    }
    if(state==='focus')await target.focus();
    if(state==='active')await page.mouse.down();
    try{
      await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
      if(state!=='normal'&&!await target.evaluate((el,state)=>el.matches(`:${state}`),state))throw new Error(`Button :${state} was not activated: ${await target.getAttribute('data-pilot-button')}.`);
      return await target.evaluate(async el=>{
        await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const r=el.getBoundingClientRect();const read=p=>{const cs=getComputedStyle(el,p);return Object.fromEntries([...cs].map(k=>[k,cs.getPropertyValue(k)]));};
        return {tag:el.tagName,rect:[r.x+scrollX,r.y+scrollY,r.width,r.height],normal:read(null),before:read('::before'),after:read('::after')};
      });
    }finally{if(state==='active'){await page.mouse.up();await page.mouse.move(0,0);}}
  }
  try{
    const targets=[...Array.from({length:Math.min(realCount,3)},(_,i)=>({kind:'real',id:`real-${i}`,locator:realButtons.nth(i)})),
      ...['default','alternate'].flatMap(palette=>['anchor','button','input'].map(tag=>({kind:'fixture',id:`${palette}-${tag}`,locator:page.locator(`[data-pilot-button="${palette}-${tag}"]`)})))];
    for(const width of widths){
      await page.setViewportSize({width,height:width>=1024?900:844});
      await page.locator('#preview-button-fixture').evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
      for(const target of targets)for(const state of ['normal','hover','focus','active']){
        const before=await sample(baseline,target.locator,state),after=await sample(candidate,target.locator,state);
        const equal=JSON.stringify(before)===JSON.stringify(after);
        const properties={};
        for(const group of ['normal','before','after'])for(const key of Object.keys(before[group]))
          if(before[group][key]!==after[group][key])properties[`${group}.${key}`]={before:before[group][key],after:after[group][key]};
        const row={width,target:target.id,state,equal,beforeHash:hash(before),afterHash:hash(after),properties,
          geometryChanged:JSON.stringify(before.rect)!==JSON.stringify(after.rect)};
        (target.kind==='real'?result.realCases:result.fixtures).push(row);if(!equal)result.changed++;
      }
      for(const [phase,css]of[['before',baseline],['after',candidate]]){
        await sample(css,targets.at(-1).locator,'normal');
        const file=`buttons-${width}-${phase}.png`;
        await page.locator('#preview-button-fixture').screenshot({path:path.join(output,file),animations:'allow'});
        result.screenshots.push({width,phase,file});
      }
      console.log(`button pilot ${width}px: real=${realCount}; fixture cases=24`);
    }
    result.valid=result.changed===0&&result.fixtures.length===widths.length*24;
    result.realCoverageComplete=realCount>0&&result.realCases.length===widths.length*Math.min(realCount,3)*4;
    return result;
  }finally{
    await page.mouse.up().catch(()=>{});
    await page.evaluate(()=>{document.removeEventListener('click',window.__previewButtonGuard,true);document.removeEventListener('dragstart',window.__previewButtonGuard,true);delete window.__previewButtonGuard;document.querySelector('#preview-button-fixture')?.remove();});
    await writeFile(path.join(output,'buttons.json'),JSON.stringify(result,null,2));
    await writeFile(path.join(output,'buttons.html'),`<!doctype html><meta charset="utf-8"><title>Button pilot</title><style>body{background:#171717;color:#ddd;font:16px system-ui}img{max-width:100%}</style><h1>Button pilot</h1><p>Real buttons: ${result.realButtons}. Fixture cases: ${result.fixtures.length}; changes: ${result.changed}.</p><p>Fixtures are not real interface coverage.</p><a href="buttons.json">States and limitations</a>${result.screenshots.map(s=>`<h2>${s.width}px ${s.phase}</h2><img src="${s.file}">`).join('')}`);
  }
}
