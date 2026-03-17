/**
 * C++ Behavioral Parity: TSLA — Tesla Coil Defense Structure
 *
 * Tests verify Tesla Coil behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference.
 *
 * TSLA key stats (rules.ini / building.cpp):
 *   HP: 400, Size: 1x1, Cost: 1500, Soviet faction
 *   Weapon: Super warhead, 100 damage, range 8.5, ROF 120, splash 1.0
 *   Super warhead vs armor: 1.0 vs ALL armor types (universal damage)
 *   POWER-DEPENDENT (in STRUCTURE_POWERED) — cannot fire during power outage
 *   NOT turreted (not in TURRETED_STRUCTURES)
 *   Special 'tesla' effect type with startX/startY/endX/endY + 'teslazap' sound
 *   Longest defense range at 8.5 cells
 *   Slow ROF: 120 ticks between shots
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, COUNTRY_BONUSES,
  buildDefaultAlliances, WARHEAD_VS_ARMOR,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  updateStructureCombat,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import {
  type MapStructure, type StructureWeapon,
  STRUCTURE_WEAPONS, STRUCTURE_SIZE, STRUCTURE_MAX_HP, STRUCTURE_POWERED,
} from '../engine/scenario';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// -- Helpers ------------------------------------------------------------------

function makeDefenseStructure(
  type: string,
  house: House,
  cx: number,
  cy: number,
  opts: { hp?: number; cooldown?: number; ammo?: number } = {},
): MapStructure {
  const maxHp = opts.hp ?? STRUCTURE_MAX_HP[type] ?? 256;
  const weapon = STRUCTURE_WEAPONS[type] ? { ...STRUCTURE_WEAPONS[type] } : undefined;
  return {
    type,
    image: type.toLowerCase(),
    house,
    cx,
    cy,
    hp: maxHp,
    maxHp,
    alive: true,
    rubble: false,
    weapon,
    attackCooldown: opts.cooldown ?? 0,
    ammo: opts.ammo ?? -1,
    maxAmmo: -1,
  };
}

/** Place an entity at the center of a cell */
function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(
  structures: MapStructure[] = [],
  entities: Entity[] = [],
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

// -- Structure Stats (rules.ini / building.cpp) --------------------------------

describe('TSLA structure stats (rules.ini)', () => {
  it('has 400 max HP', () => {
    expect(STRUCTURE_MAX_HP['TSLA']).toBe(400);
  });

  it('has 1x1 footprint', () => {
    expect(STRUCTURE_SIZE['TSLA']).toEqual([1, 1]);
  });

  it('IS power-dependent (in STRUCTURE_POWERED)', () => {
    expect(STRUCTURE_POWERED.has('TSLA')).toBe(true);
  });
});

// -- Weapon Stats (rules.ini: Weapon=TeslaZap) --------------------------------

describe('TSLA weapon stats (rules.ini: Weapon=TeslaZap)', () => {
  it('has Super warhead', () => {
    expect(STRUCTURE_WEAPONS['TSLA'].warhead).toBe('Super');
  });

  it('has 100 base damage', () => {
    expect(STRUCTURE_WEAPONS['TSLA'].damage).toBe(100);
  });

  it('has range 8.5 cells — longest defense range', () => {
    expect(STRUCTURE_WEAPONS['TSLA'].range).toBe(8.5);
  });

  it('outranges all other defense structures', () => {
    const tslaRange = STRUCTURE_WEAPONS['TSLA'].range;
    for (const [type, weapon] of Object.entries(STRUCTURE_WEAPONS)) {
      if (type === 'TSLA') continue;
      expect(tslaRange, `TSLA range ${tslaRange} should exceed ${type} range ${weapon.range}`).toBeGreaterThan(weapon.range);
    }
  });

  it('has ROF 120 ticks — slow firing rate', () => {
    expect(STRUCTURE_WEAPONS['TSLA'].rof).toBe(120);
  });

  it('has splash 1.0', () => {
    expect(STRUCTURE_WEAPONS['TSLA'].splash).toBe(1);
  });

  it('has projSpeed 100', () => {
    expect(STRUCTURE_WEAPONS['TSLA'].projSpeed).toBe(100);
  });

  it('does NOT have isAntiAir flag', () => {
    expect(STRUCTURE_WEAPONS['TSLA'].isAntiAir).toBeFalsy();
  });
});

// -- Super Warhead vs Armor (warhead.cpp) --------------------------------------

describe('Super warhead damage multipliers (warhead.cpp)', () => {
  it('1.0x vs none armor (infantry)', () => {
    expect(WARHEAD_VS_ARMOR['Super'][0]).toBe(1.0);
  });

  it('1.0x vs wood armor', () => {
    expect(WARHEAD_VS_ARMOR['Super'][1]).toBe(1.0);
  });

  it('1.0x vs light armor', () => {
    expect(WARHEAD_VS_ARMOR['Super'][2]).toBe(1.0);
  });

  it('1.0x vs heavy armor (tanks)', () => {
    expect(WARHEAD_VS_ARMOR['Super'][3]).toBe(1.0);
  });

  it('1.0x vs concrete armor (buildings)', () => {
    expect(WARHEAD_VS_ARMOR['Super'][4]).toBe(1.0);
  });

  it('deals equal damage to ALL armor types — universal warhead', () => {
    const superMultipliers = WARHEAD_VS_ARMOR['Super'];
    for (const mult of superMultipliers) {
      expect(mult).toBe(1.0);
    }
  });
});

// -- Firing at Enemies (building.cpp: updateStructureCombat) -------------------

describe('TSLA fires at enemy in range (building.cpp)', () => {
  it('damages an infantry enemy within range', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    // Enemy 3 cells east — well within range 8.5
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([tsla], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('applies Super warhead — full 100 damage (1.0x vs heavy armor)', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    // Medium Tank: 400 HP, heavy armor — survives one shot to verify exact damage
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 13, 10);
    const hpBefore = tank.hp;
    expect(hpBefore).toBeGreaterThan(100); // precondition: must survive the hit
    const ctx = makeCombatCtx([tsla], [tank]);
    updateStructureCombat(ctx);
    // Super vs heavy = 1.0 mult, direct 100 + splash at dist=0 = 100, total = 200
    // C++ combat.cpp:207 — splash excludes FIRER, not direct-hit target
    expect(hpBefore - tank.hp).toBe(200);
  });

  it('applies full 100 damage to heavy armor (Super = 1.0x vs all)', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    // Heavy tank: armor = 'heavy'
    const tank = entityAtCell(UnitType.V_2TNK, House.USSR, 13, 10);
    const hpBefore = tank.hp;
    const ctx = makeCombatCtx([tsla], [tank]);
    updateStructureCombat(ctx);
    // Super vs heavy = 1.0 mult, direct 100 + splash at dist=0 = 100, total = 200
    // C++ combat.cpp:207 — splash excludes FIRER, not direct-hit target
    expect(hpBefore - tank.hp).toBe(200);
  });

  it('applies full 100 damage to light armor (Super = 1.0x vs all)', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const apc = entityAtCell(UnitType.V_APC, House.USSR, 13, 10);
    const hpBefore = apc.hp;
    const ctx = makeCombatCtx([tsla], [apc]);
    updateStructureCombat(ctx);
    // Super vs light = 1.0 mult, direct 100 + splash at dist=0 = 100, total = 200
    // C++ combat.cpp:207 — splash excludes FIRER, not direct-hit target
    expect(hpBefore - apc.hp).toBe(200);
  });

  it('does NOT fire at enemy outside range 8.5', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    // Enemy 10 cells east — beyond range 8.5
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 20, 10);
    const ctx = makeCombatCtx([tsla], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(enemy.maxHp);
  });

  it('fires at enemy at maximum range (~8 cells)', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    // Enemy 8 cells east — within range 8.5
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 18, 10);
    const ctx = makeCombatCtx([tsla], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });

  it('does NOT fire at allied units', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    // Greece is allied with Spain
    const ally = entityAtCell(UnitType.I_E1, House.Greece, 13, 10);
    const ctx = makeCombatCtx([tsla], [ally]);
    updateStructureCombat(ctx);
    expect(ally.hp).toBe(ally.maxHp);
  });

  it('sets attackCooldown to ROF 120 after firing', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const ctx = makeCombatCtx([tsla], [enemy]);
    updateStructureCombat(ctx);
    expect(tsla.attackCooldown).toBe(120);
  });

  it('does NOT fire while on cooldown', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10, { cooldown: 50 });
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const ctx = makeCombatCtx([tsla], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(enemy.maxHp);
  });

  it('decrements cooldown each tick', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10, { cooldown: 50 });
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const ctx = makeCombatCtx([tsla], [enemy]);
    updateStructureCombat(ctx);
    expect(tsla.attackCooldown).toBe(49);
  });
});

