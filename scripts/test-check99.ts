import { test } from '@playwright/test';
test('tick 131 entity comparison', async ({browser}) => {
  test.setTimeout(5*60*1000);
  const wCtx=await browser.newContext();const tCtx=await browser.newContext({viewport:{width:1200,height:800}});
  const wp=await wCtx.newPage();const tp=await tCtx.newPage();
  wp.on('dialog',async d=>await d.accept());
  await Promise.all([wp.goto('https://cliaas.com/ra/original.html?scenario=SCG03EA.INI&autoplay=1&agentharness=1&seed=0',{waitUntil:'load'}),tp.goto('https://cliaas.com?anttest=agent&scenario=SCG03EA&difficulty=normal',{waitUntil:'load'})]);
  await Promise.all([wp.waitForFunction(()=>{try{const M=(window as any).Module;return M?.ccall&&JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length>0}catch{return false}},{timeout:180000,polling:2000}),tp.waitForFunction(()=>(window as any).__agentReady===true,{timeout:120000,polling:1000})]);
  const ws=await wp.evaluate(()=>{const M=(window as any).Module;return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState});
  await tp.evaluate((s:number)=>{(window as any).__syncRngSeed?.(s)},ws);
  await Promise.all([wp.evaluate(async()=>{const r=(window as any).__agentStep(131);if(r?.then)await r}),tp.evaluate(()=>{(window as any).__agentStep?.(131)})]);
  // Find E2 near (65,72) — infantry #17
  const[w,t]=await Promise.all([
    wp.evaluate(()=>{const M=(window as any).Module;const s=JSON.parse(M.ccall('agent_get_state','string',[],[]));
      return{tick:s.tick,
        inf17:[...(s.enemies||[])].find((x:any)=>x.t==='E2'&&Math.abs(x.cx-65)<=3&&Math.abs(x.cy-72)<=3),
        hunt:[...(s.enemies||[])].filter((x:any)=>x.m===14).map((x:any)=>({t:x.t,cx:x.cx,cy:x.cy}))}}),
    tp.evaluate(()=>{const s=(window as any).__agentState();
      return{tick:s.tick,
        inf17:[...(s.enemies||[])].find((x:any)=>(x.t||x.type)==='E2'&&Math.abs(x.cx-65)<=3&&Math.abs(x.cy-72)<=3),
        hunt:[...(s.enemies||[])].filter((x:any)=>x.m==='HUNT').map((x:any)=>({t:x.t||x.type,cx:x.cx,cy:x.cy}))}})]);
  console.log(`tick ${w.tick}:`);
  console.log(`  WASM inf17: ${JSON.stringify(w.inf17)}`);
  console.log(`  TS   inf17: ${JSON.stringify(t.inf17)}`);
  console.log(`  WASM HUNT: ${JSON.stringify(w.hunt)}`);
  console.log(`  TS   HUNT: ${JSON.stringify(t.hunt)}`);
  await wCtx.close();await tCtx.close();
});
