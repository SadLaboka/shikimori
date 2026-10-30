// Runs actual Firefox chrome tabs, unlike Playwright's synthetic tabs.
import { firefox } from '../tools/preview/node_modules/playwright/index.mjs';
import { mkdtemp,mkdir,writeFile,readFile,cp } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { connectBidi,freePort,delay } from './helpers/firefox-remote.mjs';
const sourceOption=process.argv.find(value=>value.startsWith('--extension-source='))?.slice('--extension-source='.length);
const sourceDirectory=sourceOption?path.resolve(sourceOption):fileURLToPath(new URL('../extensions/firefox/',import.meta.url));
const {ACCOUNT,schemeCss}=await import(pathToFileURL(path.join(sourceDirectory,'catalog.mjs')).href);
const output=new URL('../.preview/firefox-extension/',import.meta.url);await mkdir(output,{recursive:true});
const performanceLabel=process.argv.find(value=>value.startsWith('--performance-label='))?.split('=')[1];
if(performanceLabel&&!/^[a-z0-9-]+$/.test(performanceLabel))throw Error('Invalid performance label');
const apiDelayMs=performanceLabel?100:0;
const timings={mockApiDelayMs:apiDelayMs};
const measurementStart=performance.now();
const profile=await mkdtemp(fileURLToPath(new URL('native-profile-',output)));
const bidiPort=await freePort();
const addonId='shikimori-schemes@sadlaboka.local',uuid='7a7bd21c-308b-449d-a683-fb19359c0c28';
const testRuntime=await mkdtemp(fileURLToPath(new URL('native-runtime-',output)));
await cp(sourceDirectory,testRuntime,{recursive:true});
const manifest=JSON.parse(await readFile(`${testRuntime}/manifest.json`,'utf8'));
manifest.background.scripts=['test-harness.mjs'];
await writeFile(`${testRuntime}/manifest.json`,JSON.stringify(manifest));
// Open the unmodified production popup through Firefox's own extension API.
// WebDriver intentionally forbids direct navigation to moz-extension URLs.
await writeFile(`${testRuntime}/test-harness.mjs`,"import './background.mjs';\nlet popupId,opening=false;async function open(){if(popupId!==undefined||opening)return;opening=true;try{popupId=(await browser.tabs.create({url:browser.runtime.getURL('popup.html')})).id;}finally{opening=false;}}\nbrowser.tabs.onRemoved.addListener(id=>{if(id===popupId)popupId=undefined;});\nbrowser.tabs.onUpdated.addListener((id,change,tab)=>{if(change.status==='complete'&&tab.url==='https://shikimori.io/SadLaboka')open();});\nbrowser.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.pending?.oldValue&&!changes.pending.newValue)open();});\n");
const prefs={'devtools.debugger.remote-enabled':true,'devtools.debugger.prompt-connection':false,'devtools.debugger.force-local':true,
  'extensions.webextensions.uuids':JSON.stringify({[addonId]:uuid}),'browser.shell.checkDefaultBrowser':false,
  'browser.startup.homepage':'about:blank','browser.startup.page':0,'browser.newtabpage.enabled':false,
  'browser.aboutwelcome.enabled':false,'browser.startup.homepage_override.mstone':'ignore','startup.homepage_welcome_url':'',
  'toolkit.cosmeticAnimations.enabled':false,'browser.tabs.animate':false,
  'datareporting.policy.dataSubmissionEnabled':false,'toolkit.telemetry.enabled':false,'network.captive-portal-service.enabled':false};
