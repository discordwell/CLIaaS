import { test } from '@playwright/test';
test('track missionTimer for entity[11] via console intercept', async ({browser}) => {
  test.setTimeout(5*60*1000);
  const wCtx = await browser.newContext();
  const tCtx = await browser.newContext({viewport:{width:1200,height:800}});
  const wp = await wCtx.newPage();
  const tp = await tCtx.newPage();
  wp.on('dialog', async d => await d.accept());

  // Capture TS console logs
  const logs: string[] = [];
  tp.on('console', msg => { if (msg.text().startsWith('[TRK]')) logs.push(msg.text()); });

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

  // Inject tracking: override entity[11].missionTimer setter
  await tp.evaluate(()=>{
    const game = (window as any).__game ?? (window as any).__agentGame;
    if (!game?.entities?.[11]) { console.log('[TRK] entity[11] not found'); return; }
    const e = game.entities[11];
    let _timer = e.missionTimer;
    Object.defineProperty(e, 'missionTimer', {
      get() { return _timer; },
      set(v: number) {
        if (v !== _timer) {
          console.log(`[TRK] tick=${game.tick} missionTimer: ${_timer} → ${v} mission=${e.mission} q=${e.missionQueue}`);
        }
        _timer = v;
      }
    });
    console.log(`[TRK] tracking entity[11] type=${e.type} initial timer=${_timer} mission=${e.mission}`);
  });

  // Step 6 ticks
  for (let t = 1; t <= 6; t++) {
    await tp.evaluate(()=>{(window as any).__agentStep?.(1)});
  }

  // Wait for logs
  await tp.evaluate(()=>new Promise(r=>setTimeout(r,100)));
  for (const l of logs) console.log(l);
  await wCtx.close(); await tCtx.close();
});
