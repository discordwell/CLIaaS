import { test } from '@playwright/test';
test('check TS mission names', async ({browser}) => {
  test.setTimeout(5*60*1000);
  const ctx = await browser.newContext({viewport:{width:1200,height:800}});
  const p = await ctx.newPage();
  await p.goto('https://cliaas.com?anttest=agent&scenario=SCG03EA&difficulty=normal',{waitUntil:'load'});
  await p.waitForFunction(()=>(window as any).__agentReady===true,{timeout:120000,polling:1000});
  await p.evaluate(()=>{(window as any).__agentStep?.(2)});
  const s=await p.evaluate(()=>{
    const s=(window as any).__agentState();
    const e1s=(s.enemies||[]).filter((e:any)=>(e.t||e.type)==='E1');
    const missionCounts:Record<string,number>={};
    for(const e of e1s){const m=String(e.m);missionCounts[m]=(missionCounts[m]||0)+1;}
    return {count:e1s.length, missions:missionCounts, sample:e1s.slice(0,3)};
  });
  console.log('TS E1 count:', s.count);
  console.log('TS mission distribution:', JSON.stringify(s.missions));
  console.log('TS sample:', JSON.stringify(s.sample));
  await ctx.close();
});
