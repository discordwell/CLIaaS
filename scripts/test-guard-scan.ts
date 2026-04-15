import { test } from '@playwright/test';
test('tick 1 RNG breakdown', async ({browser}) => {
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
  await tp.evaluate(()=>{(window as any).__rngTagControl('enable')});
  await wp.evaluate(()=>{const M=(window as any).Module;JSON.parse(M.ccall('agent_get_state','string',[],[]))});
  const [wLog,_]=await Promise.all([
    wp.evaluate(async()=>{const r=(window as any).__agentStep(1);const res=r?.then?await r:r;const s=res?.state??res;return(s.rngLog||[])as[number,number][]}),
    tp.evaluate(()=>{(window as any).__agentStep?.(1)}),
  ]);
  const tLog=await tp.evaluate(()=>((window as any).__rngTagControl('read').seedLog||[])as[number,number][]);
  function cat(log:[number,number][]){let i=0,u=0,b=0,o=0;for(const[_,t]of log){if(t>=10000&&t<11000)i++;else if(t>=11000&&t<12000)u++;else if(t>=12000&&t<13000)b++;else o++}return{i,u,b,o,t:log.length}}
  const w=cat(wLog),t=cat(tLog);
  console.log(`WASM: total=${w.t} inf=${w.i} unit=${w.u} bldg=${w.b} other=${w.o}`);
  console.log(`TS:   total=${t.t} inf=${t.i} unit=${t.u} bldg=${t.b} other=${t.o}`);
  console.log(`Δ:    total=${t.t-w.t} inf=${t.i-w.i} unit=${t.u-w.u} bldg=${t.b-w.b} other=${t.o-w.o}`);
  // Histogram
  function hist(log:[number,number][],off:number){const m=new Map<number,number>();for(const[_,t]of log)if(t>=10000&&t<11000)m.set(t-10000-off,(m.get(t-10000-off)||0)+1);const h=new Map<number,number>();for(const c of m.values())h.set(c,(h.get(c)||0)+1);return h}
  const wh=hist(wLog,86),th=hist(tLog,2);
  console.log(`\nWASM hist:`);for(const[c,n]of[...wh].sort((a,b)=>a[0]-b[0]))console.log(`  ${c}calls: ${n}`);
  console.log(`TS hist:`);for(const[c,n]of[...th].sort((a,b)=>a[0]-b[0]))console.log(`  ${c}calls: ${n}`);
  await wCtx.close();await tCtx.close();
});
