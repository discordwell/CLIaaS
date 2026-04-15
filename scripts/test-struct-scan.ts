import { test } from '@playwright/test';
test('WASM Commence gate trace ticks 1-15', async ({browser}) => {
  test.setTimeout(5*60*1000);
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  p.on('dialog', async d => await d.accept());
  await p.goto('https://cliaas.com/ra/original.html?scenario=SCG03EA.INI&autoplay=1&agentharness=1&seed=0',{waitUntil:'load'});
  await p.waitForFunction(()=>{try{const M=(window as any).Module;return M?.ccall&&JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length>0}catch{return false}},{timeout:180000,polling:2000});
  await p.evaluate(()=>{const M=(window as any).Module;JSON.parse(M.ccall('agent_get_state','string',[],[]))});
  for (let t = 1; t <= 15; t++) {
    const data = await p.evaluate(async()=>{
      const r=(window as any).__agentStep(1);const res=r?.then?await r:r;const s=res?.state??res;
      return {tick:s.tick, log:(s.rngLog||[]) as [number,number][]};
    });
    const gates = data.log.filter(([_,tag]:any) => (tag & 0x80000) !== 0);
    for (const [bits, tag] of gates) {
      const infIdx = (tag & 0xFFFF) - 10000 - 86;
      const gateOpen = !!(bits & 0x10);
      const doing = (bits >> 8) & 0xFF;
      const mq = (bits >> 16) & 0xFF;
      console.log(`tick ${data.tick} inf#${infIdx}: gate=${gateOpen?'OPEN':'BLOCKED'} Doing=${doing} MQ=${mq}`);
    }
  }
  await ctx.close();
});
