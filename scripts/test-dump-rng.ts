import { test } from '@playwright/test';
test('dump infantry calls', async ({browser}) => {
  test.setTimeout(5*60*1000);
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  p.on('dialog', async d => await d.accept());
  await p.goto('https://cliaas.com/ra/original.html?scenario=SCG03EA.INI&autoplay=1&agentharness=1&seed=0',{waitUntil:'load'});
  await p.waitForFunction(()=>{try{const M=(window as any).Module;return M?.ccall&&JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length>0}catch{return false}},{timeout:180000,polling:2000});
  // Read state to enable logging + reset
  await p.evaluate(()=>{const M=(window as any).Module;JSON.parse(M.ccall('agent_get_state','string',[],[]))});
  // Step 10 ticks one at a time
  for (let t = 1; t <= 11; t++) {
    const d = await p.evaluate(async()=>{
      const r=(window as any).__agentStep(1);
      const res=r?.then?await r:r;
      const s=res?.state??res;
      return {tick:s.tick, log:(s.rngLog??[]) as [number,number][]};
    });
    const infCalls = d.log.filter(([_,tag]:any) => tag >= 10000 && tag < 11000);
    if (infCalls.length > 0 || t >= 9) {
      console.log(`tick ${d.tick}: ${d.log.length} calls, infantry: ${infCalls.map(([s,tag]:any)=>`[${tag-10000}]`).join(',') || 'none'}`);
    }
  }
  await ctx.close();
});
