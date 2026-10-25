import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MAIN1_OPTIMIZATION,optimizedMain1Revision,planFoundation} from './css.mjs';
import {DUPLICATE_BUTTON_BLOCK} from './main1-button-change.mjs';

test('optimized main1 URL is bound to the original module and exact approved output hash',()=>{
  assert.match(optimizedMain1Revision(),/^[a-f0-9]{40}$/);
  for(const change of [{source:'https://other.test/a.css'},{target:MAIN1_OPTIMIZATION.target.replace('SadLaboka','Other')},
    {target:MAIN1_OPTIMIZATION.target.replace('main_code_1.css','main_code_2.css')},{sha256:'0'.repeat(64)}])
    assert.throws(()=>optimizedMain1Revision({...MAIN1_OPTIMIZATION,...change}),/Unapproved/);
});

test('optimized main1 replacement preserves every byte except one rule and its source label',async()=>{
  const snapshot=await readFile(new URL('../../vendor/edesign/main_code_1.css',import.meta.url),'utf8');
  const before=`@import "${MAIN1_OPTIMIZATION.source}";@import "https://other.test/a.css";a{color:red}`;
  const after=before.replace(MAIN1_OPTIMIZATION.source,MAIN1_OPTIMIZATION.target);
  const foundation=`/* ${MAIN1_OPTIMIZATION.source} */${snapshot}/* https://other.test/a.css */z{color:blue}`;
  const result=planFoundation(after,before,foundation);
  assert.equal(result.foundation,foundation.replace(DUPLICATE_BUTTON_BLOCK,'').replace(MAIN1_OPTIMIZATION.source,MAIN1_OPTIMIZATION.target));
  assert.ok(result.main1Optimization);
  for(const css of [after+'b{color:red}',after.replace('https://other.test/a.css','https://other.test/b.css')])
    assert.throws(()=>planFoundation(css,before,foundation));
  for(const css of [foundation.replace(DUPLICATE_BUTTON_BLOCK,''),foundation.replace(DUPLICATE_BUTTON_BLOCK,DUPLICATE_BUTTON_BLOCK.repeat(2))])
    assert.throws(()=>planFoundation(after,before,css),/exact duplicate/);
});
