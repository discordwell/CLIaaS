/**
 * C++ Behavioral Parity: Infantry Scatter (Issue #16)
 *
 * Tests verify scatter behavior matches C++ RA infantry.cpp:1852-1929.
 *
 * C++ source of truth: InfantryClass::Scatter(COORDINATE threat, bool forced, bool nokidding)
 *  - Line 1860: IsDriving → forced = false
 *  - Line 1866: MissionControl[Mission].IsScatter required (or forced)
 *  - Line 1872: Non-FraidyCat with valid target doesn't scatter (unless forced)
 *  - Line 1885: Must be forced OR IsFraidyCat to execute
 *  - Line 1888-1900: Direction away from threat with random +-2 facing offset
 *  - Line 1905-1915: Try 8 directions starting from away-direction
 *  - Line 1924-1927: Assign MOVE mission to best passable cell
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Dir, Mission,
  UNIT_STATS, MISSION_CONTROL, DIR_DX, DIR_DY, DIR_COUNT,
  buildDefaultAlliances,
pixelToLepton, } from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  aiScatterOnDamage,
} from '../engine/combat';
import { GameMap, Terrain } from '../engine/map';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(
  entities: Entity[] = [],
): CombatContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures: [],
    inflightProjectiles: [],
    effects: [] as Effect[],
    tick: 0,
    playerHouse: House.Spain,
    scenarioId: 'TEST',
    killCount: 0,
    lossCount: 0,
    warheadOverrides: {},
    scenarioWarheadMeta: {},
    scenarioWarheadProps: {},
    attackedTriggerNames: new Set<string>(),
    map,
    isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
    entitiesAllied: (a: Entity, b: Entity) => alliances.get(a.house)?.has(b.house) ?? false,
    isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Spain) ?? false,
    playSoundAt: () => {},
    playEva: () => {},
    minimapAlert: () => {},
    isRevealedToHouse: () => true,
    movementSpeed: () => 1,
    getFirepowerBias: () => 1.0,
    getArmorBias: () => 1.0,
    getROFBias: () => 1.0,
    damageStructure: () => false,
    aiIQ: () => 3,
    warheadMuzzleColor: () => '#fff',
    aiStates: new Map(),
    lastBaseAttackEva: -Infinity,
    gameTicksPerSec: 15,
    gapGeneratorCells: new Map(),
    nBuildingsDestroyedCount: 0,
    structuresLost: 0,
    bridgeCellCount: 0,
    clearStructureFootprint: () => {},
    recalculateSiloCapacity: () => {},
    showEvaMessage: () => {},
    screenShake: 0,
    screenFlash: 0,
    powerConsumed: 0,
    powerProduced: 100,
  } as CombatContext;
}

/** Compute the 8-direction from one cell center to another */
function cellDir(fromCX: number, fromCY: number, toCX: number, toCY: number): Dir {
  const dx = toCX - fromCX;
  const dy = toCY - fromCY;
  const angle = Math.atan2(dy, dx);
  const octant = Math.round(((angle + Math.PI) / (Math.PI * 2)) * 8) % 8;
  return ((octant + 6) % 8) as Dir;
}

