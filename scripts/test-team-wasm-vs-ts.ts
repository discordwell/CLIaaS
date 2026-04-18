/**
 * WASM vs TS team state comparison — dumps teams from both engines at each tick.
 * Usage: SCENARIO=SCG06EA STEPS=3 npx playwright test scripts/test-team-wasm-vs-ts.ts
 */
import { test } from '@playwright/test';

const BASE_URL = 'https://cliaas.com';
const scenario = process.env.SCENARIO ?? 'SCG06EA';
const steps = Number(process.env.STEPS ?? 3);

type Team = {
  i: number; cls: string; house: string;
  total: number; desired: number;
  fs: boolean; us: boolean; fa: boolean; mv: boolean;
  hb: boolean; rf: boolean; alt: boolean;
  members: Array<{ type: string; want: number; have: number; ids?: number[] }>;
};

test(`${scenario} WASM vs TS teams`, async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);

  const wasmCtx = await browser.newContext();
  const tsCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const wasmPage = await wasmCtx.newPage();
  const tsPage = await tsCtx.newPage();
  wasmPage.on('dialog', async d => { await d.accept(); });

  await Promise.all([
    wasmPage.goto(`${BASE_URL}/ra/original.html?scenario=${scenario}.INI&autoplay=1&agentharness=1&seed=0`, { waitUntil: 'load' }),
    tsPage.goto(`${BASE_URL}?anttest=agent&scenario=${scenario}&difficulty=normal`, { waitUntil: 'load' }),
  ]);

  await Promise.all([
    wasmPage.waitForFunction(() => {
      try {
        const M = (window as any).Module;
        return M?.ccall && JSON.parse(M.ccall('agent_get_state','string',[],[])).units?.length > 0;
      } catch { return false; }
    }, { timeout: 180_000, polling: 2000 }),
    tsPage.waitForFunction(() => (window as any).__agentReady === true, { timeout: 120_000, polling: 1000 }),
  ]);

  const getWasmTeams = async (): Promise<Team[]> => {
    return wasmPage.evaluate(() => {
      const M = (window as any).Module;
      const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
      return s.teams ?? [];
    });
  };

  const getTsTeams = async () => {
    return tsPage.evaluate(() => (window as any).__agentTeams?.() ?? []);
  };

  const stepBoth = async () => {
    await Promise.all([
      wasmPage.evaluate(async () => { const r = (window as any).__agentStep(1); if (r?.then) await r; }),
      tsPage.evaluate(() => { (window as any).__agentStep?.(1); }),
    ]);
  };

  const wasmSeed = await wasmPage.evaluate(() => {
    const M = (window as any).Module;
    return JSON.parse(M.ccall('agent_get_state','string',[],[])).rngState;
  });
  await tsPage.evaluate((s: number) => { (window as any).__syncRngSeed?.(s); }, wasmSeed);

  // At tick 0 — get infantry state from both engines
  const wasmInfTick0 = await wasmPage.evaluate(() => {
    const M = (window as any).Module;
    const s = JSON.parse(M.ccall('agent_get_state','string',[],[]));
    const all = [...(s.units ?? []), ...(s.enemies ?? [])];
    return all.filter((e: { t: string; house: string }) =>
      e.house === 'USSR' && (e.t === 'E1' || e.t === 'DOG' || e.t === 'E2'),
    );
  });
  console.log(`\n=== WASM USSR infantry at tick 0 (${wasmInfTick0.length}) ===`);
  for (const e of wasmInfTick0) {
    console.log(`  ${JSON.stringify(e)}`);
  }

  for (let step = 1; step <= steps; step++) {
    await stepBoth();
    const [wasmTeams, tsTeams] = await Promise.all([getWasmTeams(), getTsTeams()]);
    console.log(`\n=== After step ${step} (tick=${step}) ===`);
    console.log(`WASM teams (${wasmTeams.length}):`);
    for (const t of wasmTeams) {
      const mems = t.members.map(m => `${m.type}:${m.have}/${m.want}[${(m.ids ?? []).join(',')}]`).join(',');
      console.log(`  [${t.i}] ${t.cls} h=${t.house} tot=${t.total}/${t.desired} fs=${t.fs} us=${t.us} fa=${t.fa} mv=${t.mv} hb=${t.hb} rf=${t.rf} alt=${t.alt} mem={${mems}}`);
    }
    console.log(`TS teams (${tsTeams.length}):`);
    for (const t of tsTeams as Array<{ i: number; id: number; house: string; members: number; memberTypes?: string[]; isMoving: boolean; isFullStrength: boolean; isForcedActive: boolean; isUnderStrength: boolean; isReforming: boolean; desired?: string[] }>) {
      console.log(`  [${t.i}] id=${t.id} h=${t.house} mem=${t.members} types=${(t.memberTypes ?? []).join(',')} fs=${t.isFullStrength} us=${t.isUnderStrength} fa=${t.isForcedActive} mv=${t.isMoving} rf=${t.isReforming} des=${(t.desired ?? []).join(',')}`);
    }
  }

  await wasmCtx.close();
  await tsCtx.close();
});
