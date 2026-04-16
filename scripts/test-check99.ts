import { test } from '@playwright/test';
test('check AT logs', async ({browser}) => {
  test.setTimeout(5*60*1000);
  const ctx=await browser.newContext({viewport:{width:1200,height:800}});
  const p=await ctx.newPage();
  const logs:string[]=[];
  p.on('console',m=>{if(m.text().startsWith('[AT]'))logs.push(m.text())});
  await p.goto('https://cliaas.com?anttest=agent&scenario=SCG03EA&difficulty=normal',{waitUntil:'load'});
  await p.waitForFunction(()=>(window as any).__agentReady===true,{timeout:120000,polling:1000});
  await p.evaluate(()=>{(window as any).__agentStep?.(5)});
  await p.evaluate(()=>new Promise(r=>setTimeout(r,200)));
  console.log(`${logs.length} AT logs:`);
  for (const l of logs) console.log(`  ${l}`);
  await ctx.close();
});
