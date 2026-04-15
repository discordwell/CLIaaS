import { test } from '@playwright/test';
test('dump tick 2 and 10 tags', async ({browser}) => {
  test.setTimeout(5*60*1000);
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  p.on('dialog', async d => await d.accept());
  await p.goto('https://cliaas.com/ra/original.html?scenario=SCG03EA.INI&autoplay=1&agentharness=1&seed=0',{waitUntil:'load'});
  await p.waitForFunction(()=>{try{const M=(window as any).Module;return M?.ccall&&JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length>0}catch{return false}},{timeout:180000,polling:2000});
  await p.evaluate(()=>{const M=(window as any).Module;JSON.parse(M.ccall('agent_get_state','string',[],[]))});
  for (let t = 1; t <= 10; t++) {
    const d = await p.evaluate(async()=>{
      const r=(window as any).__agentStep(1);const res=r?.then?await r:r;const s=res?.state??res;
      return {tick:s.tick,log:(s.rngLog??[]) as [number,number][]};
    });
    if (d.log.length > 0) {
      const tags = d.log.map(([_,tag]:any) => {
        if (tag>=16000) return `anim[${tag-16000}]`;
        if (tag>=15000) return `bullet[${tag-15000}]`;
        if (tag>=14000) return `vessel[${tag-14000}]`;
        if (tag>=13000) return `aircraft[${tag-13000}]`;
        if (tag>=12000) return `bldg[${tag-12000}]`;
        if (tag>=11000) return `unit[${tag-11000}]`;
        if (tag>=10000) return `inf[${tag-10000}]`;
        const names:Record<number,string>={1:'TeamAI',3:'Map',4:'Factory',5:'HouseAI',20:'Fade',21:'Trigger',100:'autocreate'};
        return names[tag]??`tag${tag}`;
      });
      console.log(`tick ${d.tick}: ${d.log.length} calls — ${tags.join(', ')}`);
    }
  }
  await ctx.close();
});
