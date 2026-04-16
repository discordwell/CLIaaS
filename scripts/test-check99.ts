import { test } from '@playwright/test';
test('sweep cells', async ({browser}) => {
  test.setTimeout(5*60*1000);
  const tCtx=await browser.newContext({viewport:{width:1200,height:800}});
  const tp=await tCtx.newPage();
  await tp.goto('https://cliaas.com?anttest=agent&scenario=SCG03EA&difficulty=normal',{waitUntil:'load'});
  await tp.waitForFunction(()=>(window as any).__agentReady===true,{timeout:120000,polling:1000});
  await tp.evaluate(()=>{(window as any).__agentStep?.(76)});
  // Manually compute sweep cells
  const cells = await tp.evaluate(()=>{
    const game=(window as any).__agentGame;
    // Get the COS/SIN tables from the entity module
    // They're not directly accessible... let me find them through the import chain
    // Actually, let's just hardcode the relevant table values
    // COS_TABLE_256 and SIN_TABLE_256 are exported from types.ts
    // Let me access them via the entity's moveToward context
    
    // Simpler: just read the approach cell from the HUNT entity
    const hunt = (game.entities as any[])?.filter((x:any)=>x.mission==='HUNT'&&x.type==='E1'&&Math.abs(x.cell.cx-56)<=2);
    if (!hunt?.length) return 'no hunt';
    const e = hunt[0];
    return {
      pos: `(${e.cell.cx},${e.cell.cy})`,
      mt: e.moveTarget ? `(${Math.floor(e.moveTarget.lx/256)},${Math.floor(e.moveTarget.ly/256)})` : 'null',
      tgt: e.target ? `(${e.target.cell.cx},${e.target.cell.cy})` : 'null',
      pathCells: e.path?.map((p:any)=>`(${p.cx},${p.cy})`).join('→'),
    };
  });
  console.log(JSON.stringify(cells, null, 2));
  await tCtx.close();
});