await writeFile(`${profile}/user.js`,Object.entries(prefs).map(([key,value])=>`user_pref(${JSON.stringify(key)},${JSON.stringify(value)});`).join('\n'));
const systemFirefox='C:/Program Files/Mozilla Firefox/firefox.exe';
const executable=process.env.SHIKIMORI_TEST_FIREFOX??(existsSync(systemFirefox)?systemFirefox:firefox.executablePath());
const child=spawn(executable,['-headless','-no-remote','--allow-system-access','-profile',profile,'--remote-debugging-port',String(bidiPort)],{windowsHide:true,stdio:'ignore',env:{...process.env,MOZ_REMOTE_ALLOW_SYSTEM_ACCESS:'1'}});
let bidi;const networkErrors=[];
try{
  bidi=await connectBidi(bidiPort);
  const session=await bidi.command('session.new',{capabilities:{alwaysMatch:{acceptInsecureCerts:true}}});
  console.log(JSON.stringify({stage:'native-session',browser:session.capabilities.browserVersion}));
  const tree=await bidi.command('browsingContext.getTree');
  console.log(JSON.stringify({stage:'contexts',contexts:tree.contexts.map(item=>({context:item.context,url:item.url}))}));
  const shiki=tree.contexts[0]?.context??(await bidi.command('browsingContext.create',{type:'tab'})).context;
  let css=schemeCss('main'),revision=1,patches=0,userId=ACCOUNT.userId;
  const requests=[];
  await bidi.command('session.subscribe',{events:['network.beforeRequestSent']});
  await bidi.command('network.addIntercept',{phases:['beforeRequestSent'],urlPatterns:[{type:'pattern',protocol:'https'}]});
  // Intercept all HTTPS traffic before any Shikimori page is opened.
  bidi.on('network.beforeRequestSent',event=>{
    if(!event.isBlocked)return;
    (async()=>{
      const request=event.request,url=new URL(request.url);
      const requestHeaders=Object.fromEntries(request.headers.map(header=>[header.name.toLowerCase(),header.value.value]));
      const json=value=>({type:'string',value:JSON.stringify(value)});
      let body,statusCode=200,contentType='application/json';
      if(url.origin!=='https://shikimori.io'){statusCode=404;body={type:'string',value:''};}
      else{
        requests.push({method:request.method,path:url.pathname,atMs:Math.round(performance.now()-measurementStart),
          conditional:!!requestHeaders['if-none-match'],cookieNames:(request.cookies??[]).map(cookie=>cookie.name)});
        if(apiDelayMs&&url.pathname.startsWith('/api/'))await delay(apiDelayMs);
        if(url.pathname==='/api/users/whoami')body=json({id:userId,nickname:'SadLaboka'});
        else if(url.pathname===`/api/styles/${ACCOUNT.styleId}`){
          if(request.method==='PATCH'){
            assert.equal(requestHeaders['x-csrf-token'],'synthetic-csrf-test-only');
            assert.ok(requestHeaders.cookie?.includes('synthetic_session=test-only')||request.cookies?.some(cookie=>cookie.name==='synthetic_session'));
            // Payload bytes are separately asserted in the production bridge's
            // unit test; verification GET must match the chosen scheme hash.
            css=schemeCss(patches%2===1?'main':'emerald-scarlet');patches++;revision++;
          }
          body=json({id:ACCOUNT.styleId,owner_id:ACCOUNT.userId,owner_type:'User',css,compiled_css:'body{color:white}',updated_at:`v${revision}`,failed_imports:[]});
        }else{
          const scheme=css===schemeCss('main')?'main':'emerald-scarlet';
          contentType='text/html; charset=utf-8';body={type:'string',value:`<!doctype html><html><head><meta name="csrf-token" content="synthetic-csrf-test-only"><title>Isolated Shikimori session</title><style>.avatar{position:relative;width:160px;height:160px}.avatar::before{content:"";position:absolute;inset:0;width:160px;height:160px;border-radius:50%;background-image:linear-gradient(blue,red)}.avatar img{width:160px;height:160px;opacity:0}</style></head><body class="p-profiles" data-scheme="${scheme}"><div class="profile-head"><div class="c-brief"><div class="avatar"><img alt="SadLaboka"></div></div></div><h1>Test session</h1></body></html>`};
        }
      }
      const responseHeaders=[{name:'Content-Type',value:{type:'string',value:contentType}}];
      if(url.pathname===`/api/styles/${ACCOUNT.styleId}`&&request.method==='GET'){
        const etag=`W/"synthetic-style-${revision}"`;
        responseHeaders.push({name:'ETag',value:{type:'string',value:etag}},
          {name:'Cache-Control',value:{type:'string',value:'max-age=0, private, must-revalidate'}});
        if(requestHeaders['if-none-match']===etag){statusCode=304;body=undefined;}
      }
      if(url.origin==='https://shikimori.io'){
        const row=requests.findLast(item=>item.method===request.method&&item.path===url.pathname&&item.responseStatus===undefined);
        if(row)row.responseStatus=statusCode;
      }
      await bidi.command('network.provideResponse',{request:request.request,statusCode,headers:responseHeaders,...(body?{body}:{})});
    })().catch(error=>networkErrors.push(error.message));
  });
  const installed=await bidi.command('webExtension.install',{extensionData:{type:'path',path:testRuntime},'moz:permanent':false});
  assert.equal(installed.extension,addonId);
  console.log(JSON.stringify({stage:'installed',extension:installed.extension}));
  const openStart=performance.now();
  await bidi.command('browsingContext.navigate',{context:shiki,url:'https://shikimori.io/SadLaboka',wait:'complete'});
  await bidi.command('storage.setCookie',{cookie:{name:'synthetic_session',value:{type:'string',value:'test-only'},domain:'shikimori.io',path:'/',secure:true,httpOnly:false,sameSite:'lax'},partition:{type:'context',context:shiki}});
  const jar=await bidi.command('storage.getCookies',{filter:{name:'synthetic_session'},partition:{type:'context',context:shiki}});
  assert.equal(jar.cookies.length,1);
  const evaluate=async(context,expression)=>{
    const result=await bidi.command('script.evaluate',{target:{context},expression,awaitPromise:true,userActivation:true});
    if(result.type!=='success')throw Error('Browser script failed: '+result.exceptionDetails?.text);
    return result.result.value;
  };
  assert.ok((await evaluate(shiki,'document.cookie')).includes('synthetic_session=test-only'));
  const wait=async(context,expression)=>{for(let i=0;i<200;i++){if(networkErrors.length)throw Error(networkErrors.join('; '));if(await evaluate(context,expression))return;await delay(100);}throw Error('UI wait timed out: '+expression+'; requests='+JSON.stringify(requests));};
  const openPopup=async()=>{
    let context;
    for(let i=0;i<200&&!context;i++){
      const tree=await bidi.command('browsingContext.getTree');
      context=tree.contexts.find(item=>item.url===`moz-extension://${uuid}/popup.html`)?.context;
      if(!context)await delay(100);
    }
    if(!context)throw Error('Extension did not open its popup');
    await wait(context,"document.querySelector('#current')?.textContent.includes('Сейчас:')");return context;
  };
  const screenshot=async(context,name)=>{
    const {data}=await bidi.command('browsingContext.captureScreenshot',{context,clip:{type:'box',x:0,y:0,width:380,height:580}});
    await writeFile(new URL(name,output),Buffer.from(data,'base64'));
  };
  let popup=await openPopup();
  timings.openMenuMs=Math.round(performance.now()-openStart);
  assert.match(await evaluate(popup,"document.querySelector('#current').textContent"),/Основная/);
  await evaluate(popup,"document.querySelector('#reload').click()");
  await wait(popup,"browser.storage.local.get('reloadAfter').then(s=>s.reloadAfter===false)");
  await screenshot(popup,'popup-main.png');
  await evaluate(popup,"window.testStages=[];new MutationObserver(()=>window.testStages.push(document.querySelector('#status').textContent)).observe(document.querySelector('#status'),{childList:true,subtree:true,characterData:true})");
  const switchStart=performance.now();
  await evaluate(popup,"document.querySelector('[data-scheme=\"emerald-scarlet\"] button').click()");
  await wait(popup,"document.querySelector('#status').textContent==='Оформление сохранено.'");
  assert.equal(css,schemeCss('emerald-scarlet'));assert.equal(patches,1);
  timings.switchMs=Math.round(performance.now()-switchStart);
  const stages=await evaluate(popup,'JSON.stringify(window.testStages)');
  assert.ok(stages.includes('Публикуем схему…')&&stages.includes('Проверяем сохранение…'));
  await screenshot(popup,'popup-applied.png');
  const restoreStart=performance.now();
  await evaluate(popup,"document.querySelector('#restore').click()");
  await wait(popup,"document.querySelector('#current').textContent.includes('Основная')");
  assert.equal(css,schemeCss('main'));assert.equal(patches,2);
  timings.restoreMs=Math.round(performance.now()-restoreStart);
  await evaluate(popup,"document.querySelector('[data-scheme=\"emerald-scarlet\"] button').click()");
  await bidi.command('browsingContext.close',{context:popup});
  for(let i=0;i<200&&patches<3;i++){if(networkErrors.length)throw Error(networkErrors.join('; '));await delay(100);}
  assert.equal(patches,3,'Popup closure interrupted publication');
  popup=await openPopup();await wait(popup,"document.querySelector('#restore').disabled===false");
  assert.equal(await evaluate(popup,"document.querySelector('#reload').checked"),false);
  // The active Shikimori tab must reload only after verified publication.
  await evaluate(popup,"document.querySelector('#reload').click()");
  await wait(popup,"browser.storage.local.get('reloadAfter').then(s=>s.reloadAfter===true)");
  await bidi.command('browsingContext.activate',{context:shiki});
  await bidi.command('session.subscribe',{events:['browsingContext.load']});
  let reloaded,lastLoadAt=0;
  const loaded=new Promise(resolve=>{reloaded=resolve;});
  bidi.on('browsingContext.load',event=>{if(event.context===shiki){lastLoadAt=performance.now();reloaded();}});
  // Compare the two entry points with the same empty second-window budget.
  if(performanceLabel)await delay(1250);
  const popupReloadStart=performance.now();
  await evaluate(popup,"document.querySelector('[data-scheme=\"main\"] button').click()");
  let reloadTimeout;
  try{await Promise.race([loaded,new Promise((_,reject)=>{reloadTimeout=setTimeout(()=>reject(Error('Expected active tab reload')),10000);})]);}
  finally{clearTimeout(reloadTimeout);}
  timings.popupReloadMs=Math.round(lastLoadAt-popupReloadStart);
  assert.equal(await evaluate(shiki,'document.body.dataset.scheme'),'main');
  await wait(popup,"document.querySelector('#current').textContent.includes('Основная')");
  assert.equal(patches,4);
  // The real content script must accept actual user input, not page-generated
  // click events. The active-tab reload exercises a fresh content-script world.
  const clickAvatar=async(repeat=1,measure=false)=>{
    await bidi.command('browsingContext.activate',{context:shiki});
    await wait(shiki,"document.querySelector('.avatar')?.getAttribute('role')==='button'");
    const actions=[{type:'pointerMove',x:88,y:88,duration:0,origin:'viewport'}];
    for(let i=0;i<repeat;i++)actions.push({type:'pointerDown',button:0},{type:'pointerUp',button:0});
    if(measure)timings.avatarInputAt=performance.now();
    await bidi.command('input.performActions',{context:shiki,actions:[{type:'pointer',id:'avatar-mouse',parameters:{pointerType:'mouse'},actions}]});
  };
  await evaluate(shiki,"document.querySelector('.avatar').click()");await delay(100);
  assert.equal(patches,4,'A synthetic page click must not publish');
  if(performanceLabel)await delay(1250);
  const priorLoad=lastLoadAt;
  await clickAvatar(2,true);
  await wait(shiki,"document.body.dataset.scheme==='emerald-scarlet'");
  for(let i=0;i<200&&lastLoadAt===priorLoad;i++)await delay(100);
  assert.ok(lastLoadAt>priorLoad);
  timings.avatarReloadMs=Math.round(lastLoadAt-timings.avatarInputAt);delete timings.avatarInputAt;
  assert.equal(css,schemeCss('emerald-scarlet'));assert.equal(patches,5,'A double click must cause only one PATCH');
  await clickAvatar();await wait(shiki,"document.body.dataset.scheme==='main'");
  assert.equal(css,schemeCss('main'));assert.equal(patches,6);
  css='body{color:orange}';const unknownStarted=requests.length;
  await clickAvatar();
  await wait(shiki,"[...document.querySelectorAll('[role=status]')].some(el=>el.textContent.includes('не распознан'))");
  assert.equal(patches,6);assert.ok(requests.length>unknownStarted);
  css=schemeCss('main');userId=1;
  await clickAvatar();
  await wait(shiki,"[...document.querySelectorAll('[role=status]')].some(el=>el.textContent.includes('нужен аккаунт SadLaboka'))");
  assert.equal(patches,6);
  userId=1;await evaluate(popup,"document.querySelector('#refresh').click()");
  await wait(popup,"document.querySelector('#status').textContent.includes('нужен аккаунт SadLaboka')");
  assert.equal(await evaluate(popup,"document.querySelector('[data-scheme=\"main\"] button').disabled"),true);assert.equal(patches,6);
  await bidi.command('browsingContext.close',{context:shiki});
  await evaluate(popup,"document.querySelector('#refresh').click()");
  await wait(popup,"document.querySelector('#status').textContent.includes('Открой Shikimori')");
  await screenshot(popup,'popup-no-tab.png');
  const report={browser:session.capabilities.browserVersion,extensionVersion:manifest.version,installed:true,sessionAndCsrfVerified:true,switch:true,restore:true,popupClosure:true,settingsPersisted:true,progressStagesVerified:true,activeTabReloadVerified:true,avatarCyclesBothDirections:true,avatarDoubleClickGuard:true,avatarSyntheticClickBlocked:true,avatarUnknownCssBlocked:true,avatarWrongUserBlocked:true,wrongAccountBlocked:true,missingTabHandled:true,patches,timings,requests};
  if(performanceLabel){await mkdir(new URL('performance/',output),{recursive:true});await writeFile(new URL(`performance/${performanceLabel}.json`,output),JSON.stringify(report,null,2));}
  await writeFile(new URL('browser-results.json',output),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,requests:requests.length}));
}finally{
  if(bidi){try{await bidi.command('browser.close');}catch{}bidi.close();}child.kill();
}
