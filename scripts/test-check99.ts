import { test } from '@playwright/test';
test('lepton tracking ticks 95-105', async ({browser}) => {
  test.setTimeout(5*60*1000);
  const tCtx=await browser.newContext({viewport:{width:1200,height:800}});
  const wCtx=await browser.newContext();
  const wp=await wCtx.newPage();const tp=await tCtx.newPage();
  wp.on('dialog',async d=>await d.accept());
  await Promise.all([wp.goto('https://cliaas.com/ra/original.html?scenario=SCG03EA.INI&autoplay=1&agentharness=1&seed=0',{waitUntil:'load'}),tp.goto('https://cliaas.com?anttest=agent&scenario=SCG03EA&difficulty=normal',{waitUntil:'load'})]);
  await Promise.all([wp.waitForFunction(()=>{try{const M=(window as any).Module;return M?.ccall&&JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length>0}catch{return false}},{timeout:180000,polling:2000}),tp.waitForFunction(()=>(window as any).__agentReady===true,{timeout:120000,polling:1000})]);
  const ws=await wp.evaluate(()=>{const M=(window as any).Module;return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState});
  await tp.evaluate((s:number)=>{(window as any).__syncRngSeed?.(s)},ws);
  // Step to tick 94
  await tp.evaluate(()=>{(window as any).__agentStep?.(94)});
  // Track per-tick lepton position for ticks 95-105
  for (let t = 95; t <= 105; t++) {
    await tp.evaluate(()=>{(window as any).__agentStep?.(1)});
    const info = await tp.evaluate(()=>{
      const game = (window as any).__agentGame;
      const hunt = (game.entities as any[])?.filter((x:any)=>x.mission==='HUNT'&&x.type==='E1'&&x.house==='USSR');
      return hunt?.map((e:any)=>({tick:game.tick,cx:e.cell.cx,cy:e.cell.cy,lx:e.leptonX,ly:e.leptonY,mt:e.moveTarget?'Y':'N',pi:e.pathIndex}));
    });
    const e = info?.find((x:any)=>Math.abs(x.cx-57)<=2 && Math.abs(x.cy-53)<=2);
    if (e) console.log(`t=${e.tick} (${e.cx},${e.cy}) lep=(${e.lx},${e.ly}) mt=${e.mt} pi=${e.pi}`);
  }
  await tCtx.close();await wCtx.close();
});
