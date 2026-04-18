/**
 * Team init diagnostic — shows all active teams at tick 0 + tick 1 for a scenario.
 * Usage: SCENARIO=SCG06EA npx playwright test scripts/test-team-init.ts
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';
const scenario = process.env.SCENARIO ?? 'SCG06EA';

test(`${scenario} team init`, async ({ browser }) => {
  test.setTimeout(3 * 60 * 1000);
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const tsPage = await tsCtx.newPage();

  const consoleMessages: string[] = [];
  tsPage.on('console', msg => {
    const text = msg.text();
    if (text.includes('[TEAM') || text.includes('TEAM ACTIVATE')) consoleMessages.push(text);
  });
  await tsPage.goto(`${BASE_URL}?anttest=agent&scenario=${scenario}&difficulty=normal`, { waitUntil: 'load' });
  await tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 });
  // Sync seed to match other test flow (test-rng-caller-trace uses this)
  await tsPage.evaluate(() => { (window as any).__syncRngSeed?.(1560713546); });
  await tsPage.evaluate(() => { (window as any).__rngTagControl?.('enable'); });

  const teams0 = await tsPage.evaluate(() => (window as any).__agentTeams?.());
  console.log(`\n=== ${scenario} at tick 0 (${teams0?.length ?? 0} active teams) ===`);
  for (const t of teams0 ?? []) {
    console.log(JSON.stringify(t));
  }

  for (let step = 1; step <= 3; step++) {
    await tsPage.evaluate(() => { (window as any).__agentStep?.(1); });
    const teams = await tsPage.evaluate(() => (window as any).__agentTeams?.());
    const gameTick = await tsPage.evaluate(() => (window as any).__agentGame?.tick);
    const pcCalls = await tsPage.evaluate(() => (globalThis as unknown as { __percentChanceCalls?: string[] }).__percentChanceCalls?.length ?? 0);
    console.log(`\n=== after step ${step} (engine tick=${gameTick}, teams=${teams?.length ?? 0}, total pc=${pcCalls}) ===`);
    for (const t of teams ?? []) {
      console.log(`  team#${t.id} h=${t.house} moving=${t.isMoving} fs=${t.isFullStrength} us=${t.isUnderStrength} mem=${t.members} types=${t.memberTypes?.join(',')}`);
    }
  }

  const dbg = await tsPage.evaluate(() => (window as any).__agentDebug?.());
  const firedTriggers = (dbg?.triggers ?? []).filter((t: { fired: boolean }) => t.fired);
  console.log(`\nFired triggers after tick 1 (${firedTriggers.length}):`);
  for (const t of firedTriggers) {
    console.log(`  [${t.i}] ${t.name}: ec=${t.ec} ac=${t.ac} e1=${t.e1}(d=${t.e1d}) e2=${t.e2}(d=${t.e2d}) a1=${t.a1}(team=${t.a1t},trig=${t.a1tr},d=${t.a1d}) a2=${t.a2}(team=${t.a2t},trig=${t.a2tr},d=${t.a2d})`);
  }
  console.log(`\nTEAM ACTIVATE console messages (${consoleMessages.length}):`);
  for (const m of consoleMessages) {
    console.log(`  ${m}`);
  }

  const activations = await tsPage.evaluate(() => (globalThis as unknown as { __teamActivateLog?: string[] }).__teamActivateLog ?? []);
  console.log(`\n__teamActivateLog (${activations.length}):`);
  for (const a of activations) {
    console.log(`  ${a}`);
  }

  const aiTrace = await tsPage.evaluate(() => (globalThis as unknown as { __teamAiTrace?: string[] }).__teamAiTrace ?? []);
  console.log(`\n__teamAiTrace (${aiTrace.length}):`);
  for (const t of aiTrace) {
    console.log(`  ${t}`);
  }

  const pcCalls = await tsPage.evaluate(() => (globalThis as unknown as { __percentChanceCalls?: string[] }).__percentChanceCalls ?? []);
  console.log(`\n__percentChanceCalls (${pcCalls.length}):`);
  for (const p of pcCalls) {
    console.log(`  ${p}`);
  }

  await tsCtx.close();
});