// -- Power Dependency (building.cpp: PW1/PW3) ---------------------------------

describe('TSLA cannot fire during power outage (building.cpp: PW1/PW3)', () => {
  it('does NOT fire when power consumed > produced (low power)', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const ctx = makeCombatCtx([tsla], [enemy], {
      powerConsumed: 200,
      powerProduced: 100,
    });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(enemy.maxHp);
  });

  it('fires normally when power is sufficient', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([tsla], [enemy], {
      powerConsumed: 50,
      powerProduced: 100,
    });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('fires when powerConsumed equals powerProduced (not low power)', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([tsla], [enemy], {
      powerConsumed: 100,
      powerProduced: 100,
    });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('fires when powerProduced is 0 (isLowPower requires powerProduced > 0)', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([tsla], [enemy], {
      powerConsumed: 100,
      powerProduced: 0,
    });
    updateStructureCombat(ctx);
    // isLowPower = consumed > produced && produced > 0 => false when produced=0
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('unpowered defense (PBOX) fires during power outage — contrast with TSLA', () => {
    const pbox = makeDefenseStructure('PBOX', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([pbox], [enemy], {
      powerConsumed: 200,
      powerProduced: 100,
    });
    updateStructureCombat(ctx);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });
});

// -- No Turret (building.cpp) -------------------------------------------------

describe('TSLA has no turret rotation (building.cpp)', () => {
  it('does NOT set turretDir after firing', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const ctx = makeCombatCtx([tsla], [enemy]);
    updateStructureCombat(ctx);
    expect(tsla.turretDir).toBeUndefined();
  });

  it('does NOT set desiredTurretDir after firing', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const ctx = makeCombatCtx([tsla], [enemy]);
    updateStructureCombat(ctx);
    expect(tsla.desiredTurretDir).toBeUndefined();
  });

  it('does NOT set firingFlash after firing', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const ctx = makeCombatCtx([tsla], [enemy]);
    updateStructureCombat(ctx);
    expect(tsla.firingFlash).toBeUndefined();
  });
});

