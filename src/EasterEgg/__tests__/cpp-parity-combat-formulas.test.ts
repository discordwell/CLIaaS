/**
 * C++ Behavioral Parity: Combat Formulas — Splash Falloff, Prone Reduction,
 * Friendly Fire Exclusion, Wall Destruction, Ore Destruction, Damage Clamping,
 * Firepower Bias, Difficulty Modifiers, and Iron Curtain Invulnerability.
 *
 * C++ sources of truth:
 *   - combat.cpp:107-130  — Modify_Damage: distance-based splash falloff curve
 *   - combat.cpp:72-90    — Modify_Damage: prone damage bias (ProneDamageBias=0.5)
 *   - combat.cpp:207      — Explosion_Damage: splash excludes firer (source), not target
 *   - combat.cpp:244-270  — Explosion_Damage: wall/ore destruction by warhead flags
 *   - combat.cpp:127      — Modify_Damage: MAX_DAMAGE=1000 clamp
 *   - house.cpp:289,299   — FirepowerBias = country bias * difficulty bias
 *   - house.cpp:292,302   — ArmorBias = country bias * difficulty bias
 *   - house.cpp:2751      — Iron Curtain invulnerability (structures)
 *   - infantry.cpp:329-330 — ProneDamageBias applied in TakeDamage
 *   - entity.ts:518       — isInvulnerable: ironCurtainTick > 0 || invulnTick > 0
 *   - rules.cpp:202       — PRONE_DAMAGE_BIAS = 0.5
 *   - rules.cpp:227       — MAX_DAMAGE = 1000
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, WEAPON_STATS,
  buildDefaultAlliances, Mission, AnimState,
  COUNTRY_BONUSES, modifyDamage, MAX_DAMAGE,
  WARHEAD_META, WARHEAD_VS_ARMOR, PRONE_DAMAGE_BIAS,
  type WarheadType, type ArmorType,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  applySplashDamage,
  damageEntity,
  structureDamage,
  getWarheadMult,
  getWarheadMeta,
  SPLASH_RADIUS,
} from '../engine/combat';
import { GameMap, Terrain } from '../engine/map';
import type { MapStructure } from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(
  entities: Entity[] = [],
  structures: MapStructure[] = [],
  overrides: Partial<CombatContext> = {},
): CombatContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities,
    entityById: new Map(entities.map(e => [e.id, e])),
    structures,
    inflightProjectiles: [],
    effects: [] as Effect[],
    tick: 0,
    playerHouse: House.Spain,
    scenarioId: 'TEST',
    killCount: 0,
    lossCount: 0,
    pointTotal: 0,
    alliedUnitsLost: 0,
    sovietUnitsLost: 0,
    alliedBuildingsLost: 0,
    sovietBuildingsLost: 0,
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
    getFirepowerBias: (house: House) => COUNTRY_BONUSES[house]?.firepowerMult ?? 1.0,
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
    ...overrides,
  } as CombatContext;
}

// ============================================================
// Section 1: Splash damage falloff curve — C++ combat.cpp:107-130
// ============================================================
//
// C++ Modify_Damage formula (combat.cpp:106-130):
//   if (spreadFactor == 0) distFactor = distPixels * 5
//   else distFactor = distPixels * 2 / spreadFactor
//   distFactor = clamp(distFactor, 0, 16)
//   if (distFactor > 0) damage = damage / distFactor
//   if (distFactor < 4) damage = max(damage, 1)   [MinDamage guarantee]
//   damage = min(damage, MAX_DAMAGE)
//
// The TS implementation uses this same formula in modifyDamage().

describe('Splash damage falloff curve (combat.cpp:107-130)', () => {

  // HE warhead: spread=6, vs none armor: mult=0.9
  // At distance 0: distFactor=0 → no division → full damage
  it('HE at distance 0: full damage (no falloff)', () => {
    const result = modifyDamage(100, 'HE', 'none', 0);
    // C++: damage = 100 * 0.9 = 90; distFactor=0 (skip division); min check: max(90,1)=90
    expect(result).toBe(90);
  });

  // At 1 pixel distance with HE spread=6: distFactor = floor(1*2/6) = floor(0.33) = 0
  it('HE at 1px: distFactor floors to 0, full damage', () => {
    const result = modifyDamage(100, 'HE', 'none', 1);
    // distFactor = floor(1*2/6) = 0; damage = 90; max(90,1) = 90
    expect(result).toBe(90);
  });

  // At 6 pixels: distFactor = floor(6*2/6) = floor(2) = 2
  it('HE at 6px: distFactor=2, damage halved', () => {
    const result = modifyDamage(100, 'HE', 'none', 6);
    // distFactor = floor(6*2/6) = 2; damage = 90/2 = 45; distFactor<4 → max(45,1)=45
    expect(result).toBe(45);
  });

  // At 12 pixels: distFactor = floor(12*2/6) = floor(4) = 4
  it('HE at 12px: distFactor=4, quarter damage', () => {
    const result = modifyDamage(100, 'HE', 'none', 12);
    // distFactor = 4; C++ integer damage = 90/4 -> 22
    // distFactor=4 (NOT < 4) → MinDamage does NOT apply
    expect(result).toBe(22);
  });

  // At 24 pixels (1 cell): distFactor = floor(24*2/6) = floor(8) = 8
  it('HE at 24px (1 cell): distFactor=8', () => {
    const result = modifyDamage(100, 'HE', 'none', 24);
    // damage = 90/8 = 11.25 → 11
    expect(result).toBe(11);
  });

  // At 36 pixels (1.5 cells, splash edge): distFactor = floor(36*2/6) = floor(12) = 12
  it('HE at 36px (1.5 cells): distFactor=12', () => {
    const result = modifyDamage(100, 'HE', 'none', 36);
    // C++ integer damage = 90/12 -> 7
    expect(result).toBe(7);
  });

  // At 48 pixels (2 cells): distFactor = floor(48*2/6) = floor(16) = 16 (clamped)
  it('HE at 48px (2 cells): distFactor=16 (max clamp)', () => {
    const result = modifyDamage(100, 'HE', 'none', 48);
    // C++ integer damage = 90/16 -> 5
    expect(result).toBe(5);
  });

  // Beyond max clamp: distFactor stays at 16 regardless of distance
  it('HE at 96px: distFactor still 16 (clamped), same as 48px', () => {
    const dmgAt48 = modifyDamage(100, 'HE', 'none', 48);
    const dmgAt96 = modifyDamage(100, 'HE', 'none', 96);
    // Both clamp to distFactor=16 → same damage
    expect(dmgAt96).toBe(dmgAt48);
  });

  // AP warhead: spread=3, vs heavy armor: mult=1.0
  // At 12px: distFactor = floor(12*2/3) = 8
  it('AP spread=3 at 12px vs heavy: distFactor=8', () => {
    const result = modifyDamage(100, 'AP', 'heavy', 12);
    // C++ integer damage = 100 / 8 -> 12
    expect(result).toBe(12);
  });

  // Fire warhead: spread=8, vs wood: mult=1.0
  // At 12px: distFactor = floor(12*2/8) = floor(3) = 3
  it('Fire spread=8 at 12px vs wood: distFactor=3', () => {
    const result = modifyDamage(100, 'Fire', 'wood', 12);
    // damage = 100 * 1.0 / 3 = 33.33 → 33; distFactor<4 → max(33,1)=33
    expect(result).toBe(33);
  });

  // Organic warhead: spread=0 → distFactor = distPixels * 5
  // At 2px vs none (mult=1.0): distFactor = 2*5 = 10
  it('Organic spread=0 at 2px: distFactor = 2*5 = 10 (rapid falloff)', () => {
    const result = modifyDamage(100, 'Organic', 'none', 2);
    // damage = 100 * 1.0 / 10 = 10
    expect(result).toBe(10);
  });

  // SA warhead: spread=3, vs none: mult=1.0
  // At 3px: distFactor = floor(3*2/3) = floor(2) = 2
  it('SA spread=3 at 3px: distFactor=2, half damage', () => {
    const result = modifyDamage(100, 'SA', 'none', 3);
    // damage = 100 * 1.0 / 2 = 50; distFactor<4 → max(50,1)=50
    expect(result).toBe(50);
  });
});

// ============================================================
// Section 2: Prone damage reduction — C++ infantry.cpp:329-330
// ============================================================
//
// C++ infantry.cpp:329-330:
//   if (IsLaying) damage = Fixed_To_Cardinal(damage, Rule.ProneDamageBias);
// ProneDamageBias = fixed(1,2) = 0.5 (rules.cpp:202)
// Applied in Entity.takeDamage: if (isProne && amount > 0) amount *= PRONE_DAMAGE_BIAS

describe('Prone damage reduction (infantry.cpp:329-330)', () => {

  it('PRONE_DAMAGE_BIAS constant is 0.5', () => {
    expect(PRONE_DAMAGE_BIAS).toBe(0.5);
  });

  it('prone infantry takes half damage', () => {
    const infantry = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    infantry.isProne = true;
    const hpBefore = infantry.hp;
    infantry.takeDamage(100);
    const damageTaken = hpBefore - infantry.hp;
    // C++ applies 0.5 multiplier: round(100 * 0.5) = 50
    expect(damageTaken).toBe(50);
  });

  it('standing infantry takes full damage', () => {
    const infantry = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    infantry.isProne = false;
    const hpBefore = infantry.hp;
    // Use damage less than maxHp (E1 has 50 HP) to avoid clamping by death
    infantry.takeDamage(30);
    const damageTaken = hpBefore - infantry.hp;
    expect(damageTaken).toBe(30);
  });

  it('prone damage minimum is 1 (never reduces to 0)', () => {
    const infantry = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    infantry.isProne = true;
    const hpBefore = infantry.hp;
    // 1 damage * 0.5 = 0.5 → max(1, round(0.5)) = max(1, 1) = 1
    infantry.takeDamage(1);
    const damageTaken = hpBefore - infantry.hp;
    expect(damageTaken).toBe(1);
  });

  it('prone reduces 50 damage to 25', () => {
    const infantry = entityAtCell(UnitType.I_E1, House.Spain, 10, 10);
    infantry.isProne = true;
    const hpBefore = infantry.hp;
    infantry.takeDamage(50);
    const damageTaken = hpBefore - infantry.hp;
    // round(50 * 0.5) = 25
    expect(damageTaken).toBe(25);
  });
});

// ============================================================
// Section 3: Friendly fire / splash exclusion — combat.cpp:207
// ============================================================
//
// C++ combat.cpp:207 (Explosion_Damage):
//   The firer (source) is excluded from its own splash damage.
//   The direct-hit TARGET is NOT excluded — it receives splash damage at distance ~0.
//   Friendly units in the splash radius DO take damage (no house exclusion).
//
// TS: applySplashDamage excludes sourceId (attacker.id), not the target.

describe('Friendly fire / splash exclusion (combat.cpp:207)', () => {

  it('attacker is excluded from its own splash damage', () => {
    const attacker = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10); // same cell
    const ctx = makeCombatCtx([attacker, target]);

    const attackerHpBefore = attacker.hp;
    applySplashDamage(
      ctx,
      attacker.pos,  // splash centered on attacker's position
      { damage: 100, warhead: 'HE', splash: 1.5 },
      -1, attacker.house, attacker,
    );

    // Attacker should take 0 damage (excluded as source)
    expect(attacker.hp).toBe(attackerHpBefore);
    // Target should take damage (in splash radius, not excluded)
    expect(target.hp).toBeLessThan(target.maxHp);
  });

  it('friendly units in splash radius DO take damage (no house exclusion)', () => {
    const attacker = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    const friendly = entityAtCell(UnitType.I_E1, House.Spain, 10, 11); // 1 cell away, allied
    const enemy = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([attacker, friendly, enemy]);

    const friendlyHpBefore = friendly.hp;
    applySplashDamage(
      ctx,
      enemy.pos,
      { damage: 100, warhead: 'HE', splash: 1.5 },
      -1, attacker.house, attacker,
    );

    // Friendly infantry within splash range takes damage (C++ Explosion_Damage hits all houses)
    expect(friendly.hp).toBeLessThan(friendlyHpBefore);
  });
});

// ============================================================
// Section 4: Wall destruction via splash — combat.cpp:244-270
// ============================================================
//
// C++ combat.cpp:244-270:
//   Warheads with Wall=yes (IsWallDestroyer) can destroy walls in the splash radius.
//   From WARHEAD_META: HE and AP have destroysWalls=true; Fire does NOT.
//   Wall types: SBAG, FENC, BRIK, BARB, WOOD, CYCL

describe('Wall destruction via splash (combat.cpp:244-270)', () => {

  it('HE warhead has destroysWalls=true', () => {
    expect(WARHEAD_META.HE.destroysWalls).toBe(true);
  });

  it('AP warhead has destroysWalls=true', () => {
    expect(WARHEAD_META.AP.destroysWalls).toBe(true);
  });

  it('Fire warhead does NOT have destroysWalls', () => {
    expect(WARHEAD_META.Fire.destroysWalls).toBeFalsy();
  });

  it('SA warhead does NOT have destroysWalls', () => {
    expect(WARHEAD_META.SA.destroysWalls).toBeFalsy();
  });

  it('HE splash damages a brick wall level at the impact cell', () => {
    const attacker = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 10);
    const ctx = makeCombatCtx([attacker]);

    // Place a wall at (10, 10) — center of splash
    ctx.map.setWallType(10, 10, 'BRIK');
    expect(ctx.map.getWallType(10, 10)).toBe('BRIK');

    applySplashDamage(
      ctx,
      { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 },
      { damage: 100, warhead: 'HE', splash: 1.5 },
      -1, attacker.house, attacker,
    );

    // BRIK has three visual damage levels in odata.cpp. A single 100-damage HE
    // impact reduces it once but does not clear the overlay yet.
    expect(ctx.map.getWallType(10, 10)).toBe('BRIK');
    expect(ctx.map.getWallDamageLevel(10, 10)).toBe(1);

    applySplashDamage(
      ctx,
      { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 },
      { damage: 100, warhead: 'HE', splash: 1.5 },
      -1, attacker.house, attacker,
    );

    // C++ clears a wall at the next-to-last damage level when the shape index
    // low nibble is 0, which is the default for newly placed wall overlays.
    expect(ctx.map.getWallType(10, 10)).toBe('');
  });

  it('SA splash does NOT destroy walls (no destroysWalls flag)', () => {
    const attacker = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 10);
    const ctx = makeCombatCtx([attacker]);

    ctx.map.setWallType(10, 10, 'BRIK');
    applySplashDamage(
      ctx,
      { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 },
      { damage: 100, warhead: 'SA', splash: 1.5 },
      -1, attacker.house, attacker,
    );

    // Wall should still be intact — SA cannot destroy walls
    expect(ctx.map.getWallType(10, 10)).toBe('BRIK');
  });

  it('wall types SBAG, FENC, BARB, WOOD are all destroyable by HE', () => {
    const wallTypes = ['SBAG', 'FENC', 'BARB', 'WOOD'];
    for (const wallType of wallTypes) {
      const attacker = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 10);
      const ctx = makeCombatCtx([attacker]);
      ctx.map.setWallType(10, 10, wallType);

      applySplashDamage(
        ctx,
        { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 },
        { damage: 100, warhead: 'HE', splash: 1.5 },
        -1, attacker.house, attacker,
      );

      expect(ctx.map.getWallType(10, 10), `${wallType} should be destroyed by HE`).toBe('');
    }
  });
});

// ============================================================
// Section 5: Ore destruction via warhead — combat.cpp
// ============================================================
//
// C++ RULES.INI: Only Nuke warhead has Ore=yes (IsTiberiumDestroyer).
// HE does NOT destroy ore. This was fixed earlier.
// From WARHEAD_META: Nuke has destroysOre=true; HE does NOT.

describe('Ore destruction via warhead (combat.cpp)', () => {

  it('Nuke warhead has destroysOre=true', () => {
    expect(WARHEAD_META.Nuke.destroysOre).toBe(true);
  });

  it('HE warhead does NOT have destroysOre', () => {
    // This is the critical parity check — HE should NOT destroy ore
    expect(WARHEAD_META.HE.destroysOre).toBeFalsy();
  });

  it('AP warhead does NOT have destroysOre', () => {
    expect(WARHEAD_META.AP.destroysOre).toBeFalsy();
  });

  it('Fire warhead does NOT have destroysOre', () => {
    expect(WARHEAD_META.Fire.destroysOre).toBeFalsy();
  });

  it('SA warhead does NOT have destroysOre', () => {
    expect(WARHEAD_META.SA.destroysOre).toBeFalsy();
  });

  it('Super warhead does NOT have destroysOre', () => {
    expect(WARHEAD_META.Super.destroysOre).toBeFalsy();
  });

  it('Nuke splash destroys ore density at impact', () => {
    const attacker = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 10);
    const ctx = makeCombatCtx([attacker]);

    // Place gold ore at (10, 10): visual variant 0x05 + density 5.
    // C++ Reduce_Tiberium decrements OverlayData (oreDensity), not Overlay.
    const oreIdx = 10 * 128 + 10;
    ctx.map.overlay[oreIdx] = 0x05;
    ctx.map.oreDensity[oreIdx] = 5;

    applySplashDamage(
      ctx,
      { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 },
      { damage: 100, warhead: 'Nuke', splash: 1.5 },
      -1, attacker.house, attacker,
    );

    // C++ Nuke warhead destroysOre → reduceOreLevel decrements oreDensity by 1.
    expect(ctx.map.oreDensity[oreIdx], 'oreDensity decremented').toBe(4);
  });

  it('HE splash does NOT destroy ore overlay', () => {
    const attacker = entityAtCell(UnitType.V_2TNK, House.Spain, 5, 10);
    const ctx = makeCombatCtx([attacker]);

    const oreIdx = 10 * 128 + 10;
    ctx.map.overlay[oreIdx] = 0x05;

    applySplashDamage(
      ctx,
      { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 },
      { damage: 100, warhead: 'HE', splash: 1.5 },
      -1, attacker.house, attacker,
    );

    // Ore should remain unchanged — HE has no destroysOre flag
    expect(ctx.map.overlay[oreIdx]).toBe(0x05);
  });
});

// ============================================================
// Section 6: Damage clamping — combat.cpp:127
// ============================================================
//
// C++ combat.cpp:127: damage = min(damage, Rule.MaxDamage)
// rules.cpp:227: MaxDamage = 1000

describe('Damage clamping (combat.cpp:127)', () => {

  it('MAX_DAMAGE constant is 1000', () => {
    expect(MAX_DAMAGE).toBe(1000);
  });

  it('modifyDamage clamps output at 1000 for Super warhead', () => {
    // Super vs none: mult=1.0, dist=0. Input 5000 → clamped to 1000
    const result = modifyDamage(5000, 'Super', 'none', 0);
    expect(result).toBe(1000);
  });

  it('modifyDamage clamps output at 1000 with house bias boost', () => {
    // 800 * 1.0 (mult) * 2.0 (houseBias) = 1600 → clamped to 1000
    const result = modifyDamage(800, 'Super', 'none', 0, 2.0);
    expect(result).toBe(1000);
  });

  it('damage just below 1000 is not clamped', () => {
    const result = modifyDamage(999, 'Super', 'none', 0);
    expect(result).toBe(999);
  });

  it('exactly 1000 passes through', () => {
    const result = modifyDamage(1000, 'Super', 'none', 0);
    expect(result).toBe(1000);
  });
});

// ============================================================
// Section 7: FirepowerBias — house.cpp:289,299
// ============================================================
//
// C++ house.cpp:289,299:
//   FirepowerBias = hptr->FirepowerBias * Rule.Diff[handicap].FirepowerBias
// Where hptr->FirepowerBias comes from the country definition in RULES.INI.
// Germany has FirepowerBias=1.1 (10% more damage).
//
// In modifyDamage, houseBias multiplies baseDamage * mult.

describe('FirepowerBias (house.cpp:289,299)', () => {

  it('Germany has 1.1x firepower bonus in COUNTRY_BONUSES', () => {
    expect(COUNTRY_BONUSES.Germany.firepowerMult).toBe(1.1);
  });

  it('Spain has 1.0x firepower (no bonus)', () => {
    expect(COUNTRY_BONUSES.Spain.firepowerMult).toBe(1.0);
  });

  it('USSR has 1.0x firepower (no bonus)', () => {
    expect(COUNTRY_BONUSES.USSR.firepowerMult).toBe(1.0);
  });

  it('England has 1.0x firepower (no bonus; England has armor bonus)', () => {
    expect(COUNTRY_BONUSES.England.firepowerMult).toBe(1.0);
  });

  it('Germany firepower bias increases damage by 10%', () => {
    // Base damage 100, SA vs none (mult=1.0), dist=0
    const normalDmg = modifyDamage(100, 'SA', 'none', 0, 1.0);
    const germanyDmg = modifyDamage(100, 'SA', 'none', 0, 1.1);
    // 100 * 1.0 * 1.0 = 100; 100 * 1.0 * 1.1 = 110
    expect(normalDmg).toBe(100);
    expect(germanyDmg).toBe(110);
  });

  it('firepower bias stacks with warhead multiplier', () => {
    // HE vs none (mult=0.9), bias=1.1 → damage = 100 * 0.9 * 1.1 = 99
    const result = modifyDamage(100, 'HE', 'none', 0, 1.1);
    expect(result).toBe(99);
  });

  it('firepower bias applied in damageEntity via combat context', () => {
    const target = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    // Override getFirepowerBias to return Germany's 1.1x for the attacker's house
    const ctx = makeCombatCtx([target], [], {
      getFirepowerBias: (house: House) => house === House.Germany ? 1.1 : 1.0,
    });

    // The firepower bias is applied in the caller (fireWeaponAt, updateStructureCombat),
    // NOT inside damageEntity. damageEntity applies armorBias only.
    // Verify the modifyDamage path works correctly for the formula.
    const whMult = getWarheadMult('SA', target.stats.armor, ctx.warheadOverrides);
    const germanDmg = modifyDamage(100, 'SA', target.stats.armor, 0, 1.1, whMult);
    const normalDmg = modifyDamage(100, 'SA', target.stats.armor, 0, 1.0, whMult);
    expect(germanDmg).toBeGreaterThan(normalDmg);
  });
});

// ============================================================
// Section 8: Difficulty damage modifiers — ai.ts difficulty mods
// ============================================================
//
// C++ house.cpp:289,299: FirepowerBias = country * Rule.Diff[handicap].FirepowerBias
// C++ house.cpp:292,302: ArmorBias = country * Rule.Diff[handicap].ArmorBias
//
// Difficulty mods (from ai.ts AI_DIFFICULTY_MODS):
//   easy:   firepowerBias=0.8, armorBias=0.8
//   normal: firepowerBias=1.0, armorBias=1.0
//   hard:   firepowerBias=1.2, armorBias=1.2
//
// The computer player gets these modifiers applied to both damage output (firepower)
// and damage resistance (armor). C++ reversal: easy computer = difficult setting, etc.

describe('Difficulty damage modifiers (house.cpp:289-303)', () => {

  it('easy difficulty: AI firepower=0.8, armor=0.8 (weaker, softer)', () => {
    // Easy AI does less damage (0.8x) and takes more damage (1/0.8 = 1.25x)
    const easyFirepower = modifyDamage(100, 'SA', 'none', 0, 0.8);
    expect(easyFirepower).toBe(80);
  });

  it('hard difficulty: AI firepower=1.2 (stronger)', () => {
    const hardFirepower = modifyDamage(100, 'SA', 'none', 0, 1.2);
    expect(hardFirepower).toBe(120);
  });

  it('normal difficulty: no modification', () => {
    const normalFirepower = modifyDamage(100, 'SA', 'none', 0, 1.0);
    expect(normalFirepower).toBe(100);
  });

  it('armorBias > 1 reduces incoming damage (hard AI takes less)', () => {
    // ArmorBias is applied in damageEntity: amount = round(amount / armorBias)
    // Hard AI: armorBias=1.2 → 24/1.2 = 20
    // Using V_3TNK (heavy tank, 400 HP) to avoid death clamping
    const target = entityAtCell(UnitType.V_3TNK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([target], [], {
      getArmorBias: (house: House) => house === House.USSR ? 1.2 : 1.0,
    });

    const hpBefore = target.hp;
    damageEntity(ctx, target, 24, 'SA');
    const damageTaken = hpBefore - target.hp;
    // C++ parity: amount = max(1, round(24 / 1.2)) = max(1, 20) = 20
    expect(damageTaken).toBe(20);
  });

  it('armorBias < 1 increases incoming damage (easy AI takes more)', () => {
    // Using V_3TNK (heavy tank, 400 HP) to avoid death clamping
    const target = entityAtCell(UnitType.V_3TNK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([target], [], {
      getArmorBias: (house: House) => house === House.USSR ? 0.8 : 1.0,
    });

    const hpBefore = target.hp;
    damageEntity(ctx, target, 80, 'SA');
    const damageTaken = hpBefore - target.hp;
    // amount = max(1, round(80 / 0.8)) = max(1, 100) = 100
    expect(damageTaken).toBe(100);
  });

  it('armorBias=1.0 means no modification (normal)', () => {
    // Using V_3TNK (heavy tank, 400 HP) to avoid death clamping
    const target = entityAtCell(UnitType.V_3TNK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([target], [], {
      getArmorBias: () => 1.0,
    });

    const hpBefore = target.hp;
    damageEntity(ctx, target, 100, 'SA');
    const damageTaken = hpBefore - target.hp;
    expect(damageTaken).toBe(100);
  });
});

// ============================================================
// Section 9: Iron Curtain invulnerability
// ============================================================
//
// C++ house.cpp:2751: Iron Curtain makes units/structures invulnerable.
// Entity: isInvulnerable = invulnTick > 0 || ironCurtainTick > 0
// Entity.takeDamage: if (this.isInvulnerable) return false;
// structureDamage: if (s.ironCurtainTicks && s.ironCurtainTicks > 0) return false;

describe('Iron Curtain invulnerability (house.cpp:2751)', () => {

  it('unit with ironCurtainTick > 0 takes 0 damage', () => {
    const unit = entityAtCell(UnitType.V_3TNK, House.USSR, 10, 10);
    unit.ironCurtainTick = 100; // 100 ticks of invulnerability
    const hpBefore = unit.hp;
    const killed = unit.takeDamage(500, 'HE');
    expect(killed).toBe(false);
    expect(unit.hp).toBe(hpBefore);
  });

  it('unit with invulnTick > 0 (crate) takes 0 damage', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.Spain, 10, 10);
    unit.invulnTick = 50;
    const hpBefore = unit.hp;
    const killed = unit.takeDamage(999, 'Super');
    expect(killed).toBe(false);
    expect(unit.hp).toBe(hpBefore);
  });

  it('unit with ironCurtainTick=0 takes normal damage', () => {
    const unit = entityAtCell(UnitType.V_3TNK, House.USSR, 10, 10);
    unit.ironCurtainTick = 0;
    const hpBefore = unit.hp;
    unit.takeDamage(100, 'HE');
    expect(unit.hp).toBe(hpBefore - 100);
  });

  it('isInvulnerable getter returns true when ironCurtainTick > 0', () => {
    const unit = entityAtCell(UnitType.V_3TNK, House.USSR, 10, 10);
    unit.ironCurtainTick = 1;
    expect(unit.isInvulnerable).toBe(true);
  });

  it('isInvulnerable getter returns false when both ticks are 0', () => {
    const unit = entityAtCell(UnitType.V_3TNK, House.USSR, 10, 10);
    unit.ironCurtainTick = 0;
    unit.invulnTick = 0;
    expect(unit.isInvulnerable).toBe(false);
  });

  it('structure with ironCurtainTicks > 0 takes 0 damage', () => {
    const s: MapStructure = {
      type: 'FACT', cx: 10, cy: 10, hp: 1000, maxHp: 1000,
      alive: true, house: House.USSR as any, rubble: false,
      sellProgress: undefined, buildProgress: undefined,
      ironCurtainTicks: 100,
    } as MapStructure;
    const ctx = makeCombatCtx([], [s]);

    const destroyed = structureDamage(ctx, s, 500);
    expect(destroyed).toBe(false);
    expect(s.hp).toBe(1000);
  });

  it('structure with ironCurtainTicks=0 takes normal damage', () => {
    const s: MapStructure = {
      type: 'PBOX', cx: 10, cy: 10, hp: 400, maxHp: 400,
      alive: true, house: House.USSR as any, rubble: false,
      sellProgress: undefined, buildProgress: undefined,
      ironCurtainTicks: 0,
    } as MapStructure;
    const ctx = makeCombatCtx([], [s]);

    structureDamage(ctx, s, 100);
    expect(s.hp).toBe(300);
  });

  it('Super warhead (damage=1000) still blocked by Iron Curtain', () => {
    const unit = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    unit.ironCurtainTick = 50;
    const hpBefore = unit.hp;
    const killed = unit.takeDamage(1000, 'Super');
    expect(killed).toBe(false);
    expect(unit.hp).toBe(hpBefore);
  });
});

// ============================================================
// Section 10: Integrated splash damage pipeline
// ============================================================
//
// Verify the full applySplashDamage path uses modifyDamage correctly,
// combining warhead-vs-armor, distance falloff, and splash radius.

describe('Integrated splash damage pipeline', () => {

  it('splash at distance 0 applies full warhead-vs-armor modified damage', () => {
    // Target at same cell as splash center → distance ~0
    const target = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10);
    const ctx = makeCombatCtx([target]);
    const hpBefore = target.hp;

    applySplashDamage(
      ctx,
      target.pos,
      { damage: 100, warhead: 'AP', splash: 1.5 },
      -1, House.Spain,
    );

    // AP vs heavy armor at dist=0: modifyDamage(100, 'AP', 'heavy', 0) = 100 * 1.0 = 100
    // 2TNK has heavy armor
    const damageTaken = hpBefore - target.hp;
    expect(damageTaken).toBe(100);
  });

  it('splash at 1 cell reduces damage by distance falloff', () => {
    // Target 1 cell away from splash center
    const target = entityAtCell(UnitType.I_E1, House.USSR, 11, 10); // 1 cell east
    const ctx = makeCombatCtx([target]);
    const hpBefore = target.hp;

    const splashCenter = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    applySplashDamage(
      ctx,
      splashCenter,
      { damage: 100, warhead: 'HE', splash: 1.5 },
      -1, House.Spain,
    );

    const damageTaken = hpBefore - target.hp;
    // Distance = 1 cell = 24px. HE vs none: mult=0.9, spread=6
    // distFactor = floor(24*2/6) = 8; damage = 90/8 = 11.25 → 11
    expect(damageTaken).toBeGreaterThan(0);
    expect(damageTaken).toBeLessThan(100);
  });

  it('units beyond SPLASH_RADIUS (1.5 cells) take 0 splash damage', () => {
    // Target 2 cells away — beyond the 1.5-cell splash radius
    const target = entityAtCell(UnitType.I_E1, House.USSR, 12, 10); // 2 cells east
    const ctx = makeCombatCtx([target]);
    const hpBefore = target.hp;

    const splashCenter = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    applySplashDamage(
      ctx,
      splashCenter,
      { damage: 100, warhead: 'HE', splash: 1.5 },
      -1, House.Spain,
    );

    // 2 cells > 1.5 cells (SPLASH_RADIUS) → no damage
    expect(target.hp).toBe(hpBefore);
  });

  it('SPLASH_RADIUS constant is 1.5 cells', () => {
    expect(SPLASH_RADIUS).toBe(1.5);
  });
});
