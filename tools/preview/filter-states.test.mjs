import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {installCatalogTheme,ensureCatalogFilters,sampleFilterState,compareFilterSnapshots,isCatalogPagination,isCatalogAdRequest} from './filter-states.mjs';

// Offline tool contract, not claimed as real Shikimori coverage.
function fixture(selected=false){
  const widget=(field,values)=>`<div class="c-ms" data-field="${field}"><div class="c-ms-control" tabindex="0" role="button" aria-expanded="false"><div class="c-ms-chips">${selected&&field==='rating'?'G':'любой'}</div></div><div class="c-ms-dropdown"><ul class="c-ms-options">${values.map(value=>`<li class="c-ms-option ${selected&&field==='rating'&&value==='g'?'is-on':''}" data-value="${value}"><span class="c-ms-option-mark"></span>${value}</li>`).join('')}</ul></div></div>`;
  return `<html><head><style>.c-ms-dropdown{display:none}.c-ms-control[aria-expanded=true]+.c-ms-dropdown{display:block}.c-ms-control{height:28px}.c-ms-option{padding:8px}.c-ms-option:hover{background:#aaa}.c-ms-option:active{color:red}.menu-toggler{display:none}@media(max-width:1023px){.l-menu{display:none}.menu-expanded .l-menu{display:block}.menu-toggler{display:block;width:40px;height:30px}.toggler{width:40px;height:30px}}</style></head><body><style id="custom_css"></style><section class="l-page"><div class="menu-toggler"><div class="toggler">menu</div></div><aside class="l-menu"><div class="b-collection-filters"><div class="c-filters-head">Фильтры</div>${widget('rating',['g','pg'])}${widget('genre',['comedy','action','drama'])}</div></aside><main class="l-content"><article class="b-catalog_entry">poster</article></main></section><script>
  document.addEventListener('click',event=>{
    if(event.target.closest('.toggler'))document.querySelector('.l-page').classList.toggle('menu-expanded');
  });</script></body></html>`;
}

test('catalog pagination isolation does not block selection queries or unrelated hosts',()=>{
  for(const url of ['https://shikimori.io/animes/page/2','https://shikimori.io/animes/page/10','https://shikimori.io/animes?page=3&rating=g'])assert.equal(isCatalogPagination(url),true);
  for(const url of ['https://shikimori.io/animes?page=1','https://shikimori.io/animes?rating=g','https://shikimori.io/animes/1','https://other.test/animes/page/2'])assert.equal(isCatalogPagination(url),false);
  assert.equal(isCatalogAdRequest('https://shikimori.io/assets/mobile_fullscreen_ad.js','script'),true);
  assert.equal(isCatalogAdRequest('https://counter.example/script.js','script'),true);
  assert.equal(isCatalogAdRequest('https://shikimori.io/assets/application.js','script'),false);
  assert.equal(isCatalogAdRequest('https://fonts.gstatic.com/font.woff2','font'),false);
});

test('filter sampling catches palette, pseudo and geometry regressions without overlaying CSS',async()=>{
  const browser=await chromium.launch();try{
    const page=await browser.newPage();await page.setContent(fixture());
    const baseline='.c-ms-dropdown{background:#141414;color:#c7c7c7}';
    const before=await sampleFilterState(page,baseline);
    assert.equal(compareFilterSnapshots(before,await sampleFilterState(page,baseline)).changedNodes,0);
    for(const change of ['.c-ms-dropdown{background:white!important}', '.c-filters-head::before{content:"broken"}', '.c-ms-control{margin-left:3px}']){
      const after=await sampleFilterState(page,baseline+change);
      assert.ok(compareFilterSnapshots(before,after).changedNodes>0,change);
      assert.equal(before.slot.position,after.slot.position);
      assert.equal(await page.locator('#custom_css').count(),1);
    }
    await page.locator('#custom_css').evaluate(s=>s.insertAdjacentHTML('afterend','<style id="custom_css"></style>'));
    await assert.rejects(()=>installCatalogTheme(page,baseline),/exactly one/);
    assert.throws(()=>compareFilterSnapshots({nodes:[]},{nodes:[]}),/cannot pass/);
  }finally{await browser.close();}
});

test('catalogue navigation clears the temporary theme and mobile opening uses the page toggle',async()=>{
  const browser=await chromium.launch();
  try{
    const context=await browser.newContext();let loads=0;
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());loads++;
      return route.fulfill({contentType:'text/html',body:fixture(url.searchParams.get('rating')==='g')});
    });
    const page=await context.newPage();
    await page.setViewportSize({width:390,height:844});
    await page.goto('https://shikimori.io/animes');
    assert.equal(await page.locator('.c-ms-control').first().isVisible(),false);
    await installCatalogTheme(page,'.c-ms{color:#aaa}');
    await ensureCatalogFilters(page);
    assert.equal(await page.locator('.c-ms-control').first().isVisible(),true);
    await page.goto('https://shikimori.io/animes?rating=g');
    assert.equal(await page.locator('#custom_css').textContent(),'');
    await installCatalogTheme(page,'.c-ms{color:#aaa}');
    assert.ok(loads>=2);
    assert.equal(await page.locator('.c-ms-option.is-on').count(),1);
    assert.equal(await page.locator('#custom_css').textContent(),'.c-ms{color:#aaa}');
    await page.setContent('<style id="custom_css"></style>');
    await assert.rejects(()=>installCatalogTheme(page,''),/no real/);
  }finally{
    await browser.close();
  }
});

test('catalog CLI refuses incompatible profile/history state flags before opening a browser',()=>{
  const cli=new URL('./preview.mjs',import.meta.url);
  for(const args of [['--component','catalog','--check-layout'],['--component','catalog','--check-history'],['--component','history','--check-filters'],['--component','catalog','--check-posters']]){
    assert.throws(()=>execFileSync(process.execPath,[fileURLToPath(cli),...args],{encoding:'utf8',stdio:'pipe'}),error=>error.status===1&&error.stderr.includes('requires'));
  }
});
