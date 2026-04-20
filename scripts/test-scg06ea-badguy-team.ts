import { test } from '@playwright/test';
const BASE_URL = 'https://cliaas.com';
test('SCG06EA BadGuy team state', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const tsCtx = await browser.newContext();
  const tsPage = await tsCtx.newPage();
  const wasmCtx = await browser.newContext();
  const wasmPage = await wasmCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });

  await Promise.all([
    tsPage.goto(`${BASE_URL}?anttest=agent&scenario=SCG06EA&difficulty=normal`, { waitUntil: 'load' }),
    wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=SCG06EA.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' }),
  ]);
  await Promise.all([
    tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 }),
    wasmPage.waitForFunction(() => {
      try { const M = (window as any).Module; return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0; } catch { return false; }
    }, { timeout: 180_000, polling: 2000 }),
  ]);
  const wasmSeed = await wasmPage.evaluate(() => JSON.parse((window as any).Module.ccall('agent_get_state','string',[],[])).rngState);
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);

  for (let t = 0; t <= 5; t++) {
    await Promise.all([
      tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
      wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
    ]);

    const tsTeam = await tsPage.evaluate(() => {
      const teams = (window as any).__rawTeams?.() ?? [];
      return teams.filter((t: { _members: Array<{ id: number }>; house: string }) =>
        t._members.some((m) => m.id === 22 || m.id === 23))
        .map((t: { id: number; house: string; isMoving: boolean; isUnderStrength: boolean; currentMission: number; missionList: Array<{ mission: number; data: number }>; _members: Array<{ id: number; type: string; mission: string }> }) => ({
          id: t.id, house: t.house, isMoving: t.isMoving, isUnderStrength: t.isUnderStrength,
          currentMission: t.currentMission,
          missionType: t.missionList?.[t.currentMission ?? 0]?.mission,
          members: t._members.map((m) => `${m.id}:${m.type}(${m.mission})`),
        }));
    });

    const wasmTeams = await wasmPage.evaluate(() => {
      const M = (window as any).Module;
      const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
      return (s.teams ?? []).filter((t: { house: string; members: Array<{ ids: number[] }> }) => t.house === 'BadGuy');
    });

    console.log(`tick ${t + 1}:`);
    console.log(`  TS BadGuy team: ${JSON.stringify(tsTeam)}`);
    console.log(`  WASM BadGuy teams: ${JSON.stringify(wasmTeams)}`);
  }

  await tsCtx.close();
  await wasmCtx.close();
});
