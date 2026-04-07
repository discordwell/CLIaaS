import { test } from '@playwright/test';
const BASE_URL = 'https://cliaas.com';

test('SCG02EA: full tick-1 call sequence', async ({ browser }) => {
  test.setTimeout(3 * 60 * 1000);
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await ctx.newPage();
  const logs: string[] = [];
  page.on('console', msg => { if (msg.text().includes('RNG') || msg.text().includes('tag=')) logs.push(msg.text()); });

  await page.goto(BASE_URL + '?anttest=agent&scenario=SCG02EA&difficulty=normal', { waitUntil: 'load' });
  await page.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120000 });
  const seed = await page.evaluate(() => (window as any).__agentState().rngState);
  console.log('Init seed: ' + seed);
  
  // Step 1 tick
  await page.evaluate(() => { (window as any).__agentStep?.(1); });
  
  const state = await page.evaluate(() => {
    const s = (window as any).__agentState();
    return { seedLog: s.rngSeedLog || [], calls: s.rngCalls };
  });

  // Group calls by tag category
  const tagCounts: Record<string, number> = {};
  for (const entry of state.seedLog) {
    const tag = Array.isArray(entry) ? entry[1] : 0;
    let category: string;
    if (tag === 0) category = 'untagged';
    else if (tag >= 10000 && tag < 11000) category = 'infantry-' + (tag - 10000);
    else if (tag >= 11000 && tag < 12000) category = 'vehicle-' + (tag - 11000);
    else if (tag >= 12000 && tag < 13000) category = 'struct-' + (tag - 12000);
    else if (tag >= 13000) category = 'aircraft-' + (tag - 13000);
    else category = 'tag-' + tag;
    tagCounts[category] = (tagCounts[category] || 0) + 1;
  }

  console.log('\n=== TICK 1 CALL BREAKDOWN (' + state.seedLog.length + ' total) ===');
  
  // Count by type
  let infantry = 0, vehicle = 0, struct = 0, aircraft = 0, other = 0;
  for (const [cat, count] of Object.entries(tagCounts)) {
    if (cat.startsWith('infantry')) infantry += count;
    else if (cat.startsWith('vehicle')) vehicle += count;
    else if (cat.startsWith('struct')) struct += count;
    else if (cat.startsWith('aircraft')) aircraft += count;
    else other += count;
  }
  console.log('Infantry calls: ' + infantry);
  console.log('Vehicle calls: ' + vehicle);
  console.log('Structure calls: ' + struct);
  console.log('Aircraft calls: ' + aircraft);
  console.log('Other/untagged: ' + other);

  // Show the SEQUENCE of tag transitions (where structures fall relative to entities)
  console.log('\n=== PROCESSING ORDER (tag sequence) ===');
  let prevType = '';
  let runStart = 0;
  for (let i = 0; i <= state.seedLog.length; i++) {
    const entry = state.seedLog[i];
    const tag = entry ? (Array.isArray(entry) ? entry[1] : 0) : -1;
    let type: string;
    if (tag === -1) type = 'END';
    else if (tag === 0) type = 'UNTAGGED';
    else if (tag >= 10000 && tag < 11000) type = 'INFANTRY';
    else if (tag >= 11000 && tag < 12000) type = 'VEHICLE';
    else if (tag >= 12000 && tag < 13000) type = 'STRUCT';
    else type = 'AIRCRAFT';

    if (type !== prevType && prevType !== '') {
      console.log('  [' + runStart + '-' + (i-1) + '] ' + prevType + ' (' + (i - runStart) + ' calls)');
      runStart = i;
    }
    prevType = type;
  }

  await ctx.close();
});
