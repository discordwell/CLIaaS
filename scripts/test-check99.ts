import { test } from '@playwright/test';
test('track all E1 near 54,55 across ticks', async ({browser}) => {
  test.setTimeout(5*60*1000);
  const wCtx=await browser.newContext();const tCtx=await browser.newContext({viewport:{width:1200,height:800}});
  const wp=await wCtx.newPage();const tp=await tCtx.newPage();
  wp.on('dialog',async d=>await d.accept());
  await Promise.all([wp.goto('https://cliaas.com/ra/original.html?scenario=SCG03EA.INI&autoplay=1&agentharness=1&seed=0',{waitUntil:'load'}),tp.goto('https://cliaas.com?anttest=agent&scenario=SCG03EA&difficulty=normal',{waitUntil:'load'})]);
  await Promise.all([wp.waitForFunction(()=>{try{const M=(window as any).Module;return M?.ccall&&JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length>0}catch{return false}},{timeout:180000,polling:2000}),tp.waitForFunction(()=>(window as any).__agentReady===true,{timeout:120000,polling:1000})]);
  const ws=await wp.evaluate(()=>{const M=(window as any).Module;return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState});
  await tp.evaluate((s:number)=>{(window as any).__syncRngSeed?.(s)},ws);
  for (const tick of [1, 5, 10, 15, 25, 50, 99]) {
    const step = tick === 1 ? 1 : tick - [1,5,10,15,25,50,99][[1,5,10,15,25,50,99].indexOf(tick)-1];
    await Promise.all([wp.evaluate(async(n:number)=>{const r=(window as any).__agentStep(n);if(r?.then)await r},step),tp.evaluate((n:number)=>{(window as any).__agentStep?.(n)},step)]);
    const [w,t]=await Promise.all([
      wp.evaluate(()=>{const M=(window as any).Module;const s=JSON.parse(M.ccall('agent_get_state','string',[],[]));return{tick:s.tick,inf:[...(s.enemies||[])].filter((e:any)=>e.t==='E1'&&Math.abs(e.cx-54)<=5&&Math.abs(e.cy-55)<=5).map((e:any)=>({cx:e.cx,cy:e.cy,m:e.m}))}}),
      tp.evaluate(()=>{const s=(window as any).__agentState();return{tick:s.tick,inf:[...(s.enemies||[])].filter((e:any)=>(e.t||e.type)==='E1'&&Math.abs(e.cx-54)<=5&&Math.abs(e.cy-55)<=5).map((e:any)=>({cx:e.cx,cy:e.cy,m:e.m}))}})]);
    console.log(`tick ${w.tick}: W=${JSON.stringify(w.inf)} T=${JSON.stringify(t.inf)}`);
  }
  await wCtx.close();await tCtx.close();
});
