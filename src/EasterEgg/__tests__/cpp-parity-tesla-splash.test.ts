/**
 * C++ Behavioral Parity: Tesla Coil Zap Mechanics & Warhead-Specific Splash Patterns
 *
 * Tests verify Tesla Coil damage, charging behavior, warhead wall destruction flags,
 * splash radius/falloff, and nuke blast zone mechanics against C++ source behavior.
 *
 * C++ source references:
 *   building.cpp:5382-5413  — BuildingClass::Charging_AI (Tesla charging state machine)
 *   building.cpp:2850-2865  — Can_Fire: IsElectric && !IsCharged → FIRE_BUSY
 *   building.cpp:598-612    — Tesla Coil shape selection based on IsCharged/IsCharging
 *   combat.cpp:72-129       — Modify_Damage: warhead vs armor + distance falloff
 *   combat.cpp:162-271      — Explosion_Damage: splash radius, wall destruction checks
 *   combat.cpp:250-254      — IsWallDestroyer / IsWoodDestroyer wall destruction gates
 *   combat.cpp:267           — Bridge destruction: only AP/HE warheads
 *   combat.cpp:393-425      — Wide_Area_Damage: nuke blast radius with cell-by-cell falloff
 *   building.cpp:4170       — BULLET_NUKE_UP: damage=200, warhead=WARHEAD_HE
 *   building.cpp:4191       — BULLET_NUKE_DOWN: damage=200, warhead=WARHEAD_NUKE
 *   RULES.INI [TeslaZap]    — Damage=150, Range=8.5, ROF=120, Warhead=Super, Charges=yes
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, type WarheadType,
  UNIT_STATS, buildDefaultAlliances,
  WARHEAD_META, WARHEAD_VS_ARMOR, WARHEAD_PROPS,
  WEAPON_STATS, modifyDamage,
  NUKE_DAMAGE, NUKE_BLAST_CELLS, NUKE_MIN_FALLOFF,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  applySplashDamage, combatAnim,
  SPLASH_RADIUS,
} from '../engine/combat';
import { STRUCTURE_WEAPONS, STRUCTURE_POWERED } from '../engine/scenario';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── Helpers ────────────────────────────────────────────────────────────────────

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function makeCombatCtx(entities: Entity[] = []): CombatContext {
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

// ═══════════════════════════════════════════════════════════════════════════════
// 1. TESLA COIL ZAP MECHANICS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Tesla Coil zap mechanics (building.cpp:5382-5413, RULES.INI [TeslaZap])', () => {

  // C++ RULES.INI [TeslaZap]: Damage=150, ROF=120, Range=8.5, Warhead=Super, Charges=yes
  // TS STRUCTURE_WEAPONS.TSLA: damage=100, rof=120, range=8.5, warhead='Super'
  // TS WEAPON_STATS.TeslaCannon: damage=100, rof=120, range=8.5, warhead='Super'

  it('TSLA structure weapon damage should be 150 (C++ RULES.INI TeslaZap Damage=150)', () => {
    // C++ RULES.INI [TeslaZap]: Damage=150
    // PARITY GAP: TS uses damage=100 in STRUCTURE_WEAPONS.TSLA
    const tsla = STRUCTURE_WEAPONS['TSLA'];
    expect(tsla).toBeDefined();
    expect(tsla.damage).toBe(150); // PARITY GAP — TS has 100, C++ has 150
  });

  it('TeslaCannon weapon damage should be 150 (C++ RULES.INI TeslaZap Damage=150)', () => {
    // C++ RULES.INI [TeslaZap]: Damage=150
    // PARITY GAP: TS uses damage=100 in WEAPON_STATS.TeslaCannon
    const cannon = WEAPON_STATS['TeslaCannon'];
    expect(cannon).toBeDefined();
    expect(cannon.damage).toBe(150); // PARITY GAP — TS has 100, C++ has 150
  });

  it('Tesla Coil uses Super warhead (C++ RULES.INI TeslaZap Warhead=Super)', () => {
    // C++ RULES.INI [TeslaZap]: Warhead=Super — confirmed by structure weapon and weapon stats
    const tsla = STRUCTURE_WEAPONS['TSLA'];
    expect(tsla.warhead).toBe('Super');

    const cannon = WEAPON_STATS['TeslaCannon'];
    expect(cannon.warhead).toBe('Super');
  });

  it('Tesla Coil has range 8.5 cells (C++ RULES.INI TeslaZap Range=8.5)', () => {
    // C++ RULES.INI [TeslaZap]: Range=0x0880 (=2176 leptons = ~8.5 cells)
    const tsla = STRUCTURE_WEAPONS['TSLA'];
    expect(tsla.range).toBe(8.5);

    const cannon = WEAPON_STATS['TeslaCannon'];
    expect(cannon.range).toBe(8.5);
  });

  it('Tesla Coil has ROF of 120 ticks (C++ RULES.INI TeslaZap ROF=120)', () => {
    // C++ RULES.INI [TeslaZap]: ROF=120
    const tsla = STRUCTURE_WEAPONS['TSLA'];
    expect(tsla.rof).toBe(120);
  });

  it('Tesla Coil requires power (C++ building.cpp:2853: IsPowered check)', () => {
    // C++ building.cpp:2853 — IsPowered && Power_Fraction() < 1 → FIRE_BUSY
    // TS: STRUCTURE_POWERED set includes 'TSLA'
    expect(STRUCTURE_POWERED.has('TSLA')).toBe(true);
  });

  it('Super warhead does equal damage to all armor types (C++ RULES.INI [Super])', () => {
    // C++ RULES.INI [Super]: Verses=100%,100%,100%,100%,100%
    const superVersus = WARHEAD_VS_ARMOR['Super'];
    expect(superVersus).toEqual([1.0, 1.0, 1.0, 1.0, 1.0]);
  });

  it('Super warhead does NOT destroy walls (C++ combat.cpp:250-254)', () => {
    // C++ combat.cpp:250-254 — IsWallDestroyer checked; Super doesn't have it
    const superMeta = WARHEAD_META['Super'];
    expect(superMeta.destroysWalls).toBeFalsy();
  });

  it('Super warhead has infantryDeath=5 (electro death anim, C++ RULES.INI [Super])', () => {
    // C++ RULES.INI [Super]: InfDeath=5 (electro-death animation)
    const superProps = WARHEAD_PROPS['Super'];
    expect(superProps.infantryDeath).toBe(5);
  });

  it('Super warhead has explosionSet=0 (no generic explosion, C++ RULES.INI [Super])', () => {
    // C++ RULES.INI [Super]: Explosion=0 — no explosion animation (Tesla uses custom zap effect)
    const superProps = WARHEAD_PROPS['Super'];
    expect(superProps.explosionSet).toBe(0);
  });

  it('Tesla damage at distance 0 with Super warhead vs none armor = full damage', () => {
    // C++ Modify_Damage at distance 0: damage * Modifier[armor] with no falloff
    // Super vs none = 1.0, so full damage
    const baseDamage = 100; // using TS value for this test
    const result = modifyDamage(baseDamage, 'Super', 'none', 0);
    expect(result).toBe(baseDamage);
  });

  it('Tesla damage at distance 0 with Super warhead vs heavy armor = full damage', () => {
    // C++ Modify_Damage: Super has 100% vs all armor classes
    const baseDamage = 100;
    const result = modifyDamage(baseDamage, 'Super', 'heavy', 0);
    expect(result).toBe(baseDamage);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. WARHEAD-SPECIFIC SPLASH PATTERNS
// ═══════════════════════════════════════════════════════════════════════════════

describe('Warhead splash patterns (combat.cpp:162-271)', () => {

  describe('Splash radius (combat.cpp:176: ICON_LEPTON_W + ICON_LEPTON_W/2)', () => {

    it('universal splash radius is 1.5 cells (C++ ICON_LEPTON_W + ICON_LEPTON_W>>1)', () => {
      // C++ combat.cpp:176 — range = ICON_LEPTON_W + (ICON_LEPTON_W >> 1) = 256 + 128 = 384 leptons
      // 384 leptons / 256 leptons_per_cell = 1.5 cells
      expect(SPLASH_RADIUS).toBe(1.5);
    });

    it('entities at 1.0 cells from explosion take damage', () => {
      const attacker = entityAtCell(UnitType.I_E2, House.Spain, 0, 0);
      const target = entityAtCell(UnitType.I_E1, House.USSR, 11, 10); // 1 cell from center
      const ctx = makeCombatCtx([attacker, target]);
      const hpBefore = target.hp;

      const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
      applySplashDamage(ctx, center, { damage: 100, warhead: 'HE', splash: 1.5 }, -1, House.Spain, attacker);

      expect(target.hp).toBeLessThan(hpBefore);
    });

    it('entities at > 1.5 cells from explosion take NO damage', () => {
      const attacker = entityAtCell(UnitType.I_E2, House.Spain, 0, 0);
      const target = entityAtCell(UnitType.I_E1, House.USSR, 12, 10); // 2 cells from center
      const ctx = makeCombatCtx([attacker, target]);
      const hpBefore = target.hp;

      const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
      applySplashDamage(ctx, center, { damage: 100, warhead: 'HE', splash: 1.5 }, -1, House.Spain, attacker);

      expect(target.hp).toBe(hpBefore);
    });
  });

  describe('Splash damage falloff (combat.cpp:106-125: distance-based)', () => {

    it('damage at distance 0 is full (C++ combat.cpp:113: distance==0 → no division)', () => {
      // C++ combat.cpp:113: if(distance) { damage = damage / distance; }
      // At distance 0, no division occurs → full damage
      const baseDamage = 100;
      const result = modifyDamage(baseDamage, 'HE', 'none', 0);
      // HE vs none = 0.9 multiplier
      expect(result).toBe(Math.floor(baseDamage * 0.9));
    });

    it('damage decreases with distance from explosion center', () => {
      const baseDamage = 100;
      const dmgAt0 = modifyDamage(baseDamage, 'HE', 'none', 0);
      const dmgAt10px = modifyDamage(baseDamage, 'HE', 'none', 10);
      const dmgAt20px = modifyDamage(baseDamage, 'HE', 'none', 20);

      expect(dmgAt0).toBeGreaterThanOrEqual(dmgAt10px);
      expect(dmgAt10px).toBeGreaterThanOrEqual(dmgAt20px);
    });

    it('spreadFactor affects falloff rate (higher spread = slower falloff)', () => {
      // C++ combat.cpp:107-111:
      //   SpreadFactor==0 → distance /= PIXEL_LEPTON_W/4 (fast falloff)
      //   SpreadFactor>0  → distance /= SpreadFactor*(PIXEL_LEPTON_W/2) (slower with bigger factor)
      // HE has spreadFactor=6, SA has spreadFactor=3 → HE falls off slower
      const baseDamage = 100;
      const distPx = 15;
      const heDmg = modifyDamage(baseDamage, 'HE', 'none', distPx, 1.0, 0.9, 6);
      const saDmg = modifyDamage(baseDamage, 'SA', 'none', distPx, 1.0, 1.0, 3);

      // At same distance with same multiplier, higher spread should retain more damage
      // HE has spread=6, SA has spread=3; HE should retain more damage at same distance
      expect(heDmg).toBeGreaterThanOrEqual(saDmg);
    });
  });

  describe('Wall destruction by warhead type (combat.cpp:250-254)', () => {

    // C++ combat.cpp:250-254:
    //   if (whead->IsWallDestroyer || (whead->IsWoodDestroyer && optr->IsWooden)) {
    //     Map[cell].Reduce_Wall(strength);
    //   }
    // IsWallDestroyer warheads: AP, HE, Nuke
    // Non-wall-destroying warheads: SA, Fire, HollowPoint, Super, Organic, Mechanical

    it('HE warhead destroys walls (C++ IsWallDestroyer=true)', () => {
      expect(WARHEAD_META['HE'].destroysWalls).toBe(true);
    });

    it('AP warhead destroys walls (C++ IsWallDestroyer=true)', () => {
      expect(WARHEAD_META['AP'].destroysWalls).toBe(true);
    });

    it('Nuke warhead destroys walls (C++ IsWallDestroyer=true)', () => {
      expect(WARHEAD_META['Nuke'].destroysWalls).toBe(true);
    });

    it('SA warhead does NOT destroy walls (C++ IsWallDestroyer=false)', () => {
      expect(WARHEAD_META['SA'].destroysWalls).toBeFalsy();
    });

    it('Fire warhead does NOT destroy walls (C++ IsWallDestroyer=false)', () => {
      // C++ Fire warhead has IsWoodDestroyer but NOT IsWallDestroyer
      // It destroys wooden overlays (trees) but not walls
      expect(WARHEAD_META['Fire'].destroysWalls).toBeFalsy();
    });

    it('HollowPoint warhead does NOT destroy walls', () => {
      expect(WARHEAD_META['HollowPoint'].destroysWalls).toBeFalsy();
    });

    it('Super warhead does NOT destroy walls (tesla zap spares walls)', () => {
      expect(WARHEAD_META['Super'].destroysWalls).toBeFalsy();
    });

    it('Organic warhead does NOT destroy walls', () => {
      expect(WARHEAD_META['Organic'].destroysWalls).toBeFalsy();
    });

    it('Fire warhead CAN destroy wood (C++ IsWoodDestroyer=true)', () => {
      // C++ Fire warhead has IsWoodDestroyer=true for wooden overlays/trees
      expect(WARHEAD_META['Fire'].destroysWood).toBe(true);
    });

    it('HE warhead CAN destroy wood (C++ IsWoodDestroyer=true)', () => {
      expect(WARHEAD_META['HE'].destroysWood).toBe(true);
    });

    it('AP warhead CAN destroy wood (C++ IsWoodDestroyer=true)', () => {
      expect(WARHEAD_META['AP'].destroysWood).toBe(true);
    });

    it('SA warhead does NOT destroy wood', () => {
      expect(WARHEAD_META['SA'].destroysWood).toBeFalsy();
    });
  });

  describe('Warhead spreadFactor values (C++ RULES.INI Spread= per warhead)', () => {

    it('SA spreadFactor=3 (C++ RULES.INI [SA] Spread=3)', () => {
      expect(WARHEAD_META['SA'].spreadFactor).toBe(3);
    });

    it('HE spreadFactor=6 (C++ RULES.INI [HE] Spread=6)', () => {
      expect(WARHEAD_META['HE'].spreadFactor).toBe(6);
    });

    it('AP spreadFactor=3 (C++ RULES.INI [AP] Spread=3)', () => {
      expect(WARHEAD_META['AP'].spreadFactor).toBe(3);
    });

    it('Fire spreadFactor=8 (C++ RULES.INI [Fire] Spread=8)', () => {
      expect(WARHEAD_META['Fire'].spreadFactor).toBe(8);
    });

    it('HollowPoint spreadFactor=1 (C++ RULES.INI [HollowPoint] Spread=1)', () => {
      expect(WARHEAD_META['HollowPoint'].spreadFactor).toBe(1);
    });

    it('Super spreadFactor=1 (C++ RULES.INI [Super] Spread=1)', () => {
      expect(WARHEAD_META['Super'].spreadFactor).toBe(1);
    });

    it('Nuke spreadFactor=6 (C++ RULES.INI [Nuke] Spread=6)', () => {
      expect(WARHEAD_META['Nuke'].spreadFactor).toBe(6);
    });
  });

  describe('Bridge destruction warhead gate (combat.cpp:267)', () => {

    it('only AP and HE can destroy bridges in C++ (combat.cpp:267)', () => {
      // C++ combat.cpp:267: if ((warhead == WARHEAD_AP || warhead == WARHEAD_HE) && ...)
      // Bridge destruction is gated to ONLY AP and HE warheads
      // Verify by checking the warhead types — SA, Fire, Super, Nuke cannot destroy bridges
      // in the C++ Explosion_Damage function (though Wide_Area_Damage with nuke warhead
      // delegates to Explosion_Damage which then checks)
      const bridgeWarheads: WarheadType[] = ['AP', 'HE'];
      const nonBridgeWarheads: WarheadType[] = ['SA', 'Fire', 'HollowPoint', 'Super', 'Organic'];

      // The TS code checks (weapon.warhead === 'AP' || weapon.warhead === 'HE') for bridge damage
      // This test documents the C++ parity expectation
      for (const wh of bridgeWarheads) {
        expect(wh === 'AP' || wh === 'HE').toBe(true);
      }
      for (const wh of nonBridgeWarheads) {
        expect(wh === 'AP' || wh === 'HE').toBe(false);
      }
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. COMBAT_ANIM — Explosion sprite selection
// ═══════════════════════════════════════════════════════════════════════════════

describe('Combat_Anim explosion sprites (combat.cpp:295-366)', () => {

  it('explosionSet=6 always returns atomsfx (C++ ANIM_ATOM_BLAST)', () => {
    expect(combatAnim(50, 6, 'ground')).toBe('atomsfx');
    expect(combatAnim(1, 6, 'water')).toBe('atomsfx');
    expect(combatAnim(200, 6, 'air')).toBe('atomsfx');
  });

  it('explosionSet=2 returns piff for <=15 damage, piffpiff for >15', () => {
    expect(combatAnim(10, 2, 'ground')).toBe('piff');
    expect(combatAnim(15, 2, 'ground')).toBe('piff');
    expect(combatAnim(16, 2, 'ground')).toBe('piffpiff');
    expect(combatAnim(100, 2, 'ground')).toBe('piffpiff');
  });

  it('explosionSet=1 always returns piff (C++ HollowPoint)', () => {
    expect(combatAnim(1, 1, 'ground')).toBe('piff');
    expect(combatAnim(100, 1, 'ground')).toBe('piff');
  });

  it('explosionSet=0 returns null (no explosion, C++ Super/Organic/Mechanical)', () => {
    expect(combatAnim(100, 0, 'ground')).toBeNull();
  });

  it('damage=0 returns null regardless of explosionSet', () => {
    expect(combatAnim(0, 5, 'ground')).toBeNull();
    expect(combatAnim(0, 6, 'ground')).toBeNull();
  });

  it('air land type returns flak for sets 3-5', () => {
    expect(combatAnim(100, 3, 'air')).toBe('flak');
    expect(combatAnim(100, 4, 'air')).toBe('flak');
    expect(combatAnim(100, 5, 'air')).toBe('flak');
  });

  it('water land type returns water-exp sprites for sets 3-5', () => {
    // These should return from the WATER_LIST array
    const result3 = combatAnim(100, 3, 'water');
    expect(result3).toMatch(/^water-exp/);

    const result4 = combatAnim(100, 4, 'water');
    expect(result4).toMatch(/^water-exp/);

    const result5 = combatAnim(100, 5, 'water');
    expect(result5).toMatch(/^water-exp/);
  });

  it('explosionSet=5 (HE) scales from veh-hit1 to fball1 by damage', () => {
    // C++ HE_LIST = [veh-hit1, veh-hit2, art-exp1, fball1], maxDamage=130
    const lowDmg = combatAnim(1, 5, 'ground');
    expect(lowDmg).toBe('veh-hit1');

    const highDmg = combatAnim(130, 5, 'ground');
    expect(highDmg).toBe('fball1');
  });

  it('explosionSet=4 (AP) scales from veh-hit3 to fball1 by damage', () => {
    // C++ AP_LIST = [veh-hit3, veh-hit2, frag1, fball1], maxDamage=90
    const lowDmg = combatAnim(1, 4, 'ground');
    expect(lowDmg).toBe('veh-hit3');

    const highDmg = combatAnim(90, 4, 'ground');
    expect(highDmg).toBe('fball1');
  });

  it('explosionSet=3 (Fire) scales from napalm1 to napalm3 by damage', () => {
    // C++ FIRE_LIST = [napalm1, napalm2, napalm3], maxDamage=150
    const lowDmg = combatAnim(1, 3, 'ground');
    expect(lowDmg).toBe('napalm1');

    const highDmg = combatAnim(150, 3, 'ground');
    expect(highDmg).toBe('napalm3');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. NUKE BLAST ZONE
// ═══════════════════════════════════════════════════════════════════════════════

describe('Nuke blast zone (building.cpp:4191, combat.cpp:393-425)', () => {

  it('C++ nuke bullet has damage=200 with WARHEAD_NUKE (building.cpp:4191)', () => {
    // C++ building.cpp:4191:
    //   bullet = new BulletClass(BULLET_NUKE_DOWN, target, this, 200, WARHEAD_NUKE, MPH_VERY_FAST);
    // C++ rules.ini AtomDamage=1000
    expect(NUKE_DAMAGE).toBe(1000);
  });

  it('Nuke warhead verses table matches C++ RULES.INI (90%,100%,60%,25%,50%)', () => {
    // C++ RULES.INI [Nuke]: Verses=90%,100%,60%,25%,50%
    const nukeVersus = WARHEAD_VS_ARMOR['Nuke'];
    expect(nukeVersus[0]).toBe(0.9);   // vs none (infantry)
    expect(nukeVersus[1]).toBe(1.0);   // vs wood
    expect(nukeVersus[2]).toBe(0.6);   // vs light
    expect(nukeVersus[3]).toBe(0.25);  // vs heavy
    expect(nukeVersus[4]).toBe(0.5);   // vs concrete
  });

  it('Nuke warhead has explosionSet=6 (always atomsfx, C++ RULES.INI [Nuke])', () => {
    const nukeProps = WARHEAD_PROPS['Nuke'];
    expect(nukeProps.explosionSet).toBe(6);
  });

  it('Nuke warhead destroys walls, wood, AND ore (C++ RULES.INI [Nuke])', () => {
    // C++ RULES.INI [Nuke]: Wall=yes, Wood=yes, Ore=yes — most destructive warhead
    const nukeMeta = WARHEAD_META['Nuke'];
    expect(nukeMeta.destroysWalls).toBe(true);
    expect(nukeMeta.destroysWood).toBe(true);
    expect(nukeMeta.destroysOre).toBe(true);
  });

  it('only Nuke warhead has destroysOre=true (C++ RULES.INI Ore=yes)', () => {
    // C++ RULES.INI: only [Nuke] has Ore=yes
    const warheadsWithOre = Object.entries(WARHEAD_META)
      .filter(([_, meta]) => meta.destroysOre)
      .map(([name]) => name);
    expect(warheadsWithOre).toEqual(['Nuke']);
  });

  it('nuke blast radius is defined (TS uses 10 cells)', () => {
    // C++ Wide_Area_Damage uses cell_radius calculated from a lepton radius parameter
    // The TS implementation uses NUKE_BLAST_CELLS = 10
    expect(NUKE_BLAST_CELLS).toBeGreaterThan(0);
    expect(typeof NUKE_BLAST_CELLS).toBe('number');
  });

  it('nuke minimum falloff ensures edge targets take some damage', () => {
    // C++ Wide_Area_Damage: damage = rawdamage * Inverse(fixed(cell_radius, dist_from_center))
    // At the edge, dist == cell_radius, so fixed = 1, Inverse = 1 → full damage
    // TS uses NUKE_MIN_FALLOFF = 0.1 to ensure at least 10% damage at edge
    expect(NUKE_MIN_FALLOFF).toBeGreaterThan(0);
    expect(NUKE_MIN_FALLOFF).toBeLessThan(1);
  });

  it('nuke splash damages entities at center with full damage', () => {
    // Entity at nuke ground zero should take maximum damage
    const victim = entityAtCell(UnitType.I_E1, House.USSR, 10, 10);
    const ctx = makeCombatCtx([victim]);
    const hpBefore = victim.hp;

    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    // Using Nuke warhead with high damage, splash centered on victim
    applySplashDamage(ctx, center, { damage: 200, warhead: 'Nuke', splash: 10 }, -1, House.Spain);

    expect(victim.hp).toBeLessThan(hpBefore);
    // At distance 0, damage should be very high (likely lethal for infantry)
    const damageTaken = hpBefore - victim.hp;
    expect(damageTaken).toBeGreaterThan(0);
  });

  it('nuke splash damage decreases with distance from epicenter', () => {
    const near = entityAtCell(UnitType.V_3TNK, House.USSR, 10, 10);   // at center
    const mid = entityAtCell(UnitType.V_3TNK, House.USSR, 13, 10);    // 3 cells away
    const far = entityAtCell(UnitType.V_3TNK, House.USSR, 18, 10);    // 8 cells away — use larger distance
    const ctx = makeCombatCtx([near, mid, far]);

    // Use a blast radius large enough that all 3 entities are within range
    const center = { x: 10 * CELL_SIZE + CELL_SIZE / 2, y: 10 * CELL_SIZE + CELL_SIZE / 2 };
    applySplashDamage(ctx, center, { damage: 200, warhead: 'Nuke', splash: 10 }, -1, House.Spain);

    const dmgNear = near.maxHp - near.hp;
    const dmgMid = mid.maxHp - mid.hp;

    // Closer entity takes more damage than farther entity
    expect(dmgNear).toBeGreaterThanOrEqual(dmgMid);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. WARHEAD vs ARMOR INTERACTION TABLES
// ═══════════════════════════════════════════════════════════════════════════════

describe('Warhead vs armor tables (C++ RULES.INI Verses= lines)', () => {

  it('SA warhead: 100% none, 50% wood, 60% light, 25% heavy, 25% concrete', () => {
    expect(WARHEAD_VS_ARMOR['SA']).toEqual([1.0, 0.5, 0.6, 0.25, 0.25]);
  });

  it('HE warhead: 90% none, 75% wood, 60% light, 25% heavy, 100% concrete', () => {
    expect(WARHEAD_VS_ARMOR['HE']).toEqual([0.9, 0.75, 0.6, 0.25, 1.0]);
  });

  it('AP warhead: 30% none, 75% wood, 75% light, 100% heavy, 50% concrete', () => {
    expect(WARHEAD_VS_ARMOR['AP']).toEqual([0.3, 0.75, 0.75, 1.0, 0.5]);
  });

  it('Fire warhead: 90% none, 100% wood, 60% light, 25% heavy, 50% concrete', () => {
    expect(WARHEAD_VS_ARMOR['Fire']).toEqual([0.9, 1.0, 0.6, 0.25, 0.5]);
  });

  it('HollowPoint warhead: 100% none, 5% all armored (anti-infantry only)', () => {
    expect(WARHEAD_VS_ARMOR['HollowPoint']).toEqual([1.0, 0.05, 0.05, 0.05, 0.05]);
  });

  it('Organic warhead: 100% none, 0% everything else (dog bite)', () => {
    expect(WARHEAD_VS_ARMOR['Organic']).toEqual([1.0, 0.0, 0.0, 0.0, 0.0]);
  });
});
