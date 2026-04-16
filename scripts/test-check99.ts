import { test } from '@playwright/test';
test('sweep debug', async ({browser}) => {
  test.setTimeout(5*60*1000);
  const wCtx=await browser.newContext();const tCtx=await browser.newContext({viewport:{width:1200,height:800}});
  const wp=await wCtx.newPage();const tp=await tCtx.newPage();
  wp.on('dialog',async d=>await d.accept());
  const logs:string[]=[];
  tp.on('console',m=>{if(m.text().startsWith('[SW]'))logs.push(m.text())});
  await Promise.all([wp.goto('https://cliaas.com/ra/original.html?scenario=SCG03EA.INI&autoplay=1&agentharness=1&seed=0',{waitUntil:'load'}),tp.goto('https://cliaas.com?anttest=agent&scenario=SCG03EA&difficulty=normal',{waitUntil:'load'})]);
  await Promise.all([wp.waitForFunction(()=>{try{const M=(window as any).Module;return M?.ccall&&JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length>0}catch{return false}},{timeout:180000,polling:2000}),tp.waitForFunction(()=>(window as any).__agentReady===true,{timeout:120000,polling:1000})]);
  const ws=await wp.evaluate(()=>{const M=(window as any).Module;return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState});
  await tp.evaluate((s:number)=>{(window as any).__syncRngSeed?.(s)},ws);
  await tp.evaluate(()=>{(window as any).__agentStep?.(12)});
  await tp.evaluate(()=>new Promise(r=>setTimeout(r,200)));
  // Show only the accepted cell and a few rejected
  const accepted = logs.filter(l=>l.includes('pass=true'));
  const rejected = logs.filter(l=>l.includes('pass=false')).slice(0,3);
  console.log(`${logs.length} sweep entries, ${accepted.length} accepted:`);
  for (const l of accepted) console.log(`  ${l}`);
  if (rejected.length) { console.log(`Sample rejected:`); for (const l of rejected) console.log(`  ${l}`); }
  await wCtx.close();await tCtx.close();
});
