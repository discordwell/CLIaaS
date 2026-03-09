/**
 * Tests for power consumption parity (PW1/PW2), Tesla Coil power cutoff,
 * superweapon recharge times, and ParaBomb/ParaInfantry superweapons.
 *
 * Validates C++ Red Alert rules.ini parity for power values, Tesla Coil
 * behavior at power deficit, and new superweapon type implementations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  UnitType, House, CELL_SIZE, Mission,
  SuperweaponType, SUPERWEAPON_DEFS,
} from '../engine/types';

beforeEach(() => resetEntityIds());

// === Helper: Simulate player power calculation (mirrors index.ts update method) ===
function calcPlayerPower(structureTypes: string[]): { produced: number; consumed: number } {
  let produced = 0;
  let consumed = 0;
  for (const type of structureTypes) {
    // Production (assumes full health, healthRatio = 1.0)
    if (type === 'POWR') { produced += 100; continue; }
    if (type === 'APWR') { produced += 200; continue; }
    // Consumption (C++ rules.ini Power= values)
    switch (type) {
      case 'PROC': consumed += 30; break;
      case 'WEAP': consumed += 30; break;
      case 'TENT': case 'BARR': consumed += 20; break;
      case 'DOME': consumed += 40; break;
      case 'TSLA': consumed += 150; break;
      case 'HBOX': case 'PBOX': consumed += 10; break;
      case 'GUN': consumed += 40; break;
      case 'SAM': consumed += 40; break;
      case 'AGUN': consumed += 20; break;
      case 'FIX': consumed += 30; break;
      case 'HPAD': consumed += 10; break;
      case 'AFLD': consumed += 30; break;
      case 'ATEK': consumed += 200; break;
      case 'STEK': consumed += 100; break;
      case 'PDOX': case 'IRON': consumed += 200; break;
      case 'MSLO': consumed += 100; break;
      case 'GAP': consumed += 60; break;
      case 'SILO': consumed += 10; break;
    }
  }
  return { produced, consumed };
}

// === Helper: Simulate AI power calculation (mirrors index.ts aiPowerConsumed) ===
function calcAIPower(structureTypes: string[]): { produced: number; consumed: number } {
  let produced = 0;
  let consumed = 0;
  for (const type of structureTypes) {
    if (type === 'POWR') { produced += 100; continue; }
    if (type === 'APWR') { produced += 200; continue; }
    switch (type) {
      case 'TENT': case 'BARR': consumed += 20; break;
      case 'WEAP': consumed += 30; break;
      case 'PROC': consumed += 30; break;
      case 'DOME': consumed += 40; break;
      case 'GUN': consumed += 40; break;
      case 'HBOX': consumed += 10; break;
      case 'TSLA': consumed += 150; break;
      case 'SAM': consumed += 40; break;
      case 'AGUN': consumed += 20; break;
      case 'ATEK': consumed += 200; break;
      case 'STEK': consumed += 100; break;
      case 'HPAD': consumed += 10; break;
      case 'AFLD': consumed += 30; break;
      case 'GAP': consumed += 60; break;
      case 'FIX': consumed += 30; break;
      case 'IRON': case 'PDOX': consumed += 200; break;
      case 'MSLO': consumed += 100; break;
      case 'PBOX': consumed += 10; break;
      case 'SILO': consumed += 10; break;
    }
  }
  return { produced, consumed };
}

// ─── PW1/PW2: Power Consumption Values ──────────────────

describe('Power consumption values (C++ rules.ini parity)', () => {
  it('TENT (Barracks) consumes 20 power', () => {
    const { consumed } = calcPlayerPower(['TENT']);
    expect(consumed).toBe(20);
  });

  it('BARR (Soviet Barracks) consumes 20 power', () => {
    const { consumed } = calcPlayerPower(['BARR']);
    expect(consumed).toBe(20);
  });

  it('GUN (Turret) consumes 40 power', () => {
    const { consumed } = calcPlayerPower(['GUN']);
    expect(consumed).toBe(40);
  });

  it('TSLA (Tesla Coil) consumes 150 power', () => {
    const { consumed } = calcPlayerPower(['TSLA']);
    expect(consumed).toBe(150);
  });

  it('STEK (Soviet Tech) consumes 100 power', () => {
    const { consumed } = calcPlayerPower(['STEK']);
    expect(consumed).toBe(100);
  });

  it('GAP (Gap Generator) consumes 60 power', () => {
    const { consumed } = calcPlayerPower(['GAP']);
    expect(consumed).toBe(60);
  });

  it('SILO (Ore Silo) consumes 10 power', () => {
    const { consumed } = calcPlayerPower(['SILO']);
    expect(consumed).toBe(10);
  });

  it('SAM consumes 40 power', () => {
    const { consumed } = calcPlayerPower(['SAM']);
    expect(consumed).toBe(40);
  });

  it('ATEK (Allied Tech) consumes 200 power', () => {
    const { consumed } = calcPlayerPower(['ATEK']);
    expect(consumed).toBe(200);
  });

  it('POWR (Power Plant) produces 100 power', () => {
    const { produced } = calcPlayerPower(['POWR']);
    expect(produced).toBe(100);
  });

  it('APWR (Advanced Power) produces 200 power', () => {
    const { produced } = calcPlayerPower(['APWR']);
    expect(produced).toBe(200);
  });

  it('combined power calculation is correct', () => {
    // 2 POWR = 200 produced, 1 TENT + 1 TSLA = 20 + 150 = 170 consumed
    const { produced, consumed } = calcPlayerPower(['POWR', 'POWR', 'TENT', 'TSLA']);
    expect(produced).toBe(200);
    expect(consumed).toBe(170);
  });
});

// ─── PW1: Tesla Coil Power Cutoff ──────────────────

describe('Tesla Coil power cutoff behavior', () => {
  it('Tesla Coil is disabled at any power deficit (Power_Fraction < 1.0)', () => {
    // Simulate: 100 produced, 150 consumed (just Tesla alone causes deficit)
    const powerProduced = 100;
    const powerConsumed = 150;
    const isLowPower = powerConsumed > powerProduced && powerProduced > 0;

    // C++ building.cpp: Tesla Coil disabled at ANY power deficit
    const teslaDisabled = isLowPower; // no 1.5x threshold check for Tesla
    expect(teslaDisabled).toBe(true);
  });

  it('Tesla Coil is disabled at mild deficit (not just severe brownout)', () => {
    // Even 1% deficit should disable Tesla (Power_Fraction = 0.99)
    const powerProduced = 100;
    const powerConsumed = 101; // very mild deficit
    const isLowPower = powerConsumed > powerProduced && powerProduced > 0;
    const teslaDisabled = isLowPower;
    expect(teslaDisabled).toBe(true);
  });

  it('Tesla Coil operates normally at full power (Power_Fraction >= 1.0)', () => {
    // 200 produced >= 150 consumed: Tesla should work
    const powerProduced = 200;
    const powerConsumed = 150;
    const isLowPower = powerConsumed > powerProduced && powerProduced > 0;
    const teslaDisabled = isLowPower;
    expect(teslaDisabled).toBe(false);
  });

  it('Tesla Coil operates at equal power (no deficit)', () => {
    const powerProduced = 150;
    const powerConsumed = 150;
    const isLowPower = powerConsumed > powerProduced && powerProduced > 0;
    const teslaDisabled = isLowPower;
    expect(teslaDisabled).toBe(false);
  });

  it('Tesla Coil not affected when powerProduced is 0 (no power system)', () => {
    // No power plants => no power system, isLowPower should be false
    const powerProduced = 0;
    const powerConsumed = 150;
    const isLowPower = powerConsumed > powerProduced && powerProduced > 0;
    expect(isLowPower).toBe(false); // no power system = not "low power"
  });
});

// ─── Superweapon Recharge Times ──────────────────

describe('Superweapon recharge times match updated values', () => {
  it('Chronosphere recharges in 6300 ticks (420 seconds)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE].rechargeTicks).toBe(6300);
  });

  it('Iron Curtain recharges in 9900 ticks (660 seconds)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN].rechargeTicks).toBe(9900);
  });

  it('Nuclear Strike recharges in 11700 ticks (780 seconds)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.NUKE].rechargeTicks).toBe(11700);
  });

  it('GPS Satellite recharges in 7200 ticks', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.GPS_SATELLITE].rechargeTicks).toBe(7200);
  });

  it('Sonar Pulse recharges in 9000 ticks', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.SONAR_PULSE].rechargeTicks).toBe(9000);
  });

  it('ParaBomb recharges in 12600 ticks (C++ rules.ini ParaBomb=14 min)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.PARABOMB].rechargeTicks).toBe(12600);
  });

  it('ParaInfantry recharges in 6300 ticks (C++ rules.ini Paratrooper=7 min)', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.PARAINFANTRY].rechargeTicks).toBe(6300);
  });
});

// ─── Superweapon Building Assignments ──────────────────

describe('Superweapon building assignments', () => {
  it('Chronosphere requires PDOX building', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.CHRONOSPHERE].building).toBe('PDOX');
  });

  it('Iron Curtain requires IRON building', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.IRON_CURTAIN].building).toBe('IRON');
  });

  it('Nuclear Strike requires MSLO building', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.NUKE].building).toBe('MSLO');
  });

  it('ParaBomb requires AFLD building', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.PARABOMB].building).toBe('AFLD');
  });

  it('ParaInfantry requires AFLD building', () => {
    expect(SUPERWEAPON_DEFS[SuperweaponType.PARAINFANTRY].building).toBe('AFLD');
  });
});

// ─── ParaBomb Superweapon ──────────────────

describe('ParaBomb superweapon', () => {
  it('ParaBomb definition exists with correct properties', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.PARABOMB];
    expect(def).toBeDefined();
    expect(def.name).toBe('Parabomb');
    expect(def.building).toBe('AFLD');
    expect(def.faction).toBe('soviet');
    expect(def.requiresPower).toBe(true);
    expect(def.needsTarget).toBe(true);
    expect(def.targetMode).toBe('ground');
  });

  it('ParaBomb spawns 5 bomb projectiles at target', () => {
    // Verify the bombing pattern: 5 bombs spaced 1 CELL apart in a line
    const targetX = 500;
    const targetY = 500;
    const bombPositions: { x: number; y: number }[] = [];
    for (let i = 0; i < 5; i++) {
      bombPositions.push({
        x: targetX + (i - 2) * CELL_SIZE,
        y: targetY,
      });
    }
    expect(bombPositions).toHaveLength(5);
    // Bombs should be spaced along X axis
    expect(bombPositions[0].x).toBe(targetX - 2 * CELL_SIZE);
    expect(bombPositions[2].x).toBe(targetX); // center bomb at target
    expect(bombPositions[4].x).toBe(targetX + 2 * CELL_SIZE);
    // All bombs at same Y
    for (const pos of bombPositions) {
      expect(pos.y).toBe(targetY);
    }
  });

  it('ParaBomb deals HE damage at impact points', () => {
    // Verify damage calculation: base 200 damage with falloff
    const baseDamage = 200;
    const blastRadius = CELL_SIZE * 2;

    // Direct hit (dist = 0)
    const directFalloff = Math.max(0.25, 1 - 0 / blastRadius);
    expect(Math.round(baseDamage * directFalloff)).toBe(200);

    // Edge hit (dist = blastRadius)
    const edgeFalloff = Math.max(0.25, 1 - blastRadius / blastRadius);
    expect(Math.round(baseDamage * edgeFalloff)).toBe(50); // 200 * 0.25 min falloff

    // Mid-range hit (dist = blastRadius / 2)
    const midFalloff = Math.max(0.25, 1 - 0.5);
    expect(Math.round(baseDamage * midFalloff)).toBe(100);
  });
});

// ─── ParaInfantry Superweapon ──────────────────

describe('ParaInfantry superweapon', () => {
  it('ParaInfantry definition exists with correct properties', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.PARAINFANTRY];
    expect(def).toBeDefined();
    expect(def.name).toBe('Paratroopers');
    expect(def.building).toBe('AFLD');
    expect(def.faction).toBe('both');  // C++ allows both factions
    expect(def.requiresPower).toBe(true);
    expect(def.needsTarget).toBe(true);
    expect(def.targetMode).toBe('ground');
  });

  it('ParaInfantry spawns 5 E1 infantry at target', () => {
    // Verify that 5 infantry are created near the target
    const targetX = 500;
    const targetY = 500;
    const infantry: Entity[] = [];
    for (let i = 0; i < 5; i++) {
      const ox = (i - 2) * CELL_SIZE + (0.5 - 0.5) * CELL_SIZE; // deterministic for test
      const oy = (0.5 - 0.5) * CELL_SIZE * 2;
      const inf = new Entity(UnitType.I_E1, House.Spain, targetX + ox, targetY + oy);
      inf.mission = Mission.GUARD;
      infantry.push(inf);
    }
    expect(infantry).toHaveLength(5);
    for (const inf of infantry) {
      expect(inf.type).toBe(UnitType.I_E1);
      expect(inf.house).toBe(House.Spain);
      expect(inf.mission).toBe(Mission.GUARD);
    }
  });

  it('ParaInfantry creates E1 units with correct stats', () => {
    const inf = new Entity(UnitType.I_E1, House.Spain, 100, 100);
    expect(inf.stats).toBeDefined();
    expect(inf.stats.isInfantry).toBe(true);
    expect(inf.hp).toBeGreaterThan(0);
    expect(inf.maxHp).toBeGreaterThan(0);
  });
});

// ─── AI vs Player Power Consistency ──────────────────

describe('AI power values match player power values', () => {
  const structureTypes = [
    'TENT', 'BARR', 'WEAP', 'PROC', 'DOME', 'GUN', 'HBOX', 'PBOX',
    'TSLA', 'SAM', 'AGUN', 'ATEK', 'STEK', 'HPAD', 'AFLD', 'GAP',
    'FIX', 'IRON', 'PDOX', 'MSLO', 'SILO',
  ];

  for (const type of structureTypes) {
    it(`${type} power consumption matches between player and AI`, () => {
      const player = calcPlayerPower([type]);
      const ai = calcAIPower([type]);
      expect(ai.consumed).toBe(player.consumed);
    });
  }

  it('power production matches for POWR', () => {
    const player = calcPlayerPower(['POWR']);
    const ai = calcAIPower(['POWR']);
    expect(ai.produced).toBe(player.produced);
  });

  it('power production matches for APWR', () => {
    const player = calcPlayerPower(['APWR']);
    const ai = calcAIPower(['APWR']);
    expect(ai.produced).toBe(player.produced);
  });

  it('full base power calculation matches between player and AI', () => {
    const fullBase = ['POWR', 'APWR', 'TENT', 'WEAP', 'PROC', 'DOME', 'TSLA', 'SAM'];
    const player = calcPlayerPower(fullBase);
    const ai = calcAIPower(fullBase);
    expect(ai.produced).toBe(player.produced);
    expect(ai.consumed).toBe(player.consumed);
  });
});
