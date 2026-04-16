import { test } from '@playwright/test';
test('infantry #9 mission per tick (both engines)', async ({browser}) => {
  test.setTimeout(5*60*1000);
  const wCtx = await browser.newContext();
  const tCtx = await browser.newContext({viewport:{width:1200,height:800}});
  const wp = await wCtx.newPage();
  const tp = await tCtx.newPage();
  wp.on('dialog', async d => await d.accept());
  await Promise.all([
    wp.goto('https://cliaas.com/ra/original.html?scenario=SCG03EA.INI&autoplay=1&agentharness=1&seed=0',{waitUntil:'load'}),
    tp.goto('https://cliaas.com?anttest=agent&scenario=SCG03EA&difficulty=normal',{waitUntil:'load'}),
  ]);
  await Promise.all([
    wp.waitForFunction(()=>{try{const M=(window as any).Module;return M?.ccall&&JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length>0}catch{return false}},{timeout:180000,polling:2000}),
    tp.waitForFunction(()=>(window as any).__agentReady===true,{timeout:120000,polling:1000}),
  ]);
  const ws=await wp.evaluate(()=>{const M=(window as any).Module;return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState});
  await tp.evaluate((s:number)=>{(window as any).__syncRngSeed?.(s)},ws);

  // INF9: cell 7094 = (54,55). Find it by position in enemy list.
  for (let t = 1; t <= 15; t++) {
    await Promise.all([
      wp.evaluate(async()=>{const r=(window as any).__agentStep(1);if(r?.then)await r}),
      tp.evaluate(()=>{(window as any).__agentStep?.(1)}),
    ]);
    const [wMission, tMission] = await Promise.all([
      wp.evaluate(()=>{
        const M=(window as any).Module;const s=JSON.parse(M.ccall('agent_get_state','string',[],[]));
        const e = [...(s.enemies||[])].find((e:any)=>e.cx===54&&e.cy===55);
        return e ? e.m : 'not found';
      }),
      tp.evaluate(()=>{
        const s=(window as any).__agentState();
        const e = [...(s.enemies||[])].find((e:any)=>e.cx===54&&e.cy===55);
        return e ? e.m : 'not found';
      }),
    ]);
    // C++ mission numbers: 5=GUARD, 10=GUARD_AREA, 14=HUNT
    if (t >= 1 && t <= 12) {
      console.log(`tick ${t}: WASM=${wMission} TS=${tMission}`);
    }
  }
  await wCtx.close(); await tCtx.close();
});
