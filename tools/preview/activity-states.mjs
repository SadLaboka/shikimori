import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scope='.activity .graph, .activity .graph *';
// Real DOM, full CSS replacement. Seek every CSS animation deterministically;
// WAAPI pause does not override the computed CSS animation-play-state used by hover.
export async function checkActivityStates({page,baseline,candidate,widths,output}) {
  if(!widths.length)throw new Error('No activity widths requested.');
  const result={cases:[],changed:0,coverage:[],limitations:[
    'Chromium viewports, not Firefox or physical phones.',
    'Sampled shared timeline positions (0, 1250, 2500ms) retain per-column delays; not a performance measurement.',
    'Focus/active are not assigned to non-interactive graph divs.',
  ]};
  const freezes=await page.locator('style').evaluateAll(nodes=>nodes.flatMap((s,i)=>s.textContent.includes('animation-play-state:paused!important;transition:none!important;caret-color:transparent!important')?[i]:[]));
  if(freezes.length!==1)throw new Error('Expected exactly one preview animation freeze.');
  const freeze=page.locator('style').nth(freezes[0]);
  await freeze.evaluate(s=>s.sheet.disabled=true);
  async function sample(css,phase) {
    await page.locator('#custom_css').evaluate((s,text)=>s.textContent=text,css);
    return page.evaluate(async ({scope,phase})=>{
      await document.fonts.ready;
      void document.body.offsetHeight;
      for(const a of document.getAnimations()){
        try{a.pause();const timing=a.effect.getTiming();const target=a.effect.target;
          a.currentTime=target?.closest?.('.activity') ? Number(timing.duration)*phase : 0;
        }catch{}
      }
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      const nodes=[...document.querySelectorAll(scope)];
      return nodes.map((el,index)=>{const r=el.getBoundingClientRect();const read=p=>{const cs=getComputedStyle(el,p);return Object.fromEntries([...cs].map(k=>[k,cs.getPropertyValue(k)]));};
        return {index,parentIndex:nodes.indexOf(el.parentElement),class:el.className,visible:el.getClientRects().length>0,
          rect:[r.x+scrollX,r.y+scrollY,r.width,r.height],normal:read(null),before:read('::before'),after:read('::after')};});
    },{scope,phase});
  }
  try{
    for(const width of widths){
      console.log(`activity states ${width}px...`);
      await page.setViewportSize({width,height:width>=1024?900:844});
      await page.locator('#custom_css').evaluate((s,text)=>s.textContent=text,baseline);
      await page.locator('.activity').evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
      await page.mouse.move(0,0);
      const coverage=await page.locator('.activity .graph').evaluateAll(graphs=>graphs.map(el=>({class:el.className,lines:el.querySelectorAll('.line').length,visible:!!el.getClientRects().length&&getComputedStyle(el).display!=='none'})));
      if(!coverage.some(g=>g.visible&&g.lines>=26))throw new Error('No real visible activity graph.');
      result.coverage.push({width,graphs:coverage});
      for(const state of ['phase-0','phase-0.5','phase-1','hover-1','hover-17','hover-34','unhover']){
        const phase=state.startsWith('phase-')?Number(state.slice(6)):0.5;
        await page.locator('#custom_css').evaluate((s,text)=>s.textContent=text,baseline);
        await sample(baseline,phase);
        await page.mouse.move(0,0);
        if(state.startsWith('hover-')){
          const n=Number(state.slice(6));
          const selector=`.activity .graph .line:nth-child(${n})`;
          const targets=page.locator(selector);let target;
          for(let i=0;i<await targets.count();i++)if(await targets.nth(i).isVisible()){target=targets.nth(i);break;}
          if(!target){result.cases.push({width,state,skipped:'Column does not exist in the visible graph.'});continue;}
          await target.hover();
          if(!await target.evaluate(el=>el.matches(':hover')))throw new Error('Activity hover was not activated.');
        }
        const before=await sample(baseline,phase),after=await sample(candidate,phase);
        const changes=Array.from({length:Math.max(before.length,after.length)},(_,i)=>i).filter(i=>JSON.stringify(before[i])!==JSON.stringify(after[i]));
        const row={width,state,nodes:before.length,changed:changes.length,beforeHash:digest(before),afterHash:digest(after),
          details:changes.slice(0,4).map(i=>({index:i,before:before[i],after:after[i]}))};
        // Keep animation settings explicit; the full snapshots are compared in memory.
        row.lines=after.filter(el=>/(^|\s)line(\s|$)/.test(el.class)).map(el=>{
          const container=after.find(child=>child.parentIndex===el.index && /(^|\s)bar-container(\s|$)/.test(child.class));
          if(!container)throw new Error('Activity column has no real bar-container child.');
          return {class:el.class,visible:el.visible,delay:el.normal['animation-delay'],duration:el.normal['animation-duration'],
            playState:el.normal['animation-play-state'],name:el.normal['animation-name'],
            pseudoName:container.before['animation-name'],clip:container.before['clip-path'],pseudoPlayState:container.before['animation-play-state']};
        });
        const visibleLines=row.lines.filter(el=>el.visible);
        if(!visibleLines.length || !visibleLines.every(el=>el.pseudoName==='profile-activity-pulse'))
          throw new Error('Expected real optimized pseudo animations are not applied.');
        if(state.startsWith('hover-') && !visibleLines.some(el=>el.playState==='paused' && el.pseudoPlayState==='paused'))
          throw new Error('Real hover did not propagate its CSS pause to the pseudo animation.');
        result.cases.push(row);result.changed+=changes.length;
        if(state==='phase-0.5'){
          for(const [phaseName,css] of [['before',baseline],['after',candidate]]){
            await sample(css,phase);
            await page.locator('.activity').screenshot({path:path.join(output,`${width}-${phaseName}-activity.png`),animations:'allow'});
          }
        }
      }
    }
    result.valid=result.cases.length>0&&result.changed===0&&result.coverage.length===widths.length&&
      result.cases.filter(r=>!r.skipped).every(r=>r.nodes>0);
    await writeFile(path.join(output,'activity.json'),JSON.stringify(result,null,2));
    await writeFile(path.join(output,'activity.html'),`<!doctype html><meta charset="utf-8"><title>Activity graph comparison</title><style>body{background:#171717;color:#ddd;font:16px system-ui}img{max-width:100%}</style><h1>График активности: ${result.valid?'PASS':'FAIL'}</h1><a href="activity.json">Фазы, состояния и ограничения</a>${widths.map(w=>`<h2>${w}px</h2><p>До</p><img src="${w}-before-activity.png"><p>После</p><img src="${w}-after-activity.png">`).join('')}`);
    return result;
  }finally{await page.mouse.move(0,0);await freeze.evaluate(s=>s.sheet.disabled=false);}
}
