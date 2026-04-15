import { test } from '@playwright/test';
test('WASM sub-tag decode', async ({browser}) => {
  test.setTimeout(5*60*1000);
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  p.on('dialog', async d => await d.accept());
  await p.goto('https://cliaas.com/ra/original.html?scenario=SCG03EA.INI&autoplay=1&agentharness=1&seed=0',{waitUntil:'load'});
  await p.waitForFunction(()=>{try{const M=(window as any).Module;return M?.ccall&&JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length>0}catch{return false}},{timeout:180000,polling:2000});
  await p.evaluate(()=>{const M=(window as any).Module;JSON.parse(M.ccall('agent_get_state','string',[],[]))});
  const log = await p.evaluate(async()=>{
    const r=(window as any).__agentStep(1);const res=r?.then?await r:r;const s=res?.state??res;
    return (s.rngLog||[]) as [number,number][];
  });
  // Sub-tags: 0x10000=jitter, 0x20000=found_target, 0x40000=Random_Animate
  const infCalls = new Map<number,{jitter:number,target:number,ra:number,plain:number}>();
  for (const [_,tag] of log) {
    const base = tag & 0xFFFF;
    const sub = (tag >> 16) & 0xF;
    if (base < 10000 || base >= 11000) continue;
    const idx = base - 10000 - 86;
    if (!infCalls.has(idx)) infCalls.set(idx, {jitter:0,target:0,ra:0,plain:0});
    const c = infCalls.get(idx)!;
    if (sub === 1) c.jitter++;
    else if (sub === 2) c.target++;
    else if (sub === 4) c.ra++;
    else c.plain++;
  }
  let foundTarget=0, ranRA=0, jitterOnly=0;
  for (const [_, c] of infCalls) {
    if (c.target > 0) foundTarget++;
    else if (c.ra > 0) ranRA++;
    else jitterOnly++;
  }
  console.log(`\nWASM GUARD infantry breakdown (${infCalls.size} total):`);
  console.log(`  Found target (skip RA): ${foundTarget}`);
  console.log(`  Ran Random_Animate: ${ranRA}`);
  console.log(`  Jitter only (RA blocked): ${jitterOnly}`);
  await ctx.close();
});
