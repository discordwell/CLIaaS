import { test } from '@playwright/test';
test('WASM Is_Ready_To_Random_Animate per-condition', async ({browser}) => {
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
  const entries = log.filter(([_,tag]:any) => (tag & 0xF0000) === 0x90000);
  const condCounts: Record<string,number> = {};
  for (const [bits] of entries) {
    const idle = !!(bits & 1);
    const height = !!(bits & 2);
    const notDriving = !!(bits & 4);
    const notProne = !!(bits & 8);
    const notFiring = !!(bits & 0x10);
    const doingOk = !!(bits & 0x20);
    const result = !!(bits & 0x40);
    const doing = (bits >> 8) & 0xFF;
    const key = `idle=${idle?1:0} height=${height?1:0} !drv=${notDriving?1:0} !prone=${notProne?1:0} !fire=${notFiring?1:0} doing=${doing}(${doingOk?'ok':'BLOCK'}) → ${result?'READY':'blocked'}`;
    condCounts[key] = (condCounts[key]||0)+1;
  }
  console.log(`\n${entries.length} AREA_GUARD infantry Is_Ready_To_Random_Animate breakdown:`);
  for (const [key, count] of Object.entries(condCounts).sort()) {
    console.log(`  ${count}× ${key}`);
  }
  await ctx.close();
});
