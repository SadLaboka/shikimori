import {createHash} from 'node:crypto';
import {OWNED_IMPORTS,ownedImportRevision} from './css.mjs';

export const MAIN1_SPEC=OWNED_IMPORTS.find(row=>row.local==='css/base/main_code_1.css');
export {DUPLICATE_BUTTON_BLOCK} from "./main1-button-change.mjs";
import {DUPLICATE_BUTTON_BLOCK} from "./main1-button-change.mjs";
const sha=value=>createHash('sha256').update(value).digest('hex');
function removeOnce(text){
  if(text.split(DUPLICATE_BUTTON_BLOCK).length!==2)throw new Error('Expected exactly one approved duplicate button block.');
  return text.replace(DUPLICATE_BUTTON_BLOCK,'');
}

// Deliberately one operation, not an allow-all route around owned-import hashes.
export function verifyMain1ButtonCandidate(snapshot,candidate){
  ownedImportRevision(MAIN1_SPEC);
  if(sha(snapshot)!==MAIN1_SPEC.sha256)throw new Error('Main1 pilot baseline snapshot hash differs.');
  const expected=removeOnce(snapshot.toString('utf8'));
  if(!Buffer.from(expected,'utf8').equals(Buffer.from(candidate)))
    throw new Error('Main1 pilot permits only the exact duplicate-block removal.');
  return {source:MAIN1_SPEC.target,baselineHash:sha(snapshot),candidateHash:sha(candidate),
    removedBlockHash:sha(DUPLICATE_BUTTON_BLOCK),removedBytes:Buffer.byteLength(DUPLICATE_BUTTON_BLOCK),
    candidateRemoteVerified:false};
}

export function applyMain1ButtonCandidate(foundation){
  const markers=[...foundation.matchAll(/\/\*\s*(https?:[^*]+?)\s*\*\//g)];
  const matching=markers.filter(m=>m[1]===MAIN1_SPEC.target);
  if(matching.length!==1)throw new Error('Main1 pilot requires one published source marker.');
  const marker=matching[0],index=markers.indexOf(marker),end=markers[index+1]?.index??foundation.length;
  const block=foundation.slice(marker.index,end),replacement=removeOnce(block);
  return foundation.slice(0,marker.index)+replacement+foundation.slice(end);
}

export function verifyMain1ButtonCssomDelta(before,after,removedRules){
  if(removedRules.length!==1)throw new Error('Pilot removal must parse as one CSSOM rule.');
  const indices=before.flatMap((rule,i)=>rule===removedRules[0]?[i]:[]);
  if(indices.length!==1||JSON.stringify(before.filter((_,i)=>i!==indices[0]))!==JSON.stringify(after))
    throw new Error('Compiled CSSOM changed outside the approved duplicate rule.');
  return {onlyApprovedRemoval:true,removedGlobalRuleIndex:indices[0],rulesBefore:before.length,rulesAfter:after.length};
}
