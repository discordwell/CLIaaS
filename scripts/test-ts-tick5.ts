import { test } from '@playwright/test';
test('TS infantry[11] with WASM seed sync', async ({browser}) => {
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

  for (let t = 1; t <= 6; t++) {
    await tp.evaluate(()=>{(window as any).__rngTagControl('reset')});
    await tp.evaluate(()=>{(window as any).__agentStep?.(1)});
    const r = await tp.evaluate(()=>{
      const c = (window as any).__rngTagControl('read');
      const s = (window as any).__agentState();
      // Find infantry at entities[11]
      const e = s.enemies?.find((e:any)=>(e.t||e.type)==='E1'&&e.id!=null);
      return {...c, tick:s.tick};
    });
    const entries = (r.seedLog || []) as [number,number][];
    const inf11 = entries.filter(([_,tag]:any) => tag === 10011);
    if (inf11.length > 0 || t >= 4) {
      console.log(`tick ${t}: ${entries.length} total, ${inf11.length} from inf[11], seed=${r.seed}`);
      if (inf11.length > 0) {
        const tagged = (r.taggedLog || []) as string[];
        const inf11Tagged = tagged.filter((s:string) => s.startsWith('[10011]'));
        for (const s of inf11Tagged) console.log(`  ${s}`);
      }
    }
  }
  await wCtx.close(); await tCtx.close();
});
