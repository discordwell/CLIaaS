import { test } from '@playwright/test';
test('compare infantry RNG at tick 1', async ({browser}) => {
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
  // Reset WASM log by reading state
  await wp.evaluate(()=>{const M=(window as any).Module;JSON.parse(M.ccall('agent_get_state','string',[],[]))});

  // Step 1 tick — read WASM log from step result
  const [wStep, _] = await Promise.all([
    wp.evaluate(async()=>{
      const r=(window as any).__agentStep(1);const res=r?.then?await r:r;const s=res?.state??res;
      return (s.rngLog||[]) as [number,number][];
    }),
    tp.evaluate(()=>{(window as any).__agentStep?.(1)}),
  ]);
  const tLog = await tp.evaluate(()=>{
    return ((window as any).__rngTagControl('read').seedLog||[]) as [number,number][];
  });

  const wMap = new Map<number,number>();
  for (const [_,tag] of wStep) { if (tag>=10000&&tag<11000) wMap.set(tag,(wMap.get(tag)||0)+1); }
  const tMap = new Map<number,number>();
  for (const [_,tag] of tLog) { if (tag>=10000&&tag<11000) tMap.set(tag,(tMap.get(tag)||0)+1); }

  console.log(`\nWASM: ${wStep.length} total, ${wMap.size} infantry with RNG`);
  console.log(`TS:   ${tLog.length} total, ${tMap.size} infantry with RNG`);

  const allTags = new Set([...wMap.keys(), ...tMap.keys()]);
  let diffs = 0;
  for (const tag of [...allTags].sort()) {
    const w = wMap.get(tag) || 0;
    const t = tMap.get(tag) || 0;
    if (w !== t) {
      diffs++;
      if (diffs <= 20) {
        const wS = w===0?'—':w===1?'FIRE':'RA('+w+')';
        const tS = t===0?'—':t===1?'FIRE':'RA('+t+')';
        console.log(`  inf[${tag-10000}]: W=${wS} T=${tS}`);
      }
    }
  }
  console.log(`\n${diffs} infantry differ out of ${allTags.size}`);
  // Count categories
  let wFired=0,wRA=0,wSkip=0,tFired=0,tRA=0,tSkip=0;
  for (const tag of allTags) {
    const w=wMap.get(tag)||0, t=tMap.get(tag)||0;
    if(w===1)wFired++;else if(w>=2)wRA++;else wSkip++;
    if(t===1)tFired++;else if(t>=2)tRA++;else tSkip++;
  }
  console.log(`WASM: ${wFired} fired, ${wRA} idle(RA), ${wSkip} skip`);
  console.log(`TS:   ${tFired} fired, ${tRA} idle(RA), ${tSkip} skip`);
  await wCtx.close(); await tCtx.close();
});
