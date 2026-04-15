import { test } from '@playwright/test';
test('trace sov1 team recruitment', async ({browser}) => {
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
  // Step to tick 5
  await Promise.all([
    wp.evaluate(async()=>{const r=(window as any).__agentStep(5);if(r?.then) await r}),
    tp.evaluate(()=>{(window as any).__agentStep?.(5)}),
  ]);
  const [wData, tData] = await Promise.all([
    wp.evaluate(()=>{
      const M=(window as any).Module;
      const s=JSON.parse(M.ccall('agent_get_state','string',[],[]));
      // C++ mission 3 = MOVE, 2 = ATTACK
      const e1s=[...(s.enemies||[])].filter((e:any)=>e.t==='E1');
      return {tick:s.tick,
        moving:e1s.filter((e:any)=>e.m===2||e.m===3).map((e:any)=>({cx:e.cx,cy:e.cy,m:e.m,hp:e.hp})),
        missionDist:e1s.reduce((a:any,e:any)=>{a[e.m]=(a[e.m]||0)+1;return a},{})};
    }),
    tp.evaluate(()=>{
      const s=(window as any).__agentState();
      const e1s=[...(s.enemies||[])].filter((e:any)=>(e.t||e.type)==='E1');
      return {tick:s.tick,
        moving:e1s.filter((e:any)=>e.m==='MOVE'||e.m==='ATTACK').map((e:any)=>({cx:e.cx,cy:e.cy,m:e.m,hp:e.hp})),
        missionDist:e1s.reduce((a:any,e:any)=>{a[e.m]=(a[e.m]||0)+1;return a},{})};
    }),
  ]);
  console.log(`\nWASM tick ${wData.tick} — E1 missions: ${JSON.stringify(wData.missionDist)}`);
  for (const e of wData.moving) console.log(`  WASM MOVE/ATK: (${e.cx},${e.cy}) m=${e.m}`);
  console.log(`TS tick ${tData.tick} — E1 missions: ${JSON.stringify(tData.missionDist)}`);
  for (const e of tData.moving) console.log(`  TS MOVE/ATK: (${e.cx},${e.cy}) m=${e.m}`);
  await wCtx.close(); await tCtx.close();
});
