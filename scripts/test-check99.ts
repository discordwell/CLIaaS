import { test } from '@playwright/test';
test('compare path cells at tick 75', async ({browser}) => {
  test.setTimeout(5*60*1000);
  const tCtx=await browser.newContext({viewport:{width:1200,height:800}});
  const wCtx=await browser.newContext();
  const wp=await wCtx.newPage();const tp=await tCtx.newPage();
  wp.on('dialog',async d=>await d.accept());
  await Promise.all([wp.goto('https://cliaas.com/ra/original.html?scenario=SCG03EA.INI&autoplay=1&agentharness=1&seed=0',{waitUntil:'load'}),tp.goto('https://cliaas.com?anttest=agent&scenario=SCG03EA&difficulty=normal',{waitUntil:'load'})]);
  await Promise.all([wp.waitForFunction(()=>{try{const M=(window as any).Module;return M?.ccall&&JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length>0}catch{return false}},{timeout:180000,polling:2000}),tp.waitForFunction(()=>(window as any).__agentReady===true,{timeout:120000,polling:1000})]);
  const ws=await wp.evaluate(()=>{const M=(window as any).Module;return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState});
  await tp.evaluate((s:number)=>{(window as any).__syncRngSeed?.(s)},ws);
  // Step to tick 76 (just after timer fire recalculates approach)
  await tp.evaluate(()=>{(window as any).__agentStep?.(76)});
  const info = await tp.evaluate(()=>{
    const game = (window as any).__agentGame;
    const hunt = (game.entities as any[])?.filter((x:any)=>x.mission==='HUNT'&&x.type==='E1');
    return hunt?.map((e:any)=>({
      cx:e.cell.cx, cy:e.cell.cy,
      mt:e.moveTarget?{lx:e.moveTarget.lx,ly:e.moveTarget.ly}:null,
      path:e.path?.map((p:any)=>`(${p.cx},${p.cy})`).join('→') || 'none',
      pi:e.pathIndex,
    }));
  });
  for (const e of info||[]) {
    if (Math.abs(e.cx-56)<=3 && Math.abs(e.cy-53)<=3) {
      console.log(`inf9 at (${e.cx},${e.cy}): mt=${e.mt?`(${Math.floor(e.mt.lx/256)},${Math.floor(e.mt.ly/256)})`:null}`);
      console.log(`  path: ${e.path}`);
      console.log(`  pathIndex: ${e.pi}`);
    }
  }
  await tCtx.close();await wCtx.close();
});
