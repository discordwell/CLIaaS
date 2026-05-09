/**
 * C++ Behavioral Parity: QUEE — Queen Ant Defense Structure
 *
 * Tests verify Queen Ant behavior matches C++ RA source code.
 * Each describe block documents the C++ source reference.
 *
 * QUEE key stats (rules.ini / building.cpp):
 *   HP: 800, Size: 2x2
 *   Weapon: Super warhead, 60 damage, range 5, ROF 30, splash 1
 *   Super warhead vs armor: 1.0 vs ALL armor types (universal damage)
 *   NOT power-dependent (not in STRUCTURE_POWERED)
 *   NOT turreted (not in TURRETED_STRUCTURES)
 *   Special 'tesla' effect type with startX/startY/endX/endY + 'teslazap' sound
 *   Same tesla rendering as TSLA despite being an ant structure
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, COUNTRY_BONUSES,
  buildDefaultAlliances, WARHEAD_VS_ARMOR,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  updateInflightProjectiles,
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
    logicAnims: [],
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

function fireStructures(ctx: CombatContext): void {
  updateStructureCombat(ctx);
  for (let i = 0; i < 10 && ctx.inflightProjectiles.length > 0; i++) {
    updateInflightProjectiles(ctx);
  }
}

// -- Structure Stats (rules.ini / building.cpp) --------------------------------

describe('QUEE structure stats (rules.ini)', () => {
  it('has 800 max HP', () => {
    expect(STRUCTURE_MAX_HP['QUEE']).toBe(800);
  });

  it('has 2x1 footprint', () => {
    expect(STRUCTURE_SIZE['QUEE']).toEqual([2, 1]);
  });

  it('is NOT power-dependent (not in STRUCTURE_POWERED)', () => {
    expect(STRUCTURE_POWERED.has('QUEE')).toBe(false);
  });
});

// -- Weapon Stats (rules.ini: Weapon=QueenZap / TeslaZap-like) -----------------

describe('QUEE weapon stats (rules.ini)', () => {
  it('has Super warhead', () => {
    expect(STRUCTURE_WEAPONS['QUEE'].warhead).toBe('Super');
  });

  it('has 60 base damage', () => {
    expect(STRUCTURE_WEAPONS['QUEE'].damage).toBe(60);
  });

  it('has range 5 cells', () => {
    expect(STRUCTURE_WEAPONS['QUEE'].range).toBe(5);
  });

  it('has ROF 30 ticks', () => {
    expect(STRUCTURE_WEAPONS['QUEE'].rof).toBe(30);
  });

  it('has splash 1', () => {
    expect(STRUCTURE_WEAPONS['QUEE'].splash).toBe(1);
  });

  it('has projSpeed 40', () => {
    expect(STRUCTURE_WEAPONS['QUEE'].projSpeed).toBe(40);
  });

  it('does NOT have isAntiAir flag', () => {
    expect(STRUCTURE_WEAPONS['QUEE'].isAntiAir).toBeFalsy();
  });
});

// -- Super Warhead vs Armor (warhead.cpp) --------------------------------------

describe('QUEE Super warhead damage multipliers (warhead.cpp)', () => {
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

describe('QUEE fires at enemy in range (building.cpp)', () => {
  it('damages an infantry enemy within range', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    // Enemy 3 cells east — well within range 5
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([quee], [enemy]);
    fireStructures(ctx);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('applies Super warhead — full 60 damage (1.0x vs heavy armor)', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    // Medium Tank: 400 HP, heavy armor — survives one shot to verify exact damage
    const tank = entityAtCell(UnitType.V_2TNK, House.Spain, 13, 10);
    const hpBefore = tank.hp;
    expect(hpBefore).toBeGreaterThan(60); // precondition: must survive the hit
    const ctx = makeCombatCtx([quee], [tank]);
    fireStructures(ctx);
    // C++ bullet.cpp:991 — Explosion_Damage is sole damage path. Super vs heavy = 1.0, base 60
    expect(hpBefore - tank.hp).toBe(60);
  });

  it('applies full 60 damage to light armor (Super = 1.0x vs all)', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    const apc = entityAtCell(UnitType.V_APC, House.Spain, 13, 10);
    const hpBefore = apc.hp;
    const ctx = makeCombatCtx([quee], [apc]);
    fireStructures(ctx);
    // C++ bullet.cpp:991 — Explosion_Damage is sole damage path. Super vs light = 1.0, base 60
    expect(hpBefore - apc.hp).toBe(60);
  });

  it('does NOT fire at enemy outside range 5', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    // Enemy 7 cells east — beyond range 5
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 17, 10);
    const ctx = makeCombatCtx([quee], [enemy]);
    fireStructures(ctx);
    expect(enemy.hp).toBe(enemy.maxHp);
  });

  it('fires at enemy at maximum range (~4 cells for 2x2 structure)', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    // Enemy 4 cells east — within range 5 (2x2 structure center offset helps)
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 14, 10);
    const ctx = makeCombatCtx([quee], [enemy]);
    fireStructures(ctx);
    expect(enemy.hp).toBeLessThan(enemy.maxHp);
  });

  it('does NOT fire at allied units', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    // BadGuy is allied with itself — place another BadGuy unit
    const ally = entityAtCell(UnitType.I_E1, House.BadGuy, 13, 10);
    const ctx = makeCombatCtx([quee], [ally]);
    fireStructures(ctx);
    expect(ally.hp).toBe(ally.maxHp);
  });

  it('sets attackCooldown to ROF 30 after firing', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const ctx = makeCombatCtx([quee], [enemy]);
    fireStructures(ctx);
    expect(quee.attackCooldown).toBe(30);
  });

  it('does NOT fire while on cooldown', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10, { cooldown: 15 });
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const ctx = makeCombatCtx([quee], [enemy]);
    fireStructures(ctx);
    expect(enemy.hp).toBe(enemy.maxHp);
  });

  it('decrements cooldown each tick', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10, { cooldown: 15 });
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const ctx = makeCombatCtx([quee], [enemy]);
    fireStructures(ctx);
    expect(quee.attackCooldown).toBe(14);
  });
});

// -- Not Power-Dependent (building.cpp) ----------------------------------------

describe('QUEE fires during power outage — not power-dependent (building.cpp)', () => {
  it('fires when power consumed > produced (low power) — unlike TSLA', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([quee], [enemy], {
      powerConsumed: 200,
      powerProduced: 100,
    });
    fireStructures(ctx);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('fires normally when power is sufficient', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const hpBefore = enemy.hp;
    const ctx = makeCombatCtx([quee], [enemy], {
      powerConsumed: 50,
      powerProduced: 100,
    });
    fireStructures(ctx);
    expect(enemy.hp).toBeLessThan(hpBefore);
  });

  it('contrast: TSLA IS power-dependent, QUEE is NOT', () => {
    expect(STRUCTURE_POWERED.has('TSLA')).toBe(true);
    expect(STRUCTURE_POWERED.has('QUEE')).toBe(false);
  });
});

// -- No Turret (building.cpp) -------------------------------------------------

describe('QUEE has no turret rotation (building.cpp)', () => {
  it('does NOT set turretDir after firing', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const ctx = makeCombatCtx([quee], [enemy]);
    fireStructures(ctx);
    expect(quee.turretDir).toBeUndefined();
  });

  it('does NOT set desiredTurretDir after firing', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const ctx = makeCombatCtx([quee], [enemy]);
    fireStructures(ctx);
    expect(quee.desiredTurretDir).toBeUndefined();
  });

  it('does NOT set firingFlash after firing', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const ctx = makeCombatCtx([quee], [enemy]);
    fireStructures(ctx);
    expect(quee.firingFlash).toBeUndefined();
  });
});

// -- Anti-Air Gate (building.cpp) ---------------------------------------------

describe('QUEE does NOT target airborne aircraft (building.cpp — AA gate)', () => {
  it('does NOT fire at airborne helicopter', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    const heli = entityAtCell(UnitType.V_HIND, House.Spain, 13, 10);
    heli.flightAltitude = Entity.FLIGHT_ALTITUDE; // airborne
    const ctx = makeCombatCtx([quee], [heli]);
    fireStructures(ctx);
    expect(heli.hp).toBe(heli.maxHp);
  });

  it('does NOT fire at airborne fixed-wing aircraft', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    const mig = entityAtCell(UnitType.V_MIG, House.Spain, 13, 10);
    mig.flightAltitude = Entity.FLIGHT_ALTITUDE;
    const ctx = makeCombatCtx([quee], [mig]);
    fireStructures(ctx);
    expect(mig.hp).toBe(mig.maxHp);
  });

  it('fires at landed aircraft (flightAltitude = 0)', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    const heli = entityAtCell(UnitType.V_HIND, House.Spain, 13, 10);
    heli.flightAltitude = 0; // landed
    const ctx = makeCombatCtx([quee], [heli]);
    fireStructures(ctx);
    expect(heli.hp).toBeLessThan(heli.maxHp);
  });
});

// -- Tesla Effect (building.cpp — special rendering) --------------------------

describe('QUEE produces tesla effect — not projectile (building.cpp)', () => {
  it('produces a tesla-type effect when firing', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const ctx = makeCombatCtx([quee], [enemy]);
    fireStructures(ctx);
    const teslaEffects = ctx.effects.filter(e => e.type === 'tesla');
    expect(teslaEffects.length).toBe(1);
  });

  it('does NOT produce a projectile effect', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const ctx = makeCombatCtx([quee], [enemy]);
    fireStructures(ctx);
    const projectiles = ctx.effects.filter(e => e.type === 'projectile');
    expect(projectiles.length).toBe(0);
  });

  it('tesla effect has startX/startY at structure center (2x1)', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const ctx = makeCombatCtx([quee], [enemy]);
    fireStructures(ctx);
    const tesla = ctx.effects.find(e => e.type === 'tesla');
    expect(tesla).toBeDefined();
    // C++ BSIZE_21 CenterOffset = 0xff,0x80.
    const expectedX = 10 * CELL_SIZE + (0xff * CELL_SIZE) / 256;
    const expectedY = 10 * CELL_SIZE + CELL_SIZE / 2;
    expect((tesla as any).startX).toBe(expectedX);
    expect((tesla as any).startY).toBe(expectedY);
  });

  it('tesla effect has endX/endY at target position', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const ctx = makeCombatCtx([quee], [enemy]);
    fireStructures(ctx);
    const tesla = ctx.effects.find(e => e.type === 'tesla');
    expect(tesla).toBeDefined();
    expect((tesla as any).endX).toBe(enemy.pos.x);
    expect((tesla as any).endY).toBe(enemy.pos.y);
  });

  it('tesla effect has screen blendMode', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const ctx = makeCombatCtx([quee], [enemy]);
    fireStructures(ctx);
    const tesla = ctx.effects.find(e => e.type === 'tesla');
    expect(tesla).toBeDefined();
    expect((tesla as any).blendMode).toBe('screen');
  });

  it('plays teslazap sound when firing', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const sounds: string[] = [];
    const ctx = makeCombatCtx([quee], [enemy], {
      playSoundAt: (name: string) => { sounds.push(name); },
    });
    fireStructures(ctx);
    expect(sounds).toContain('teslazap');
  });

  it('does NOT play machinegun sound (only non-tesla defenses do)', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const sounds: string[] = [];
    const ctx = makeCombatCtx([quee], [enemy], {
      playSoundAt: (name: string) => { sounds.push(name); },
    });
    fireStructures(ctx);
    expect(sounds).not.toContain('machinegun');
  });

  it('also produces a muzzle effect', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const ctx = makeCombatCtx([quee], [enemy]);
    fireStructures(ctx);
    const muzzles = ctx.effects.filter(e => e.type === 'muzzle');
    expect(muzzles.length).toBeGreaterThanOrEqual(1);
  });
});

// -- Splash Damage (combat.cpp: applySplashDamage) ----------------------------

describe('QUEE splash damage (splash=1, combat.cpp)', () => {
  it('deals splash damage to nearby secondary target', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    // Primary target
    const primary = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    // Secondary target in same cell as primary — within splash radius
    const secondary = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const ctx = makeCombatCtx([quee], [primary, secondary]);
    fireStructures(ctx);
    // Primary gets direct hit damage
    expect(primary.hp).toBeLessThan(primary.maxHp);
    // Secondary gets splash damage (within splash radius)
    expect(secondary.hp).toBeLessThan(secondary.maxHp);
  });

  it('does NOT deal splash to enemies beyond splash radius', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    const primary = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    // Far enemy — 3 cells away from primary, well beyond splash radius
    const farEnemy = entityAtCell(UnitType.I_E1, House.Spain, 16, 10);
    const ctx = makeCombatCtx([quee], [primary, farEnemy]);
    fireStructures(ctx);
    expect(primary.hp).toBeLessThan(primary.maxHp);
    expect(farEnemy.hp).toBe(farEnemy.maxHp);
  });
});

// -- Target Selection / Threat Scoring (building.cpp) -------------------------

describe('QUEE target selection — threat-based scoring (building.cpp)', () => {
  it('prefers closer enemy over farther one when threat is similar', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    const closeEnemy = entityAtCell(UnitType.I_E1, House.Spain, 12, 10); // 2 cells
    const farEnemy = entityAtCell(UnitType.I_E1, House.Spain, 14, 10);   // 4 cells
    const ctx = makeCombatCtx([quee], [closeEnemy, farEnemy]);
    fireStructures(ctx);
    const closeDmg = closeEnemy.maxHp - closeEnemy.hp;
    const farDmg = farEnemy.maxHp - farEnemy.hp;
    // Exactly one target should be damaged (single shot per tick)
    expect(closeDmg + farDmg).toBeGreaterThan(0);
    // Close enemy should be the one that got hit
    expect(closeDmg).toBeGreaterThan(0);
  });

  it('does NOT fire at dead enemies', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    const deadEnemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    deadEnemy.hp = 0;
    deadEnemy.alive = false;
    const ctx = makeCombatCtx([quee], [deadEnemy]);
    fireStructures(ctx);
    expect(quee.attackCooldown).toBe(0);
  });

  it('does NOT fire when structure is dead', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    quee.alive = false;
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const ctx = makeCombatCtx([quee], [enemy]);
    fireStructures(ctx);
    expect(enemy.hp).toBe(enemy.maxHp);
  });
});

// -- Kill Tracking (building.cpp) ---------------------------------------------

describe('QUEE kill tracking (building.cpp)', () => {
  it('increments killCount when player-allied structure kills an enemy', () => {
    // Use player-allied house (Spain) so killCount increments
    const quee = makeDefenseStructure('QUEE', House.Spain, 10, 10);
    const weakEnemy = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    weakEnemy.hp = 1;
    const ctx = makeCombatCtx([quee], [weakEnemy]);
    expect(ctx.killCount).toBe(0);
    fireStructures(ctx);
    expect(weakEnemy.alive).toBe(false);
    expect(ctx.killCount).toBe(1);
  });

  it('one-shots infantry with 60 damage (rifleman has 50 HP)', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    const rifleman = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    // E1 Rifle Infantry has 50 HP; Super warhead 1.0 mult => 60 damage kills
    const ctx = makeCombatCtx([quee], [rifleman]);
    fireStructures(ctx);
    expect(rifleman.alive).toBe(false);
  });
});

// -- Comparison with TSLA (same tesla effect, different stats) ----------------

describe('QUEE vs TSLA comparison (rules.ini)', () => {
  it('QUEE has more HP than TSLA (800 vs 400)', () => {
    expect(STRUCTURE_MAX_HP['QUEE']).toBeGreaterThan(STRUCTURE_MAX_HP['TSLA']);
  });

  it('QUEE has less damage than TSLA (60 vs 100)', () => {
    expect(STRUCTURE_WEAPONS['QUEE'].damage).toBeLessThan(STRUCTURE_WEAPONS['TSLA'].damage);
  });

  it('QUEE has shorter range than TSLA (5 vs 8.5)', () => {
    expect(STRUCTURE_WEAPONS['QUEE'].range).toBeLessThan(STRUCTURE_WEAPONS['TSLA'].range);
  });

  it('QUEE fires faster than TSLA (ROF 30 vs 120)', () => {
    expect(STRUCTURE_WEAPONS['QUEE'].rof).toBeLessThan(STRUCTURE_WEAPONS['TSLA'].rof);
  });

  it('both use Super warhead', () => {
    expect(STRUCTURE_WEAPONS['QUEE'].warhead).toBe('Super');
    expect(STRUCTURE_WEAPONS['TSLA'].warhead).toBe('Super');
  });

  it('QUEE is wider than TSLA (2x1 vs 1x2)', () => {
    expect(STRUCTURE_SIZE['QUEE']).toEqual([2, 1]);
    expect(STRUCTURE_SIZE['TSLA']).toEqual([1, 2]);
  });

  it('both produce tesla effect (not projectile)', () => {
    // QUEE
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    const enemy1 = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const ctx1 = makeCombatCtx([quee], [enemy1]);
    updateStructureCombat(ctx1);
    expect(ctx1.effects.some(e => e.type === 'tesla')).toBe(true);
    expect(ctx1.effects.some(e => e.type === 'projectile')).toBe(false);

    // TSLA
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const enemy2 = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const ctx2 = makeCombatCtx([tsla], [enemy2]);
    updateStructureCombat(ctx2);
    expect(ctx2.effects.some(e => e.type === 'tesla')).toBe(true);
    expect(ctx2.effects.some(e => e.type === 'projectile')).toBe(false);
  });

  it('both play teslazap sound', () => {
    const sounds1: string[] = [];
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    const enemy1 = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const ctx1 = makeCombatCtx([quee], [enemy1], {
      playSoundAt: (name: string) => { sounds1.push(name); },
    });
    updateStructureCombat(ctx1);
    expect(sounds1).toContain('teslazap');

    const sounds2: string[] = [];
    const tsla = makeDefenseStructure('TSLA', House.Spain, 10, 10);
    const enemy2 = entityAtCell(UnitType.I_E1, House.USSR, 13, 10);
    const ctx2 = makeCombatCtx([tsla], [enemy2], {
      playSoundAt: (name: string) => { sounds2.push(name); },
    });
    updateStructureCombat(ctx2);
    expect(sounds2).toContain('teslazap');
  });
});

// -- Muzzle Effect (rendering parity) -----------------------------------------

describe('QUEE muzzle effect originates from structure center (rendering parity)', () => {
  it('muzzle effect originates from 2x1 structure center', () => {
    const quee = makeDefenseStructure('QUEE', House.BadGuy, 10, 10);
    const enemy = entityAtCell(UnitType.I_E1, House.Spain, 13, 10);
    const ctx = makeCombatCtx([quee], [enemy]);
    fireStructures(ctx);
    const muzzle = ctx.effects.find(e => e.type === 'muzzle');
    expect(muzzle).toBeDefined();
    // Combat center uses fixed +CELL_SIZE offset (combat.ts:1378-1379)
    const expectedX = 10 * CELL_SIZE + (0xff * CELL_SIZE) / 256;
    const expectedY = 10 * CELL_SIZE + CELL_SIZE / 2;
    expect(muzzle!.x).toBe(expectedX);
    expect(muzzle!.y).toBe(expectedY);
  });
});
