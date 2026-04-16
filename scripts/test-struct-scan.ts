import { test } from '@playwright/test';
test('infantry #9 and target state ticks 10-25', async ({browser}) => {
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
  // Step to tick 24, then check state
  await Promise.all([
    wp.evaluate(async()=>{const r=(window as any).__agentStep(24);if(r?.then)await r}),
    tp.evaluate(()=>{(window as any).__agentStep?.(24)}),
  ]);
  // Check infantry #9 (cell 7094 = 54,55) and E7 (cell 6461 = 45,50)
  const [wData, tData] = await Promise.all([
    wp.evaluate(()=>{
      const M=(window as any).Module;const s=JSON.parse(M.ccall('agent_get_state','string',[],[]));
      const allEnts = [...(s.enemies||[]),...(s.units||[])];
      const inf9 = allEnts.find((e:any)=>e.t==='E1'&&Math.abs(e.cx-54)<=3&&Math.abs(e.cy-55)<=3);
      const e7 = allEnts.find((e:any)=>e.t==='E7');
      return {tick:s.tick, inf9:inf9?{cx:inf9.cx,cy:inf9.cy,m:inf9.m,hp:inf9.hp}:'gone', e7:e7?{cx:e7.cx,cy:e7.cy,hp:e7.hp}:'gone'};
    }),
    tp.evaluate(()=>{
      const s=(window as any).__agentState();
      const allEnts = [...(s.enemies||[]),...(s.units||[])];
      const inf9 = allEnts.find((e:any)=>(e.t||e.type)==='E1'&&Math.abs(e.cx-54)<=3&&Math.abs(e.cy-55)<=3);
      const e7 = allEnts.find((e:any)=>(e.t||e.type)==='E7');
      return {tick:s.tick, inf9:inf9?{cx:inf9.cx,cy:inf9.cy,m:inf9.m,hp:inf9.hp}:'gone', e7:e7?{cx:e7.cx,cy:e7.cy,hp:e7.hp}:'gone'};
    }),
  ]);
  console.log(`\nTick ${wData.tick}/${tData.tick}:`);
  console.log(`  WASM inf9: ${JSON.stringify(wData.inf9)}`);
  console.log(`  TS   inf9: ${JSON.stringify(tData.inf9)}`);
  console.log(`  WASM E7:   ${JSON.stringify(wData.e7)}`);
  console.log(`  TS   E7:   ${JSON.stringify(tData.e7)}`);
  // Also check: what is the infantry's target in TS?
  const tTarget = await tp.evaluate(()=>{
    const s=(window as any).__agentState();
    const enemies = (s.enemies||[]) as any[];
    // Find the E1 at (54,55) and check if it has a target
    // Can't directly check target from agentState — check mission instead
    return enemies.filter((e:any)=>(e.t||e.type)==='E1'&&e.m==='HUNT').map((e:any)=>({cx:e.cx,cy:e.cy,m:e.m}));
  });
  console.log(`  TS HUNT infantry: ${JSON.stringify(tTarget)}`);
  await wCtx.close(); await tCtx.close();
});
