import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { createProxy } from '../server/proxy.ts';
import { executeTool } from '../server/ai/tools.ts';
import { routePath } from '../src/components/planned-route.js';
import { artworkRoads } from '../src/data/artwork-roads.js';

const { chromium } = await import(pathToFileURL(process.env.VIRTOUR_PLAYWRIGHT_PATH ?? `${homedir()}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs`).href);
const { proxy } = await createProxy();
let browser;
try {
  const origin = await proxy.listen({port:0,host:'127.0.0.1'});
  browser = await chromium.launch({...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH}:{}),args:['--no-sandbox','--enable-unsafe-swiftshader']});
  await mkdir('agent-tmp/road-network',{recursive:true});
  const route = executeTool('plan_route',{title:'手绘路网验证',summary:'检验图层坐标一致性',stops:['colosseum','arc','eiffel'].map(poi_id=>({poi_id,reason:'检查手绘道路'}))}).route;
  for(const [label,viewport] of [['mobile',{width:390,height:844}],['desktop',{width:1280,height:900}]]){
    const context=await browser.newContext({viewport,reducedMotion:'reduce'});
    const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${origin}/tour.html?mode=interactive`,{waitUntil:'domcontentloaded'});
    const button=page.locator('[data-map-action="roads"]'), layer=page.locator('.map-road-network');
    await button.waitFor();
    assert.equal(await button.getAttribute('aria-pressed'),'true');
    assert.equal(await layer.isVisible(),true);
    assert.equal(await layer.evaluate(n=>getComputedStyle(n).pointerEvents),'none');
    assert.equal(await layer.locator('[data-road-id]').count(),artworkRoads.roads.length);
    assert.equal(await layer.getAttribute('data-source'),'artwork-traced');
    assert.equal(await layer.locator('[data-osm-way]').count(),0);
    await page.screenshot({path:`agent-tmp/road-network/${label}-on.png`});
    await button.click();
    assert.equal(await layer.isVisible(),false);
    assert.equal(await button.getAttribute('aria-label'),'显示路网');
    await page.screenshot({path:`agent-tmp/road-network/${label}-off.png`});
    await page.reload({waitUntil:'domcontentloaded'});await button.waitFor();
    assert.equal(await button.getAttribute('aria-pressed'),'false','visibility preference survives reload');
    await button.focus();await page.keyboard.press('Enter');
    assert.equal(await layer.isVisible(),true,'keyboard toggles the network');
    for(let i=0;i<4;i++) await page.locator('[data-map-action="zoom-in"]').click();
    const geometry=await page.locator('.map-art').evaluate(art=>{
      const base=art.querySelector('.map-base').getBoundingClientRect(),roads=art.querySelector('.map-road-network').getBoundingClientRect();
      const marker=art.querySelector('[data-poi="eiffel"]');
      return {dx:base.x-roads.x,dy:base.y-roads.y,dw:base.width-roads.width,dh:base.height-roads.height,x:parseFloat(marker.style.getPropertyValue('--x')),y:parseFloat(marker.style.getPropertyValue('--y'))};
    });
    for(const k of ['dx','dy','dw','dh']) assert.ok(Math.abs(geometry[k])<.01);
    assert.ok(Math.abs(geometry.x*1339/100-785)<.01&&Math.abs(geometry.y*1174/100-672)<.01);
    await page.evaluate(async route=>{const {store}=await import('/src/guide/store.js');store.set({plannedRoute:route,view:'map'});},route);
    await page.waitForFunction(full=>document.querySelector('.planned-route-line path:not(.route-line-halo)')?.getAttribute('d')===full,routePath(route));
    await page.screenshot({path:`agent-tmp/road-network/${label}-route.png`});
    await button.click();
    assert.equal(await layer.isVisible(),false);
    assert.equal(await page.locator('.planned-route-line').isVisible(),true,'hiding the road network must retain the planned route');
    await page.locator('[data-route-action="clear"]').click();
    assert.equal(await layer.isVisible(),false,'clearing a route must retain the network preference');
    assert.deepEqual(errors,[]);
    await context.close();
    console.log(`PASS ${label}: hand-traced roads and registered pins, zoom alignment, on/off, keyboard, persistence and independent planned route.`);
  }
}finally{await browser?.close();await proxy.close();}
