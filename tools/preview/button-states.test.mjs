import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {checkButtonStates} from './button-states.mjs';

// Offline contract and negative control, not real Shikimori component coverage.
test('button pilot distinguishes missing real coverage and detects a computed-style regression',async()=>{
  const output=await mkdtemp(path.join(os.tmpdir(),'shiki-button-test-'));
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage();
    await page.route('**/*',route=>route.abort());
    await page.setContent('<!doctype html><style id="custom_css"></style><main class="l-page"></main>');
    const baseline='.b-link_button{display:inline-block;color:rgb(200,200,200);background:#222;padding:8px;border:0}.b-link_button:hover{color:white}.b-link_button:focus{outline:2px solid blue}.b-link_button:active{background:#555}';
    const same=await checkButtonStates({page,baseline,candidate:baseline,widths:[390],output});
    assert.equal(same.valid,true);
    assert.equal(same.fixtures.length,24);
    assert.equal(same.realCoverageComplete,false);
    assert.equal(await page.locator('#preview-button-fixture').count(),0);
    const broken=await checkButtonStates({page,baseline,candidate:baseline+'.b-link_button::before{content:"broken";color:red}',widths:[390],output});
    assert.equal(broken.valid,false);
    assert.ok(broken.changed>0);
    assert.ok(broken.fixtures.some(row=>Object.keys(row.properties).some(key=>key.startsWith('before.'))));
    assert.equal(await page.locator('#custom_css').count(),1);
  }finally{
    await browser.close();
    const resolved=path.resolve(output);
    assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('shiki-button-test-'));
    await rm(resolved,{recursive:true,force:true});
  }
});
