import { test } from '@playwright/test';
const BASE_URL = 'https://cliaas.com';

test(`SCG08 tick 1 timer dump`, async ({ browser }) => {
  test.setTimeout(10*60*1000);
  const tc = await browser.newContext({viewport:{width:1200,height:800}});
  const tp = await tc.newPage();
  await tp.goto(`${BASE_URL}?anttest=agent&scenario=SCG08EA&difficulty=normal`,{waitUntil:'load'});
  await tp.waitForFunction(()=>(window as any).__agentReady===true,{timeout:120000,polling:1000});

  const wc = await browser.newContext(); const wp = await wc.newPage();
  wp.on('dialog', async d => { await d.accept(); });
  await wp.goto(`${BASE_URL}/ra/original.html?scenario=SCG08EA.INI&autoplay=1&agentharness=1&seed=0`,{waitUntil:'load'});
  await wp.waitForFunction(()=>{try{const M=(window as any).Module;return M?.ccall&&JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length>0;}catch{return false;}},{timeout:180000,polling:2000});
  const seed = await wp.evaluate(()=>{const M=(window as any).Module;return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState;});
  await tp.evaluate((s:number)=>{(window as any).__syncRngSeed?.(s);},seed);

  // Enable RNG logging before tick 1
  await tp.evaluate(()=>{(window as any).__rngTagControl?.('enable'); (window as any).__rngTagControl?.('reset');});

  // Step 1 tick
  await tp.evaluate(()=>{(window as any).__agentStep?.(1);});

  // Read how many RNG calls at tick 1
  const log = await tp.evaluate(()=>{
    const r = (window as any).__rngTagControl?.('read');
    return { total: r.seedLog.length, seed: r.seed>>>0 };
  });

  // Also read WASM seed at tick 1
  await wp.evaluate(async()=>{const r=(window as any).__agentStep(1);if(r?.then)await r;});
  const wSeed = await wp.evaluate(()=>{const M=(window as any).Module;return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState>>>0;});

  console.log(`Tick 1: TS ${log.total} RNG calls, seed=${log.seed.toString(16)} W seed=${wSeed.toString(16)} ${log.seed===wSeed?'✓':'✗'}`);

  // Dump entity timers
  const timers = await tp.evaluate(()=>{
    const g=(window as any).__agentGame;
    const result:any[]=[];
    for (let i=0;i<Math.min(35,g.entities.length);i++){
      const e=g.entities[i];
      if(!e||!e.alive)continue;
      result.push({idx:i,type:e.type,mt:e.missionTimer,m:e.mission});
    }
    return result;
  });
  console.log('\nEntity timers after tick 1:');
  for(const e of timers) console.log(`  ${e.idx}: ${e.type} mt=${e.mt} m=${e.m}`);

  await wc.close(); await tc.close();
});
