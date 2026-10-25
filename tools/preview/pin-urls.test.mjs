import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assertVersionPinRules} from './css.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const legacy='/x/images.example.test/a.png';
const direct='//images.example.test/a.png';
const raw=`.cover { width: 10px; background-image: url("${legacy}"); }`;
const expected=`.cover { width: 10px; background-image: url("${direct}"); }`;
const spec=(from=legacy,to=direct,source=raw)=>({parsedRules:1,compiledUrlRewrites:[{rule:0,sourceRuleSha256:hash(source),urls:[{from,to,occurrences:1}]}]});

test('observed legacy URL rewrite preserves all other CSS and never mutates source rules',()=>{
  const input=[raw];assert.deepEqual(assertVersionPinRules(spec(),input,[expected]),{rewrittenRules:1,rewrittenUrls:1});
  assert.deepEqual(input,[raw]);
  for(const bad of [expected.replace('10px','11px'),expected.replace('.cover','.other'),expected+' a{}'])
    assert.throws(()=>assertVersionPinRules(spec(),[raw],[bad]));
  assert.throws(()=>assertVersionPinRules(spec(),[raw.replace('10px','11px')],[expected]));
  assert.throws(()=>assertVersionPinRules(spec(),[raw],[]));
  assert.throws(()=>assertVersionPinRules({compiledUrlRewrites:[]},[raw],[expected]));
  const duplicate=structuredClone(spec());duplicate.compiledUrlRewrites.push(duplicate.compiledUrlRewrites[0]);
  assert.throws(()=>assertVersionPinRules(duplicate,[raw],[expected]));
});

test('Camo is accepted only for the original HTTPS resource and exact observed output',()=>{
  const from='//images.example.test/a.png?q=a&v=1';
  const url=`//camo-v3.shikimori.io/${'a'.repeat(40)}?url=${encodeURIComponent('https:'+from)}`;
  const source=`.x::before { content: url("${from}"); }`;
  const compiled=`.x::before { content: url("${url}"); }`;
  assert.equal(assertVersionPinRules(spec(from,url,source),[source],[compiled]).rewrittenUrls,1);
  for(const bad of [url.replace('camo-v3.shikimori.io','other.example.test'),url+'&url='+encodeURIComponent('https:'+from),url+'#extra',url.replace(encodeURIComponent('https:'+from),encodeURIComponent('https://other.example.test/a.png'))]){
    assert.throws(()=>assertVersionPinRules(spec(from,bad,source),[source],[compiled.replace(url,bad)]));
  }
  assert.throws(()=>assertVersionPinRules(spec(from,url,source),[source],[compiled.replace('a'.repeat(40),'b'.repeat(40))]));
  assert.throws(()=>assertVersionPinRules(spec(legacy,'//other.example.test/a.png'),[raw],[expected.replace(direct,'//other.example.test/a.png')]));
});

test('URL exceptions are bound to rule index, fingerprint, occurrence count and actual url tokens',()=>{
  const missing=spec();missing.compiledUrlRewrites[0].urls[0].occurrences=2;
  assert.throws(()=>assertVersionPinRules(missing,[raw],[expected]));
  const moved=spec();moved.compiledUrlRewrites[0].rule=1;
  assert.throws(()=>assertVersionPinRules(moved,[raw,'body { color: red; }'],[expected,'body { color: red; }']));
  const dup=spec();dup.compiledUrlRewrites[0].urls.push(dup.compiledUrlRewrites[0].urls[0]);
  assert.throws(()=>assertVersionPinRules(dup,[raw],[expected]));
  const literal='.x::before { content: "url(\\\"/x/images.example.test/a.png\\\")"; }';
  assert.throws(()=>assertVersionPinRules(spec(legacy,direct,literal),[literal],[literal.replace('/x/','//')]));
  assert.throws(()=>assertVersionPinRules({...spec(),parsedRules:2},[raw],[expected]));
});