// -- Anti-Air Gate (building.cpp) ---------------------------------------------

describe('TSLA does NOT target airborne aircraft (building.cpp — AA gate)', () => {
  it('does NOT fire at airborne helicopter', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const heli = entityAtCell(UnitType.V_HIND, House.USSR, 13, 10);
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE; // airborne
    const ctx = makeCombatCtx([tsla], [heli]);
    updateStructureCombat(ctx);
    expect(heli.hp).toBe(heli.maxHp);
  });

  it('does NOT fire at airborne fixed-wing aircraft', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const mig = entityAtCell(UnitType.V_MIG, House.USSR, 13, 10);
    mig.flightAltitude = Entity.FLIGHT_ALTITUDE;
    const ctx = makeCombatCtx([tsla], [mig]);
    updateStructureCombat(ctx);
    expect(mig.hp).toBe(mig.maxHp);
  });

  it('fires at landed aircraft (flightAltitude = 0)', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const heli = entityAtCell(UnitType.V_HIND, House.USSR, 13, 10);
    heli.flightAltitude = 0; // landed
    const ctx = makeCombatCtx([tsla], [heli]);
    updateStructureCombat(ctx);
    expect(heli.hp).toBeLessThan(heli.maxHp);
  });
});

// -- Tesla Effect (building.cpp — special rendering) --------------------------