/** Opposite direction (add 4 mod 8) */
function oppositeDir(d: Dir): Dir {
  return ((d + 4) % 8) as Dir;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('Infantry directional scatter (C++ infantry.cpp:1852-1929)', () => {

  // C++ infantry.cpp:1888-1890 — direction from threat to infantry, with +-2 offset
  it('infantry scatters AWAY from threat direction', () => {
    // Attacker is to the SOUTH of infantry → infantry should scatter NORTH-ish
    const infantry = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    infantry.mission = Mission.GUARD;
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 10, 13); // 3 cells south

    // Run many times; collect scatter directions
    const scatterDirs = new Set<Dir>();
    for (let i = 0; i < 200; i++) {
      const e = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
      e.mission = Mission.GUARD;
      const ctx = makeCombatCtx([e]);
      aiScatterOnDamage(ctx, e, attacker);
      if (e.moveTarget) {
        const targetCX = Math.floor(e.moveTarget.lx / 256);
        const targetCY = Math.floor(e.moveTarget.ly / 256);
        const dir = cellDir(10, 10, targetCX, targetCY);
        scatterDirs.add(dir);
      }
    }

    // Away-from-south = north (Dir.N = 0). With +-2 offset, possible dirs are NW, NW, N, NE, E
    // i.e., Dir values: 6, 7, 0, 1, 2 (wrapping around)
    // Most scatters should be in the northern arc
    expect(scatterDirs.has(Dir.N) || scatterDirs.has(Dir.NE) || scatterDirs.has(Dir.NW)).toBe(true);
    // Should NOT consistently scatter south (toward threat)
    // If S is present, it's only because the northern cells were blocked (shouldn't happen on open map)
    // The primary scatter direction should be away from threat
  });

  // C++ infantry.cpp:1890 — Random_Pick(0,4)-2 gives +-2 offset
  it('scatter direction has randomness (+-2 facing offset)', () => {
    // With attacker to the east, away = west (Dir.W = 6)
    // With +-2 offset: SW(5), W(6), NW(7), N(0... wait no, that's +2 from 6 = 0 which is N)
    // Actually: 6-2=4(S), 6-1=5(SW), 6+0=6(W), 6+1=7(NW), 6+2=0(N)
    // Wait, ((6+offset)%8+8)%8 for offset in [-2,-1,0,1,2]:
    //   6-2=4→S, 6-1=5→SW, 6→W, 7→NW, 0→N
    // So possible away-directions: S, SW, W, NW, N
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 15, 10); // east

    const scatterDirs = new Set<Dir>();
    for (let i = 0; i < 300; i++) {
      const e = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
      e.mission = Mission.GUARD;
      const ctx = makeCombatCtx([e]);
      aiScatterOnDamage(ctx, e, attacker);
      if (e.moveTarget) {
        const targetCX = Math.floor(e.moveTarget.lx / 256);
        const targetCY = Math.floor(e.moveTarget.ly / 256);
        scatterDirs.add(cellDir(10, 10, targetCX, targetCY));
      }
    }

    // Should have more than 1 unique direction (randomness in +-2 offset)
    expect(scatterDirs.size).toBeGreaterThan(1);
  });

  // C++ infantry.cpp:1905-1915 — try directions in order, skip impassable
  it('infantry blocked in away direction tries other cells', () => {
    // Place infantry at cell (1, 1), attacker to east at (5, 1)
    // Block the west cell (0, 1) — away direction
    const e = entityAtCell(UnitType.I_E1, House.USSR, 1, 1);
    e.mission = Mission.GUARD;

    const ctx = makeCombatCtx([e]);
    // Block cell (0, 1) which is directly west
    ctx.map.setTerrain(0, 1, Terrain.ROCK); // impassable

    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 5, 1); // east

    // With attacker to east, away = west (Dir.W=6), offset could shift +-2
    // If direct west is blocked, it should try the next directions in order
    let scattered = false;
    for (let i = 0; i < 100; i++) {
      const te = entityAtCell(UnitType.I_E1, House.USSR, 1, 1);
      te.mission = Mission.GUARD;
      const tctx = makeCombatCtx([te]);
      tctx.map.setTerrain(0, 1, Terrain.ROCK); // block west cell

      aiScatterOnDamage(tctx, te, attacker);
      if (te.moveTarget) {
        scattered = true;
        // The target should NOT be cell (0,1) since it's blocked
        const tcx = Math.floor(te.moveTarget.lx / 256);
        const tcy = Math.floor(te.moveTarget.ly / 256);
        expect(tcx !== 0 || tcy !== 1).toBe(true);
      }
    }
    expect(scattered).toBe(true);
  });

  // Non-infantry uses old random scatter, not directional
  it('non-infantry units use random scatter (not directional)', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    tank.mission = Mission.GUARD;
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 10, 15); // south

    // Run many times; non-infantry should still scatter but with random directions
    const scatterDirs = new Set<Dir>();
    let scatterCount = 0;
    for (let i = 0; i < 200; i++) {
      const t = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
      t.mission = Mission.GUARD;
      const ctx = makeCombatCtx([t]);
      aiScatterOnDamage(ctx, t, attacker);
      if (t.moveTarget) {
        scatterCount++;
        const tcx = Math.floor(t.moveTarget.lx / 256);
        const tcy = Math.floor(t.moveTarget.ly / 256);
        scatterDirs.add(cellDir(10, 10, tcx, tcy));
      }
    }
    // Non-infantry should scatter (at least sometimes — random dx/dy can be 0,0)
    expect(scatterCount).toBeGreaterThan(0);
    // Should have multiple directions (random, not directional)
    expect(scatterDirs.size).toBeGreaterThan(1);
  });

  // C++ infantry.cpp:1860 — IsDriving → forced=false; line 1885 — !forced && !FraidyCat → skip
  it('already-moving infantry (IsDriving) does not scatter unless FraidyCat', () => {
    // E1 is not FraidyCat — should NOT scatter when already driving
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    e1.mission = Mission.MOVE;
    e1.moveTarget = { lx: pixelToLepton(15 * CELL_SIZE), ly: pixelToLepton(10 * CELL_SIZE) }; // already moving east

    const origTarget = { ...e1.moveTarget };
    const ctx = makeCombatCtx([e1]);
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 10, 15);
    aiScatterOnDamage(ctx, e1, attacker);

    // Should keep original move target (not scattered)
    expect(e1.moveTarget!.lx).toBe(origTarget.lx);
    expect(e1.moveTarget!.ly).toBe(origTarget.ly);
  });

  // C++ infantry.cpp:1860,1885 — IsDriving=true, forced=false, but IsFraidyCat=true → still scatters
  it('already-moving FraidyCat infantry CAN still scatter', () => {
    // C1 civilian IS FraidyCat — should scatter even when driving
    let scattered = false;
    for (let i = 0; i < 100; i++) {
      const c1 = entityAtCell(UnitType.I_C1, House.USSR, 10, 10);
      c1.mission = Mission.MOVE;
      c1.moveTarget = { lx: pixelToLepton(15 * CELL_SIZE), ly: pixelToLepton(10 * CELL_SIZE) };
      const ctx = makeCombatCtx([c1]);
      const attacker = entityAtCell(UnitType.I_E1, House.Spain, 10, 15);
      aiScatterOnDamage(ctx, c1, attacker);
      // FraidyCat with moveTarget: forced=false, but isFraidyCat check at line 1885 passes
      // MISSION_CONTROL[MOVE].isScatter is true, so line 1866 passes
      // c1.target is null, so line 1872 passes
      if (c1.moveTarget!.lx !== 15 * 256 + 128 || c1.moveTarget!.ly !== 10 * 256 + 128) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  // ATTACK has isScatter=true (C++ default, no INI override) — infantry CAN scatter
  it('infantry on ATTACK mission CAN scatter (isScatter=true per C++ defaults)', () => {
    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
      e1.mission = Mission.ATTACK;
      const ctx = makeCombatCtx([e1]);
      const attacker = entityAtCell(UnitType.I_E1, House.Spain, 10, 15);
      aiScatterOnDamage(ctx, e1, attacker);
      if (e1.mission === Mission.MOVE && e1.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  // C++ infantry.cpp:1883 — player-controlled units don't scatter
  it('player-controlled infantry does NOT scatter', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    e1.mission = Mission.GUARD;

    const ctx = makeCombatCtx([e1]);
    const attacker = entityAtCell(UnitType.I_E1, House.USSR, 10, 15);
    aiScatterOnDamage(ctx, e1, attacker);

    expect(e1.mission).toBe(Mission.GUARD);
    expect(e1.moveTarget).toBeNull();
  });

  // C++ infantry.cpp:1872 — non-FraidyCat with valid target doesn't scatter when not forced
  it('non-FraidyCat infantry with combat target and IsDriving does not scatter', () => {
    const e1 = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    e1.mission = Mission.MOVE;
    e1.moveTarget = { lx: pixelToLepton(15 * CELL_SIZE), ly: pixelToLepton(10 * CELL_SIZE) };
    e1.target = entityAtCell(UnitType.I_E1, House.Spain, 12, 10); // has a combat target

    const origTarget = { ...e1.moveTarget };
    const ctx = makeCombatCtx([e1]);
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 10, 15);
    aiScatterOnDamage(ctx, e1, attacker);

    // IsDriving → forced=false; !FraidyCat && target!=null && !forced → return
    expect(e1.moveTarget!.lx).toBe(origTarget.lx);
    expect(e1.moveTarget!.ly).toBe(origTarget.ly);
  });

  // Verify IsFraidyCat is set correctly on civilians
  it('civilians have isFraidyCat=true (rules.ini Fraidycat=yes)', () => {
    expect(UNIT_STATS.C1.isFraidyCat).toBe(true);
    expect(UNIT_STATS.C2.isFraidyCat).toBe(true);
    expect(UNIT_STATS.C3.isFraidyCat).toBe(true);
    expect(UNIT_STATS.C10.isFraidyCat).toBe(true);
    expect(UNIT_STATS.EINSTEIN.isFraidyCat).toBe(true);
    // THF (Thief) does NOT have Fraidycat=yes in rules.ini — rules.ini is God
    expect(UNIT_STATS.THF.isFraidyCat).toBeFalsy();
  });

  it('combat infantry do NOT have isFraidyCat (rules.ini default)', () => {
    expect(UNIT_STATS.E1.isFraidyCat).toBeFalsy();
    expect(UNIT_STATS.E2.isFraidyCat).toBeFalsy();
    expect(UNIT_STATS.E3.isFraidyCat).toBeFalsy();
    expect(UNIT_STATS.E4.isFraidyCat).toBeFalsy();
  });

  // MISSION_CONTROL[GUARD].isScatter is true — infantry on GUARD should scatter
  it('infantry on GUARD scatters (MISSION_CONTROL.isScatter=true)', () => {
    expect(MISSION_CONTROL[Mission.GUARD].isScatter).toBe(true);

    let scattered = false;
    for (let i = 0; i < 50; i++) {
      const e = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
      e.mission = Mission.GUARD;
      const ctx = makeCombatCtx([e]);
      aiScatterOnDamage(ctx, e);
      if (e.mission === Mission.MOVE && e.moveTarget !== null) {
        scattered = true;
        break;
      }
    }
    expect(scattered).toBe(true);
  });

  // Without attacker, scatter uses entity facing (C++ infantry.cpp:1897)
  it('scatter without threat source uses entity facing direction', () => {
    const e = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    e.mission = Mission.GUARD;
    e.facing = Dir.E; // facing east

    // Without an attacker, scatter should go in facing direction (east-ish) with +-2 offset
    const scatterDirs = new Set<Dir>();
    for (let i = 0; i < 200; i++) {
      const te = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
      te.mission = Mission.GUARD;
      te.facing = Dir.E;
      const ctx = makeCombatCtx([te]);
      aiScatterOnDamage(ctx, te); // no attacker
      if (te.moveTarget) {
        const tcx = Math.floor(te.moveTarget.lx / 256);
        const tcy = Math.floor(te.moveTarget.ly / 256);
        scatterDirs.add(cellDir(10, 10, tcx, tcy));
      }
    }
    // Dir.E = 2, offset +-2 → dirs 0(N),1(NE),2(E),3(SE),4(S)
    // Should predominantly scatter east-ish
    expect(scatterDirs.has(Dir.E) || scatterDirs.has(Dir.NE) || scatterDirs.has(Dir.SE)).toBe(true);
  });

  // Non-infantry on non-GUARD mission doesn't scatter at all
  it('non-infantry on ATTACK mission does not scatter', () => {
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    tank.mission = Mission.ATTACK;

    const ctx = makeCombatCtx([tank]);
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 10, 15);
    aiScatterOnDamage(ctx, tank, attacker);

    expect(tank.mission).toBe(Mission.ATTACK);
    expect(tank.moveTarget).toBeNull();
  });

  // AI IQ < 2 should prevent scatter
  it('AI with IQ < 2 does not scatter', () => {
    const e = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    e.mission = Mission.GUARD;

    const ctx = makeCombatCtx([e]);
    ctx.aiIQ = () => 1; // low IQ
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 10, 15);
    aiScatterOnDamage(ctx, e, attacker);

    expect(e.mission).toBe(Mission.GUARD);
    expect(e.moveTarget).toBeNull();
  });
});

