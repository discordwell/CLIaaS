import { test } from '@playwright/test';
const BASE_URL = 'https://cliaas.com';

test(`SCG08 tick 92-96 seeds`, async ({ browser }) => {
  test.setTimeout(10*60*1000);
  const wc = await browser.newContext(); const tc = await browser.newContext({viewport:{width:1200,height:800}});
  const wp = await wc.newPage(); const tp = await tc.newPage();
  wp.on('dialog', async d => { await d.accept(); });
  await Promise.all([
    wp.goto(`${BASE_URL}/ra/original.html?scenario=SCG08EA.INI&autoplay=1&agentharness=1&seed=0`,{waitUntil:'load'}),
    tp.goto(`${BASE_URL}?anttest=agent&scenario=SCG08EA&difficulty=normal`,{waitUntil:'load'}),
  ]);
  await Promise.all([
    wp.waitForFunction(()=>{try{const M=(window as any).Module;return M?.ccall&&JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length>0;}catch{return false;}},{timeout:180000,polling:2000}),
    tp.waitForFunction(()=>(window as any).__agentReady===true,{timeout:120000,polling:1000}),
  ]);
  const seed = await wp.evaluate(()=>{const M=(window as any).Module;return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState;});
  await tp.evaluate((s:number)=>{(window as any).__syncRngSeed?.(s);},seed);

  for (let t = 1; t <= 100; t++) {
    await Promise.all([
      wp.evaluate(async()=>{const r=(window as any).__agentStep(1);if(r?.then)await r;}),
      tp.evaluate(()=>{(window as any).__agentStep?.(1);}),
    ]);
    const [ws,ts] = await Promise.all([
      wp.evaluate(()=>{const M=(window as any).Module;return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState>>>0;}),
      tp.evaluate(()=>(window as any).__agentState().rngState>>>0),
    ]);
    if (t >= 88 && t <= 100) {
      console.log(`t=${t}: W=${ws.toString(16)} T=${ts.toString(16)} ${ws===ts?'✓':'✗'}`);
    }
  }
  await wc.close(); await tc.close();
});
