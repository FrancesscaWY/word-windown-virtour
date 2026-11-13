import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.VIRTOUR_PLAYWRIGHT_PATH ?? `${homedir()}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`).href);
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pois } from '../src/data/pois.js';
import { parkServices } from '../src/data/park-services.js';
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--enable-unsafe-swiftshader','--use-angle=swiftshader']});
const root=process.cwd();
const results=[];
try {
 for(const [width,height] of [[390,844],[360,640],[844,390],[1440,900]]) {
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
  await context.addInitScript(()=>{
   window.__utterances=[];
   window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;}};
   Object.defineProperty(window,'speechSynthesis',{value:{cancel(){},resume(){},getVoices(){return [{lang:'zh-CN'}];},speak(utterance){window.__utterances.push(utterance); setTimeout(()=>utterance.onstart?.(),0);}}});
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`${process.env.DEMO_URL || 'http://127.0.0.1:5174'}/tour.html`);await page.waitForSelector('.map-poi:not([hidden])');
  await page.waitForFunction(()=>document.querySelector('.map-base').naturalWidth>0);
  const layout=await page.evaluate(()=>{
   const map=document.querySelector('.map-art').getBoundingClientRect();const dock=document.querySelector('.voice-dock').getBoundingClientRect();const image=document.querySelector('.map-base');
   return {mapRatio:map.width/map.height,imageRatio:image.naturalWidth/image.naturalHeight,dockBottom:dock.bottom,overflow:document.documentElement.scrollWidth>innerWidth,visiblePins:document.querySelectorAll('.map-poi:not([hidden])').length};
  });
  console.log({width,height,...layout}); await page.screenshot({path:root+`/artifacts/refined-map-${width}.png`});
  assert.ok(Math.abs(layout.mapRatio-layout.imageRatio)<0.003,JSON.stringify(layout));assert.ok(layout.dockBottom<=height+1);assert.equal(layout.overflow,false);assert.ok(layout.visiblePins>0);
  const visibleAtHome=layout.visiblePins;
  await page.locator('[data-map-action="zoom-in"]').click();await page.locator('[data-map-action="zoom-in"]').click();
  assert.ok(await page.locator('.map-poi:not([hidden])').count()>=visibleAtHome);
  await page.locator('[data-map-action="reset"]').click();
  if(width===390 || width===844)await page.screenshot({path:root+`/artifacts/refined-overview-${width}.png`});
  const bounds = await page.locator('.map-art').boundingBox();
  const viewport = await page.locator('.map-viewport').boundingBox();
  for (const point of parkServices.boundary.rings.flat()) {
    const x=bounds.x+point.x/100*bounds.width; const y=bounds.y+point.y/100*bounds.height;
    assert.ok(x>=viewport.x && x<=viewport.x+viewport.width && y>=viewport.y && y<=viewport.y+viewport.height, 'whole park boundary fits at home');
  }
  const checkBubbles = async expected => {
    try { await page.waitForFunction(count => document.querySelectorAll('.map-bubble:not([hidden])').length === count, expected, {timeout:8000}); }
    catch(error) {
      await page.screenshot({path:root+`/artifacts/bubble-failure-${width}.png`});
      console.log(await page.evaluate(()=>[...document.querySelectorAll('.map-viewport, .map-art, .map-bubble, .map-facility, .map-controls, .facility-filters')].map(node=>({class:node.className,hidden:node.hidden,rect:node.getBoundingClientRect().toJSON()}))));
      throw error;
    }
    await page.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running' && a.effect?.target?.closest('.map-bubble')));
    const geometry = await page.evaluate(() => {
      const rect = node => {const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
      return {map:rect(document.querySelector('.map-viewport')),surface:rect(document.querySelector('.scene-surface')),canvas:rect(document.querySelector('.scene-canvas')),
        bubbles:[...document.querySelectorAll('.map-bubble:not([hidden])')].map(rect),
        controls:[...document.querySelectorAll('.map-controls, .catalog-trigger, .facility-filters, .map-caption')].map(rect)};
    });
    assert.equal(await page.locator('#facility-card').count(),0);
    assert.equal(geometry.surface.height,geometry.canvas.height,'facilities never shrink the scene surface');
    const overlaps=(a,b)=>a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
    for(const [index,bubble] of geometry.bubbles.entries()) {
      assert.ok(bubble.x>=geometry.map.x && bubble.y>=geometry.map.y && bubble.x+bubble.width<=geometry.map.x+geometry.map.width && bubble.y+bubble.height<=geometry.map.y+geometry.map.height,'bubble remains inside the map');
      for(const other of [...geometry.controls,...geometry.bubbles.slice(index+1)]) assert.equal(overlaps(bubble,other),false,'bubbles avoid controls and each other');
    }
    return geometry;
  };
  await page.locator('[data-facility-kind="toilets"]').click();
  await checkBubbles(1);
  assert.equal(await page.locator('.map-facility.highlighted:not([hidden])').count(),1);
  assert.match(await page.locator('.map-bubble').textContent(),/开放情况以现场为准/);
  await page.screenshot({path:root+`/artifacts/bubble-toilet-${width}.png`});
  const toilet=page.locator('.map-facility.highlighted');
  await toilet.click();
  assert.equal(await page.locator('.map-facility.selected').count(),1);
  await page.locator('[data-map-action="zoom-in"]').click();
  await checkBubbles(1);
  await page.locator('.map-viewport').focus();await page.keyboard.press('ArrowRight');
  await checkBubbles(1);
  if(width===390) {
    const scene=await page.locator('.map-viewport').boundingBox();
    const artBefore=await page.locator('.map-art').evaluate(node=>node.style.transform);
    await page.mouse.move(scene.x+scene.width/2,scene.y+scene.height-110);
    await page.mouse.down();await page.mouse.move(scene.x+scene.width/2+20,scene.y+scene.height-100,{steps:4});await page.mouse.up();
    assert.notEqual(await page.locator('.map-art').evaluate(node=>node.style.transform),artBefore);
    await checkBubbles(1);
  }
  await page.locator('#voice-input').fill('找出口');await page.locator('#voice-form').evaluate(f=>f.requestSubmit());
  await page.waitForFunction(()=>document.querySelector('.map-viewport').dataset.facilityView==='gate');
  await checkBubbles(2);
  assert.equal(await page.locator('.map-facility.highlighted:not([hidden])').count(),2);
  if(width===390) {
    await page.setViewportSize({width:844,height:390});await checkBubbles(2);
    await page.setViewportSize({width,height});await checkBubbles(2);
  }
  assert.match(await page.locator('#guide-caption').textContent(),/不能确认/);
  await page.screenshot({path:root+`/artifacts/bubble-gates-${width}.png`});
  await page.locator('.bubble-close').first().click();await checkBubbles(1);
  await page.locator('[data-facility-kind="service"]').click();
  await checkBubbles(1);
  assert.equal(await page.locator('.map-service-bubble a[href="tel:075526608000"]').count(),1);
  assert.equal(await page.locator('.map-facility:not([hidden])').count(),0);
  assert.match(await page.locator('.map-service-bubble').textContent(),/位置待核实/);
  await page.screenshot({path:root+`/artifacts/bubble-service-${width}.png`});
  await page.locator('.bubble-close').click();
  assert.equal(await page.locator('.map-bubble').count(),0);
  assert.equal(await page.locator('[data-facility-kind="service"]').evaluate(node=>node===document.activeElement),true);
  await page.locator('[data-facility-kind="toilets"]').click();await checkBubbles(1);
  await page.locator('.bubble-close').focus();await page.keyboard.press('Escape');
  assert.equal(await page.locator('.map-bubble').count(),0);
  await page.locator('[data-facility-kind="all"]').click();
  assert.equal(await page.locator('.map-zoom').textContent(),'100%');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('[data-facility-kind="gate"]').click();await checkBubbles(2);
  assert.equal(await page.locator('.facility-pin').evaluateAll(pins=>pins.flatMap(pin=>pin.getAnimations()).length),0);
  await page.locator('[data-facility-kind="all"]').click();
  await page.emulateMedia({reducedMotion:'no-preference'});
  results.push({width,facilityBubbles:true,stableMap:true,keyboardDismiss:true,reducedMotion:true});
  if(width===390) {
    await page.locator('[data-facility-kind="all"]').click();
    await page.locator('[data-poi="eiffel"]').click();
    await page.waitForSelector('#panorama-scene:not([hidden])');
    await page.waitForFunction(()=>document.querySelector('#panorama-canvas').getAttribute('aria-busy')==='false');
    assert.equal(await page.locator('#photo-scene').isVisible(),false);
    assert.match(await page.locator('.scene-disclaimer').textContent(),/示例全景/);
    await page.waitForFunction(()=>document.querySelector('#guide-presence').dataset.state==='speaking');
    assert.match(await page.locator('#guide-caption').textContent(),/原创插画/);
    const canvas=page.locator('#panorama-canvas');
    const initial=await canvas.screenshot();await canvas.focus();await page.keyboard.press('ArrowRight');
    const rotated=await canvas.screenshot();assert.ok(!initial.equals(rotated),'panorama should rotate');
    await page.locator('#panorama-zoom-in').click();await page.locator('#panorama-reset').click();
    await page.screenshot({path:root+'/artifacts/eiffel-demo-mobile.png'});
    await page.locator('#back-map').click();
    await page.locator('#voice-input').fill('介绍铁塔');await page.locator('#voice-form').evaluate(f=>f.requestSubmit());
    await page.waitForFunction(()=>!document.querySelector('#panorama-scene').hidden && document.querySelector('#panorama-canvas').getAttribute('aria-busy')==='false');
    await page.locator('#back-map').click();
    results.push({eiffelDemoClickAndVoice:true,rotation:true});
  }
  await page.locator('#open-catalog').click();assert.equal(await page.locator('[data-catalog-poi]').count(),pois.length);
  await page.locator('#catalog-search').fill('吴哥');assert.equal(await page.locator('[data-catalog-poi]').count(),1);
  await page.locator('[data-catalog-poi="angkor"]').click();await page.waitForSelector('#detail-panel:not([hidden])');
  assert.ok((await page.locator('#detail-content').textContent()).includes('360°'));
  await page.locator('#close-details').click();
  await page.locator('#voice-input').fill('我想看建筑');await page.locator('#voice-form').evaluate(f=>f.requestSubmit());
  await page.waitForFunction(()=>document.querySelector('[data-poi="colosseum"]').classList.contains('recommended'));
  if(await page.locator('#guide-suggestions button').first().isVisible()) await page.locator('#guide-suggestions button').first().click();
  else {await page.locator('#voice-input').fill('好的');await page.locator('#voice-form').evaluate(f=>f.requestSubmit());}
  await page.waitForSelector('#photo-scene:not([hidden]) #scene-photo:not([hidden])');
  await page.waitForFunction(()=>document.querySelector('#guide-presence').dataset.state==='speaking');
  assert.match(await page.locator('#place-title').textContent(),/罗马/);
  await page.evaluate(()=>{const u=window.__utterances.at(-1);u.onboundary?.({charIndex:u.text.indexOf('。')+1});});
  assert.equal(await page.locator('#scene-cue').isVisible(),true);
  assert.match(await page.locator('#scene-cue').textContent(),/拱券/);
  if(width===390) await page.screenshot({path:root+'/artifacts/proactive-photo-mobile.png'});
  await page.locator('#photo-details').click();await page.waitForSelector('.detail-content .is-narrated');assert.equal(await page.locator('.detail-content .is-narrated').count(),1);
  await page.locator('#close-details').click();await page.locator('#back-map').click();
  assert.deepEqual(errors,[]);results.push({width,height,...layout,errors});await context.close();
 }
 // A failed photo must stop speech; retry must use a fresh real load.
 const failureContext=await browser.newContext({viewport:{width:390,height:844}});
 const failure=await failureContext.newPage();let failPhoto=true;
 await failure.route('**/assets/photos/arc.jpg',route=>failPhoto?route.abort():route.continue());
 await failure.goto(`${process.env.DEMO_URL || 'http://127.0.0.1:5174'}/tour.html`);
 await failure.locator('#voice-input').fill('看看凯旋门');await failure.locator('#voice-form').evaluate(f=>f.requestSubmit());
 await failure.waitForSelector('#retry-photo:not([hidden])');assert.equal(await failure.locator('#scene-photo').isVisible(),false);
 failPhoto=false;await failure.locator('#retry-photo').click();await failure.waitForSelector('#scene-photo:not([hidden])');
 assert.equal(await failure.locator('#photo-status').isVisible(),false);await failureContext.close();
 results.push({photoFailureAndRetry:true});
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('file://'+root+'/dist/offline-preview.html');await page.waitForSelector('#open-catalog');
 await page.locator('#open-catalog').click();assert.equal(await page.locator('[data-catalog-poi]').count(),pois.length);assert.deepEqual(errors,[]);
 await page.locator('[data-catalog-poi="eiffel"]').click();
 await page.waitForFunction(()=>!document.querySelector('#panorama-scene').hidden && document.querySelector('#panorama-canvas').getAttribute('aria-busy')==='false');
 assert.match(await page.locator('.scene-disclaimer').textContent(),/示例全景/);
 assert.deepEqual(errors,[]);
 results.push({offline:true,eiffelDemo:true,errors});
 await writeFile(root+'/artifacts/map-bubbles-browser-check.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
} finally {await browser.close();}