// C++ parity: Scatter fires exactly once per damage event (infantry.cpp:438-440)
describe('Single-scatter invariant (no double-scatter regression)', () => {
  it('damageEntity on idle infantry fires exactly 1 scatter RNG', async () => {
    // Verifies the fix for 2a99bce6 follow-up: TS previously had scatter code
    // in BOTH damageEntity() (via aiScatterOnDamage) AND updateAttack() (via a
    // duplicate scatterInfantry helper). C++ InfantryClass::Take_Damage calls
    // Scatter(source_coord) ONCE (infantry.cpp:439). The TS attack-damage code
    // path must also consume exactly 1 scatter RNG, not 2.
    const { ScenarioRandom } = await import('../engine/random');
    const { damageEntity } = await import('../engine/combat');

    const victim = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    victim.mission = Mission.GUARD; // isScatter=true, no TarCom
    victim.target = null; // idle — will pass the fraidyCat-or-target guard
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 10, 15);
    const ctx = makeCombatCtx([victim, attacker]);

    const before = ScenarioRandom.callCount;
    damageEntity(ctx, victim, 5, 'SA', attacker);
    const consumed = ScenarioRandom.callCount - before;

    // Expected: 1 RNG for scatter direction (Random_Pick(0,4)). If the duplicate
    // scatterInfantry helper is re-introduced, this will jump to 2.
    expect(consumed).toBe(1);
  });

  it('damageEntity on combat infantry (with target) fires 0 scatter RNGs', async () => {
    // C++ infantry.cpp:1887 — non-FraidyCat with valid TarCom doesn't scatter.
    // Both the aiScatterOnDamage guard (combat.ts:376) and the C++ rule match.
    const { ScenarioRandom } = await import('../engine/random');
    const { damageEntity } = await import('../engine/combat');

    const victim = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    victim.mission = Mission.ATTACK;
    const aTarget = entityAtCell(UnitType.I_E1, House.Spain, 12, 10);
    victim.target = aTarget; // combat-engaged → scatter skipped
    const attacker = entityAtCell(UnitType.I_E1, House.Spain, 10, 15);
    const ctx = makeCombatCtx([victim, aTarget, attacker]);

    const before = ScenarioRandom.callCount;
    damageEntity(ctx, victim, 5, 'SA', attacker);
    const consumed = ScenarioRandom.callCount - before;

    expect(consumed).toBe(0);
  });
});
