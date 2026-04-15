import { test } from '@playwright/test';
test('infantry 95 state at tick 10', async ({browser}) => {
  test.setTimeout(5*60*1000);
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  p.on('dialog', async d => await d.accept());
  await p.goto('https://cliaas.com/ra/original.html?scenario=SCG03EA.INI&autoplay=1&agentharness=1&seed=0',{waitUntil:'load'});
  await p.waitForFunction(()=>{try{const M=(window as any).Module;return M?.ccall&&JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length>0}catch{return false}},{timeout:180000,polling:2000});
  // Reset rng log
  await p.evaluate(()=>{const M=(window as any).Module;JSON.parse(M.ccall('agent_get_state','string',[],[]))});

  // Step to tick 9
  await p.evaluate(async()=>{const r=(window as any).__agentStep(9);if(r?.then) await r});

  // Step tick 10 and read from step result
  const data = await p.evaluate(async()=>{
    const r = (window as any).__agentStep(1);
    const res = r?.then ? await r : r;
    const s = res?.state ?? res;
    // Get logic layer and all entities
    return {
      tick: s.tick,
      rngLog: s.rngLog,
      logicLayer: s.logicLayer,
      enemies: (s.enemies||[]).map((e:any)=>({id:e.id,t:e.t,cx:e.cx,cy:e.cy,m:e.m,hp:e.hp})),
      units: (s.units||[]).map((e:any)=>({id:e.id,t:e.t,cx:e.cx,cy:e.cy,m:e.m,hp:e.hp})),
    };
  });

  console.log(`\ntick ${data.tick}: ${data.rngLog?.length} rng calls`);
  if (data.rngLog?.length > 0) {
    for (const [seed, tag] of data.rngLog) {
      const cat = tag >= 10000 && tag < 11000 ? `infantry[${tag-10000}]` :
                  tag >= 11000 && tag < 12000 ? `unit[${tag-11000}]` :
                  tag >= 12000 && tag < 13000 ? `building[${tag-12000}]` : `tag[${tag}]`;
      console.log(`  ${cat} seed=${seed}`);
    }
  }

  // Logic layer: find what's at index 95
  console.log(`\nLogic layer (${data.logicLayer?.length} entities shown):`);
  for (const [idx, type, house] of data.logicLayer || []) {
    if (idx >= 93 && idx <= 97) console.log(`  [${idx}] ${type} (${house})`);
  }

  // Find all E1 enemies to identify which one is at logic index 95
  console.log(`\nAll E1 enemies:`);
  for (const e of data.enemies.filter((e:any)=>e.t==='E1')) {
    console.log(`  E1 id=${e.id} at (${e.cx},${e.cy}) mission=${e.m} hp=${e.hp}`);
  }

  await ctx.close();
});
