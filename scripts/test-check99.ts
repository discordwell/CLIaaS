import { test } from '@playwright/test';
test('HUNT infantry approach comparison', async ({browser}) => {
  test.setTimeout(5*60*1000);
  const wCtx=await browser.newContext();const tCtx=await browser.newContext({viewport:{width:1200,height:800}});
  const wp=await wCtx.newPage();const tp=await tCtx.newPage();
  wp.on('dialog',async d=>await d.accept());
  await Promise.all([wp.goto('https://cliaas.com/ra/original.html?scenario=SCG03EA.INI&autoplay=1&agentharness=1&seed=0',{waitUntil:'load'}),tp.goto('https://cliaas.com?anttest=agent&scenario=SCG03EA&difficulty=normal',{waitUntil:'load'})]);
  await Promise.all([wp.waitForFunction(()=>{try{const M=(window as any).Module;return M?.ccall&&JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length>0}catch{return false}},{timeout:180000,polling:2000}),tp.waitForFunction(()=>(window as any).__agentReady===true,{timeout:120000,polling:1000})]);
  const ws=await wp.evaluate(()=>{const M=(window as any).Module;return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState});
  await tp.evaluate((s:number)=>{(window as any).__syncRngSeed?.(s)},ws);
  let prev=0;
  for (const tick of [25,50,75,100,131]) {
    const step=tick-prev;prev=tick;
    await Promise.all([wp.evaluate(async(n:number)=>{const r=(window as any).__agentStep(n);if(r?.then)await r},step),tp.evaluate((n:number)=>{(window as any).__agentStep?.(n)},step)]);
    const[w,t]=await Promise.all([
      wp.evaluate(()=>{const M=(window as any).Module;const s=JSON.parse(M.ccall('agent_get_state','string',[],[]));return[...(s.enemies||[])].filter((x:any)=>x.m===14).map((x:any)=>({t:x.t,cx:x.cx,cy:x.cy}))}),
      tp.evaluate(()=>{const s=(window as any).__agentState();return[...(s.enemies||[])].filter((x:any)=>x.m==='HUNT').map((x:any)=>({t:x.t||x.type,cx:x.cx,cy:x.cy}))})]);
    const match = JSON.stringify(w) === JSON.stringify(t.map((x:any)=>({t:x.t,cx:x.cx,cy:x.cy})));
    console.log(`tick ${tick}: ${match?'✓':'✗'} W=${JSON.stringify(w)} T=${JSON.stringify(t)}`);
  }
  await wCtx.close();await tCtx.close();
});