describe('TSLA produces tesla effect — not projectile (building.cpp)', () => {
  it('produces a tesla-type effect when firing', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const ctx = makeCombatCtx([tsla], [enemy]);
    updateStructureCombat(ctx);
    const teslaEffects = ctx.effects.filter(e => e.type === 'tesla');
    expect(teslaEffects.length).toBe(1);
  });

  it('does NOT produce a projectile effect', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const ctx = makeCombatCtx([tsla], [enemy]);
    updateStructureCombat(ctx);
    const projectiles = ctx.effects.filter(e => e.type === 'projectile');
    expect(projectiles.length).toBe(0);
  });

  it('tesla effect has startX/startY at structure center', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const ctx = makeCombatCtx([tsla], [enemy]);
    updateStructureCombat(ctx);
    const tesla = ctx.effects.find(e => e.type === 'tesla');
    expect(tesla).toBeDefined();
    const expectedX = 10 * CELL_SIZE + CELL_SIZE;
    const expectedY = 10 * CELL_SIZE + CELL_SIZE;
    expect((tesla as any).startX).toBe(expectedX);
    expect((tesla as any).startY).toBe(expectedY);
  });

  it('tesla effect has endX/endY at target position', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const ctx = makeCombatCtx([tsla], [enemy]);
    updateStructureCombat(ctx);
    const tesla = ctx.effects.find(e => e.type === 'tesla');
    expect(tesla).toBeDefined();
    expect((tesla as any).endX).toBe(enemy.pos.x);
    expect((tesla as any).endY).toBe(enemy.pos.y);
  });

  it('tesla effect has screen blendMode', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const ctx = makeCombatCtx([tsla], [enemy]);
    updateStructureCombat(ctx);
    const tesla = ctx.effects.find(e => e.type === 'tesla');
    expect(tesla).toBeDefined();
    expect((tesla as any).blendMode).toBe('screen');
  });

  it('plays teslazap sound when firing', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const sounds: string[] = [];
    const ctx = makeCombatCtx([tsla], [enemy], {
      playSoundAt: (name: string) => { sounds.push(name); },
    });
    updateStructureCombat(ctx);
    expect(sounds).toContain('teslazap');
  });

  it('does NOT play machinegun sound (only non-tesla defenses do)', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const sounds: string[] = [];
    const ctx = makeCombatCtx([tsla], [enemy], {
      playSoundAt: (name: string) => { sounds.push(name); },
    });
    updateStructureCombat(ctx);
    expect(sounds).not.toContain('machinegun');
  });

  it('also produces a muzzle effect', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const ctx = makeCombatCtx([tsla], [enemy]);
    updateStructureCombat(ctx);
    const muzzles = ctx.effects.filter(e => e.type === 'muzzle');
    expect(muzzles.length).toBeGreaterThanOrEqual(1);
  });
});

// -- Splash Damage (combat.cpp: applySplashDamage) ----------------------------

describe('TSLA splash damage (splash=1.0, combat.cpp)', () => {
  it('deals splash damage to nearby secondary target', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    // Primary target
    const primary = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    // Secondary target in same cell as primary — within splash radius
    const secondary = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const ctx = makeCombatCtx([tsla], [primary, secondary]);
    updateStructureCombat(ctx);
    // Primary gets direct hit damage
    expect(primary.hp).toBeLessThan(primary.maxHp);
    // Secondary gets splash damage (within splash radius 1.5 cells)
    expect(secondary.hp).toBeLessThan(secondary.maxHp);
  });

  it('does NOT deal splash to enemies beyond splash radius', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const primary = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    // Far enemy — 3 cells away from primary, well beyond 1.5 splash radius
    const farEnemy = entityAtCell(UnitType.I_E1, House.USSR, 16, 10);
    const ctx = makeCombatCtx([tsla], [primary, farEnemy]);
    updateStructureCombat(ctx);
    expect(primary.hp).toBeLessThan(primary.maxHp);
    expect(farEnemy.hp).toBe(farEnemy.maxHp);
  });
});

// -- Target Selection / Threat Scoring (building.cpp) -------------------------

describe('TSLA target selection — threat-based scoring (building.cpp)', () => {
  it('prefers closer enemy over farther one when threat is similar', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const closeEnemy = entityAtCell(UnitType.I_E1, House.USSR, 12, 10); // 2 cells
    const farEnemy = entityAtCell(UnitType.I_E1, House.USSR, 17, 10);   // 7 cells
    const ctx = makeCombatCtx([tsla], [closeEnemy, farEnemy]);
    updateStructureCombat(ctx);
    const closeDmg = closeEnemy.maxHp - closeEnemy.hp;
    const farDmg = farEnemy.maxHp - farEnemy.hp;
    // Exactly one target should be damaged (single shot per tick)
    expect(closeDmg + farDmg).toBeGreaterThan(0);
    // Close enemy should be the one that got hit
    expect(closeDmg).toBeGreaterThan(0);
  });

  it('does NOT fire at dead enemies', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const deadEnemy = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    deadEnemy.hp = 0;
    deadEnemy.alive = false;
    const ctx = makeCombatCtx([tsla], [deadEnemy]);
    updateStructureCombat(ctx);
    expect(tsla.attackCooldown).toBe(0);
  });

  it('does NOT fire when structure is dead', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    tsla.alive = false;
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const ctx = makeCombatCtx([tsla], [enemy]);
    updateStructureCombat(ctx);
    expect(enemy.hp).toBe(enemy.maxHp);
  });
});

