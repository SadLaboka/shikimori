import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MAIN1_SPEC,DUPLICATE_BUTTON_BLOCK,verifyMain1ButtonCandidate,applyMain1ButtonCandidate,verifyMain1ButtonCssomDelta} from './main1-button-pilot.mjs';

test('main1 candidate permits exactly one approved byte removal and retains browser fallbacks',async()=>{
  const snapshot=await readFile(new URL('../../'+MAIN1_SPEC.snapshot,import.meta.url));
  const candidate=Buffer.from(snapshot.toString('utf8').replace(DUPLICATE_BUTTON_BLOCK,''));
  const proof=verifyMain1ButtonCandidate(snapshot,candidate);
  assert.equal(proof.removedBytes,Buffer.byteLength(DUPLICATE_BUTTON_BLOCK));
  assert.equal(proof.candidateRemoteVerified,false);
  assert.ok(candidate.toString().includes('width: -moz-available;'));
  for(const changed of [snapshot,Buffer.concat([candidate,Buffer.from('\na{color:red}')]),Buffer.from(candidate.toString().replace('border-radius: 14px','border-radius: 13px'))])
    assert.throws(()=>verifyMain1ButtonCandidate(snapshot,changed),/exact/);
  assert.throws(()=>verifyMain1ButtonCandidate(Buffer.concat([snapshot,Buffer.from(' ')]),candidate),/baseline/);
});

test('main1 foundation changes only the selected block, including opaque URL rewrites and unsupported declarations',()=>{
  const marker=`/* ${MAIN1_SPEC.target} */`;
  const opaque='@font-face{src:url("https://camo.example/original")}body{width:-moz-available}';
  const before=`/* https://other.test/a.css */a{color:red}${marker}${opaque}${DUPLICATE_BUTTON_BLOCK}/* https://other.test/b.css */b{color:blue}`;
  assert.equal(applyMain1ButtonCandidate(before),before.replace(DUPLICATE_BUTTON_BLOCK,''));
  assert.throws(()=>applyMain1ButtonCandidate(before+marker),/one published/);
  assert.throws(()=>applyMain1ButtonCandidate(before.replace(DUPLICATE_BUTTON_BLOCK,'')),/exactly one/);
});

test('compiled delta proof rejects extra removals, additions and changed unrelated properties',()=>{
  const before=['a{color:red}','button{color:white}','z{width:2px}'];
  assert.equal(verifyMain1ButtonCssomDelta(before,[before[0],before[2]],[before[1]]).onlyApprovedRemoval,true);
  for(const after of [[before[0]],[before[0],'z{width:3px}'],[before[0],before[2],'x{height:1px}']])
    assert.throws(()=>verifyMain1ButtonCssomDelta(before,after,[before[1]]),/outside/);
});
