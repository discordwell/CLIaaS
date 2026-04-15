import { test } from '@playwright/test';
test('guard scan debug — which infantry find targets', async ({browser}) => {
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
  await tp.evaluate(()=>{(globalThis as any).__debugGuardScan=true;(globalThis as any).__guardScanResults=[];(globalThis as any).__debugAreaGuard=true;(globalThis as any).__debugAreaGuardMiss=0});

  await tp.evaluate(()=>{(window as any).__agentStep?.(1)});
  const results = await tp.evaluate(()=>(globalThis as any).__guardScanResults as any[]);
  const agMiss = await tp.evaluate(()=>(globalThis as any).__debugAreaGuardMiss);

  const found = results.filter((r:any)=>r.found);
  const missed = results.filter((r:any)=>!r.found);
  console.log(`\nGUARD scan: ${found.length} found targets, ${missed.length} missed`);
  console.log(`AREA_GUARD scan: ${agMiss} missed (0 found per earlier test)`);
  console.log(`\nSample found targets:`);
  for (const r of found.slice(0,5)) console.log(`  ${r.type} at (${r.cx},${r.cy}) m=${r.mission} range=${r.range}`);
  console.log(`\nSample missed:`);
  for (const r of missed.slice(0,5)) console.log(`  ${r.type} at (${r.cx},${r.cy}) m=${r.mission} range=${r.range}`);

  await wCtx.close(); await tCtx.close();
});