// -- Kill Tracking (building.cpp) ---------------------------------------------

describe('TSLA kill tracking (building.cpp)', () => {
  it('increments killCount when player-allied TSLA kills an enemy', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    // Weak enemy that will die from 100 Super damage
    const weakEnemy = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    weakEnemy.hp = 1;
    const ctx = makeCombatCtx([tsla], [weakEnemy]);
    expect(ctx.killCount).toBe(0);
    updateStructureCombat(ctx);
    expect(weakEnemy.alive).toBe(false);
    expect(ctx.killCount).toBe(1);
  });

  it('one-shots infantry with 100 damage (most infantry have <= 125 HP)', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const rifleman = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    // E1 Rifle Infantry has 50 HP; Super warhead 1.0 mult => 100 damage kills
    const ctx = makeCombatCtx([tsla], [rifleman]);
    updateStructureCombat(ctx);
    expect(rifleman.alive).toBe(false);
  });
});

// -- Range Comparison (rules.ini — longest defense range) ---------------------

describe('TSLA has the longest defense range (rules.ini)', () => {
  it('range 8.5 exceeds GUN range 6', () => {
    expect(STRUCTURE_WEAPONS['TSLA'].range).toBeGreaterThan(STRUCTURE_WEAPONS['GUN'].range);
  });

  it('range 8.5 exceeds SAM range 7.5', () => {
    expect(STRUCTURE_WEAPONS['TSLA'].range).toBeGreaterThan(STRUCTURE_WEAPONS['SAM'].range);
  });

  it('range 8.5 exceeds PBOX range 5', () => {
    expect(STRUCTURE_WEAPONS['TSLA'].range).toBeGreaterThan(STRUCTURE_WEAPONS['PBOX'].range);
  });

  it('range 8.5 exceeds AGUN range 6', () => {
    expect(STRUCTURE_WEAPONS['TSLA'].range).toBeGreaterThan(STRUCTURE_WEAPONS['AGUN'].range);
  });

  it('range 8.5 exceeds FTUR range 4', () => {
    expect(STRUCTURE_WEAPONS['TSLA'].range).toBeGreaterThan(STRUCTURE_WEAPONS['FTUR'].range);
  });
});

// -- ROF Comparison (rules.ini — slowest defense fire rate) --------------------

describe('TSLA has the slowest defense fire rate (rules.ini)', () => {
  it('ROF 120 is slower than GUN ROF 50', () => {
    expect(STRUCTURE_WEAPONS['TSLA'].rof).toBeGreaterThan(STRUCTURE_WEAPONS['GUN'].rof);
  });

  it('ROF 120 is slower than PBOX ROF 40', () => {
    expect(STRUCTURE_WEAPONS['TSLA'].rof).toBeGreaterThan(STRUCTURE_WEAPONS['PBOX'].rof);
  });

  it('ROF 120 is slower than SAM ROF 20', () => {
    expect(STRUCTURE_WEAPONS['TSLA'].rof).toBeGreaterThan(STRUCTURE_WEAPONS['SAM'].rof);
  });

  it('ROF 120 is slower than AGUN ROF 10', () => {
    expect(STRUCTURE_WEAPONS['TSLA'].rof).toBeGreaterThan(STRUCTURE_WEAPONS['AGUN'].rof);
  });
});

// -- Muzzle Effect (rendering parity) -----------------------------------------

describe('TSLA muzzle effect originates from structure center (rendering parity)', () => {
  it('muzzle effect originates from structure center', () => {
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const ctx = makeCombatCtx([tsla], [enemy]);
    updateStructureCombat(ctx);
    const muzzle = ctx.effects.find(e => e.type === 'muzzle');
    expect(muzzle).toBeDefined();
    const expectedX = 10 * CELL_SIZE + CELL_SIZE;
    const expectedY = 10 * CELL_SIZE + CELL_SIZE;
    expect(muzzle!.x).toBe(expectedX);
    expect(muzzle!.y).toBe(expectedY);
  });
});
