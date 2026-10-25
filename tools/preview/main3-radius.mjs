import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {OWNED_IMPORTS,ownedImportRevision,extractLocal,planFoundation} from './css.mjs';

export const MAIN3_SPEC=OWNED_IMPORTS.find(row=>row.local==='css/base/main_code_3.css');
export const MAIN3_RELEASE=JSON.parse(readFileSync(new URL('../../css/main3-optimization.json',import.meta.url),'utf8'));
export function radiusReleaseRevision(spec=MAIN3_RELEASE){
  ownedImportRevision(MAIN3_SPEC);
  const match=/^https:\/\/raw\.githubusercontent\.com\/SadLaboka\/shikimori\/([a-f0-9]{40})\/css\/base\/main_code_3\.css$/.exec(spec.target);
  if(!match||spec.source!==MAIN3_SPEC.target||spec.sha256!=='934345f04217e7e01252d5a36bea6430f0a328dd230ab8acf2559fd087a87053')
    throw new Error('Unapproved main3 release.');
  return match[1];
}
export function planRadiusRelease(local,published,foundation){
  radiusReleaseRevision();
  const a=extractLocal(local),b=extractLocal(published);
  if(JSON.stringify(a.imports)===JSON.stringify(b.imports))return planFoundation(local,published,foundation);
  if(b.imports.filter(url=>url===MAIN3_RELEASE.source).length!==1||a.user!==b.user||
      JSON.stringify(a.imports)!==JSON.stringify(b.imports.map(url=>url===MAIN3_RELEASE.source?MAIN3_RELEASE.target:url)))
    throw new Error('Main3 release permits only its approved URL change.');
  planFoundation(published,published,foundation);
  const next=applyRadiusCandidate(foundation);
  const marker=[...next.matchAll(/\/\*\s*(https?:[^*]+?)\s*\*\//g)].find(m=>m[1]===MAIN3_RELEASE.source);
  return {foundation:next.replace(marker[0],marker[0].replace(MAIN3_RELEASE.source,MAIN3_RELEASE.target)),migration:null,radiusRelease:true};
}
export const RADIUS_BEFORE=`.l-page {
    min-height: 50px;
    margin: 0px auto 25px;
    position: relative;
    border-radius: 0px;
}`;
export const RADIUS_AFTER=RADIUS_BEFORE.replace('    border-radius: 0px;\n','');
const hash=value=>createHash('sha256').update(value).digest('hex');
function replaceOnce(text){
  if(text.split(RADIUS_BEFORE).length!==2)throw new Error('Expected one exact main3 radius block.');
  return text.replace(RADIUS_BEFORE,RADIUS_AFTER);
}
export function verifyRadiusCandidate(snapshot,candidate){
  ownedImportRevision(MAIN3_SPEC);
  if(hash(snapshot)!==MAIN3_SPEC.sha256)throw new Error('Main3 baseline hash differs.');
  if(!Buffer.from(replaceOnce(snapshot.toString('utf8'))).equals(Buffer.from(candidate)))
    throw new Error('Main3 permits only the early radius declaration removal.');
  return {baselineHash:hash(snapshot),candidateHash:hash(candidate),removedBytes:snapshot.length-candidate.length};
}
export function applyRadiusCandidate(foundation){
  const markers=[...foundation.matchAll(/\/\*\s*(https?:[^*]+?)\s*\*\//g)];
  const matches=markers.filter(m=>m[1]===MAIN3_SPEC.target);
  if(matches.length!==1)throw new Error('Main3 source marker must be unique.');
  const marker=matches[0],i=markers.indexOf(marker),end=markers[i+1]?.index??foundation.length;
  return foundation.slice(0,marker.index)+replaceOnce(foundation.slice(marker.index,end))+foundation.slice(end);
}
export function verifyRadiusDelta(before,after,oldRule,newRule){
  if(oldRule.length!==1||newRule.length!==1)throw new Error('Radius change must remain one rule.');
  const indices=before.flatMap((r,i)=>r===oldRule[0]?[i]:[]);
  if(indices.length!==1||JSON.stringify(before.map((r,i)=>i===indices[0]?newRule[0]:r))!==JSON.stringify(after))
    throw new Error('CSSOM differs outside the approved radius declaration.');
  return {onlyApprovedChange:true,ruleIndex:indices[0],rulesBefore:before.length,rulesAfter:after.length};
}

// Run in the page. Compare computed 'auto', not Blink's unstable resolved-pixel
// cache. Actual used placement remains independently covered by the page rect.
export function sampleRadiusMargins(el){
  const cs=getComputedStyle(el),computed={},resolved={};
  for(const key of ['margin-left','margin-right']){
    resolved[key]=cs.getPropertyValue(key);
    const typed=el.computedStyleMap?.().get(key);
    computed[key]=typed?.toString()==='auto'?'auto':resolved[key];
  }
  return {computed,resolved};
}
