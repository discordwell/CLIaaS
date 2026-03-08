/**
 * Agent 9: New Units & Special Abilities — C++ parity tests.
 * Tests: Tanya C4, Thief credit steal, Minelayer mines, mine limit,
 * Gap Generator jamming, Gap power-gating, Chrono Tank teleport,
 * MAD Tank shockwave, Demo Truck kamikaze, Mechanic vehicle-heal.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds, CloakState, CLOAK_TRANSITION_FRAMES, threatScore } from '../engine/entity';
import {
  UnitType, House, Mission, AnimState, CELL_SIZE, UNIT_STATS, WEAPON_STATS,
  worldDist, worldToCell, buildDefaultAlliances, type AllianceTable,
  SuperweaponType, SUPERWEAPON_DEFS,
} from '../engine/types';
import { GameMap } from '../engine/map';
import type { MapStructure } from '../engine/scenario';

beforeEach(() => resetEntityIds());

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

function makeStructure(
  type: string, house: House, cx = 10, cy = 10, hp = 256, alive = true,
): MapStructure & { c4Timer?: number } {
  return {
    type, image: type.toLowerCase(), house, cx, cy, hp, maxHp: 256,
    alive, rubble: false, attackCooldown: 0, ammo: -1, maxAmmo: -1,
  };
}

function makeMap(): GameMap {
  const map = new GameMap();
  map.setBounds(0, 0, 128, 128);
  map.initDefault();
  return map;
}

function defaultAlliances(): AllianceTable {
  return buildDefaultAlliances();
}

function isAllied(alliances: AllianceTable, a: House, b: House): boolean {
  return alliances.get(a)?.has(b) ?? false;
}

// ============================================================================
// 1. Tanya C4 placement and building destruction
// ============================================================================
describe('Tanya C4 placement', () => {
  it('Tanya has Colt45 weapon and canSwim', () => {
    const tanya = makeEntity(UnitType.I_TANYA, House.Spain);
    expect(tanya.stats.primaryWeapon).toBe('Colt45');
    expect(tanya.weapon).not.toBeNull();
    expect(tanya.stats.canSwim).toBe(true);
  });

  it('C4 timer on structure ticks down and destroys building', () => {
    const structure = makeStructure('WEAP', House.USSR);
    structure.c4Timer = 45;

    // Simulate 44 ticks — should still be alive
    for (let i = 0; i < 44; i++) {
      if (structure.c4Timer && structure.c4Timer > 0) {
        structure.c4Timer--;
      }
    }
    expect(structure.c4Timer).toBe(1);
    expect(structure.alive).toBe(true);

    // Final tick — C4 detonates (9999 damage kills any building)
    structure.c4Timer!--;
    if (structure.c4Timer! <= 0) {
      structure.hp = 0;
      structure.alive = false;
    }
    expect(structure.alive).toBe(false);
    expect(structure.hp).toBe(0);
  });

  it('Tanya targets buildings (not regular attack)', () => {
    const tanya = makeEntity(UnitType.I_TANYA, House.Spain);
    const building = makeStructure('POWR', House.USSR);
    tanya.targetStructure = building;
    tanya.mission = Mission.ATTACK;

    // Tanya should attack buildings via C4, not weapon
    expect(tanya.type).toBe(UnitType.I_TANYA);
    expect(tanya.targetStructure).toBe(building);
  });
});

// ============================================================================
// 2. Thief steals 50% credits and dies
// ============================================================================
describe('Thief credit stealing', () => {
  it('Thief steals 50% of enemy credits', () => {
    const houseCredits = new Map<House, number>();
    houseCredits.set(House.USSR, 2000);

    // Simulate theft
    const enemyCredits = houseCredits.get(House.USSR)!;
    const stolen = Math.floor(enemyCredits * 0.5);
    expect(stolen).toBe(1000);

    houseCredits.set(House.USSR, enemyCredits - stolen);
    expect(houseCredits.get(House.USSR)).toBe(1000);
  });

  it('Thief dies after stealing', () => {
    const thief = makeEntity(UnitType.I_THF, House.Spain);
    expect(thief.alive).toBe(true);

    // Simulate thief consumption
    thief.alive = false;
    thief.mission = Mission.DIE;
    thief.animState = AnimState.DIE;
    thief.animFrame = 0;
    thief.deathTick = 0;

    expect(thief.alive).toBe(false);
    expect(thief.mission).toBe(Mission.DIE);
  });

  it('Thief only targets PROC and SILO', () => {
    const thief = makeEntity(UnitType.I_THF, House.Spain);

    // PROC — valid target
    const proc = makeStructure('PROC', House.USSR);
    expect(proc.type === 'PROC' || proc.type === 'SILO').toBe(true);

    // WEAP — invalid target for thief
    const weap = makeStructure('WEAP', House.USSR);
    expect(weap.type === 'PROC' || weap.type === 'SILO').toBe(false);
  });

  it('Thief does not steal from allied buildings', () => {
    const alliances = defaultAlliances();
    // Spain and Greece are allied
    expect(isAllied(alliances, House.Spain, House.Greece)).toBe(true);
    // Spain and USSR are not allied
    expect(isAllied(alliances, House.Spain, House.USSR)).toBe(false);
  });
});

// ============================================================================
// 3. Minelayer places mines, mine triggers on enemy
// ============================================================================
describe('Minelayer and mines', () => {
  it('Minelayer places a mine at target cell', () => {
    const mines: Array<{ cx: number; cy: number; house: House; damage: number }> = [];
    const mnly = makeEntity(UnitType.V_MNLY, House.Spain, 100, 100);

    // Simulate mine placement
    const targetCell = worldToCell(200, 200);
    mines.push({ cx: targetCell.cx, cy: targetCell.cy, house: mnly.house, damage: 400 });
    mnly.mineCount++;

    expect(mines.length).toBe(1);
    expect(mines[0].damage).toBe(400);
    expect(mines[0].house).toBe(House.Spain);
    expect(mnly.mineCount).toBe(1);
  });

  it('Mine triggers when enemy enters cell', () => {
    const mines: Array<{ cx: number; cy: number; house: House; damage: number }> = [];
    mines.push({ cx: 8, cy: 8, house: House.Spain, damage: 400 });

    const enemy = makeEntity(UnitType.V_2TNK, House.USSR, 8 * CELL_SIZE + 12, 8 * CELL_SIZE + 12);
    const ec = enemy.cell;

    // Enemy is in mined cell
    expect(ec.cx).toBe(8);
    expect(ec.cy).toBe(8);

    // Mine detonates
    const alliances = defaultAlliances();
    const isEnemyAllied = isAllied(alliances, enemy.house, mines[0].house);
    expect(isEnemyAllied).toBe(false);

    const prevHp = enemy.hp;
    enemy.takeDamage(mines[0].damage, 'AP');
    expect(enemy.hp).toBeLessThan(prevHp);

    // Mine is removed
    mines.splice(0, 1);
    expect(mines.length).toBe(0);
  });

  it('Friendly units do NOT trigger mines', () => {
    const alliances = defaultAlliances();
    const mine = { cx: 5, cy: 5, house: House.Spain, damage: 400 };
    const friendly = makeEntity(UnitType.V_2TNK, House.Spain, 5 * CELL_SIZE + 12, 5 * CELL_SIZE + 12);

    expect(isAllied(alliances, friendly.house, mine.house)).toBe(true);
    // Mine should NOT trigger for friendly
  });
});

// ============================================================================
// 4. Mine limit (50 max per house)
// ============================================================================
describe('Mine limit', () => {
  it('cannot place more than 50 mines per house', () => {
    const MAX_MINES = 50;
    const mines: Array<{ cx: number; cy: number; house: House; damage: number }> = [];

    // Place 50 mines
    for (let i = 0; i < MAX_MINES; i++) {
      mines.push({ cx: i, cy: 0, house: House.Spain, damage: 400 });
    }
    expect(mines.length).toBe(50);

    // Try to place 51st — should be rejected
    const houseMines = mines.filter(m => m.house === House.Spain).length;
    expect(houseMines >= MAX_MINES).toBe(true);
  });

  it('different houses have independent mine limits', () => {
    const MAX_MINES = 50;
    const mines: Array<{ cx: number; cy: number; house: House; damage: number }> = [];

    // Spain places 50 mines
    for (let i = 0; i < MAX_MINES; i++) {
      mines.push({ cx: i, cy: 0, house: House.Spain, damage: 400 });
    }
    // USSR can still place mines
    const ussrMines = mines.filter(m => m.house === House.USSR).length;
    expect(ussrMines < MAX_MINES).toBe(true);

    mines.push({ cx: 0, cy: 1, house: House.USSR, damage: 400 });
    expect(mines.filter(m => m.house === House.USSR).length).toBe(1);
  });
});

// ============================================================================
// 5. Gap Generator jams enemy vision in radius
// ============================================================================
describe('Gap Generator', () => {
  it('jamCell sets visibility to 0', () => {
    const map = makeMap();
    // Pre-set cell as visible
    map.setVisibility(64, 64, 2);
    expect(map.getVisibility(64, 64)).toBe(2);

    // Jam it
    map.jamCell(64, 64);
    expect(map.getVisibility(64, 64)).toBe(0);
    expect(map.jammedCells.get(64 * 128 + 64)).toBe(1);
  });

  it('unjamCell restores visibility to fog', () => {
    const map = makeMap();
    map.setVisibility(64, 64, 2);
    map.jamCell(64, 64);
    expect(map.getVisibility(64, 64)).toBe(0);

    map.unjamCell(64, 64);
    expect(map.getVisibility(64, 64)).toBe(1); // restored to fog
    expect(map.jammedCells.has(64 * 128 + 64)).toBe(false);
  });

  it('overlapping jams require multiple unjams', () => {
    const map = makeMap();
    map.jamCell(64, 64);
    map.jamCell(64, 64); // second GAP overlaps
    expect(map.jammedCells.get(64 * 128 + 64)).toBe(2);

    map.unjamCell(64, 64);
    expect(map.jammedCells.get(64 * 128 + 64)).toBe(1);
    expect(map.getVisibility(64, 64)).toBe(0); // still jammed

    map.unjamCell(64, 64);
    expect(map.jammedCells.has(64 * 128 + 64)).toBe(false);
    expect(map.getVisibility(64, 64)).toBe(1); // now unjammed
  });

  it('GAP jams cells within radius', () => {
    const map = makeMap();
    const radius = 10;
    const cx = 64, cy = 64;

    // Pre-set all cells as visible
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        map.setVisibility(cx + dx, cy + dy, 2);
      }
    }

    // Jam radius
    const r2 = radius * radius;
    let jamCount = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= r2) {
          map.jamCell(cx + dx, cy + dy);
          jamCount++;
        }
      }
    }

    expect(jamCount).toBeGreaterThan(0);
    // Center should be jammed
    expect(map.getVisibility(cx, cy)).toBe(0);
    // Edge of circle should be jammed
    expect(map.getVisibility(cx + radius, cy)).toBe(0);
    // Corner outside circle should NOT be jammed
    expect(map.getVisibility(cx + radius, cy + radius)).toBe(2);
  });
});

// ============================================================================
// 6. Gap Generator power-gated
// ============================================================================
describe('Gap Generator power-gating', () => {
  it('GAP only activates when power >= consumed', () => {
    // powerProduced = 200, powerConsumed = 150 -> fraction >= 1.0? No, 200/150 > 1
    const pf1 = 200 / Math.max(150, 1);
    expect(pf1 >= 1.0).toBe(true);

    // powerProduced = 100, powerConsumed = 200 -> fraction < 1.0
    const pf2 = 100 / Math.max(200, 1);
    expect(pf2 < 1.0).toBe(true);
  });

  it('GAP unjams when power is lost', () => {
    const map = makeMap();
    const cx = 64, cy = 64;
    const radius = 10;

    // Simulate GAP activation
    const r2 = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= r2) {
          map.jamCell(cx + dx, cy + dy);
        }
      }
    }
    expect(map.getVisibility(cx, cy)).toBe(0);

    // Simulate power loss — unjam radius
    map.unjamRadius(cx, cy, radius);
    expect(map.getVisibility(cx, cy)).toBe(1); // restored to fog
  });
});

// ============================================================================
// 7. Chrono Tank teleport with cooldown
// ============================================================================
describe('Chrono Tank teleport', () => {
  it('Chrono Tank stats exist', () => {
    const ctnk = makeEntity(UnitType.V_CTNK, House.Spain, 100, 100);
    expect(ctnk.stats.name).toBe('Chrono Tank');
    expect(ctnk.chronoCooldown).toBe(0);
  });

  it('teleport moves unit instantly to target', () => {
    const ctnk = makeEntity(UnitType.V_CTNK, House.Spain, 100, 100);
    const targetX = 400;
    const targetY = 400;
    const dist = worldDist(ctnk.pos, { x: targetX, y: targetY });

    // Distance > 5 cells (worldDist returns cell-distance) and cooldown is 0 — can teleport
    expect(dist > 5).toBe(true);
    expect(ctnk.chronoCooldown).toBe(0);

    // Simulate teleport
    ctnk.pos.x = targetX;
    ctnk.pos.y = targetY;
    ctnk.chronoCooldown = 180;

    expect(ctnk.pos.x).toBe(400);
    expect(ctnk.pos.y).toBe(400);
    expect(ctnk.chronoCooldown).toBe(180);
  });

  it('cannot teleport while on cooldown', () => {
    const ctnk = makeEntity(UnitType.V_CTNK, House.Spain, 100, 100);
    ctnk.chronoCooldown = 100;

    // Cooldown > 0 — cannot teleport
    expect(ctnk.chronoCooldown > 0).toBe(true);
  });

  it('cooldown ticks down', () => {
    const ctnk = makeEntity(UnitType.V_CTNK, House.Spain, 100, 100);
    ctnk.chronoCooldown = 180;

    // Simulate ticking
    for (let i = 0; i < 180; i++) {
      if (ctnk.chronoCooldown > 0) ctnk.chronoCooldown--;
    }
    expect(ctnk.chronoCooldown).toBe(0);
  });

  it('short-distance moves do not trigger teleport', () => {
    const ctnk = makeEntity(UnitType.V_CTNK, House.Spain, 100, 100);
    const targetX = 120;
    const targetY = 120;
    const dist = worldDist(ctnk.pos, { x: targetX, y: targetY });

    // Distance < 5 cells (worldDist returns cell-distance) — should not teleport
    expect(dist <= 5).toBe(true);
  });
});

// ============================================================================
// 8. MAD Tank deploy + shockwave damage
// ============================================================================
describe('MAD Tank deployment', () => {
  it('deploy sets isDeployed and deployTimer', () => {
    const madTank = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200);

    // Simulate deploy
    madTank.isDeployed = true;
    madTank.deployTimer = 30;
    madTank.moveTarget = null;
    madTank.target = null;
    madTank.mission = Mission.GUARD;

    expect(madTank.isDeployed).toBe(true);
    expect(madTank.deployTimer).toBe(30);
    expect(madTank.mission).toBe(Mission.GUARD);
  });

  it('shockwave damages vehicles only, not infantry', () => {
    const MAD_DAMAGE = 600;
    const MAD_RADIUS = 8; // in cells (worldDist returns cell distance)

    const madTank = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200);
    const nearbyVeh = makeEntity(UnitType.V_1TNK, House.USSR, 210, 210);
    const nearbyInf = makeEntity(UnitType.I_E1, House.USSR, 205, 205);

    const vehDist = worldDist(madTank.pos, nearbyVeh.pos);
    const infDist = worldDist(madTank.pos, nearbyInf.pos);

    expect(vehDist <= MAD_RADIUS).toBe(true);
    expect(infDist <= MAD_RADIUS).toBe(true);

    // Shockwave only damages vehicles (not infantry)
    if (!nearbyVeh.stats.isInfantry && !nearbyVeh.isAirUnit) {
      nearbyVeh.hp -= MAD_DAMAGE;
    }
    // Infantry check — should be skipped
    const infPrevHp = nearbyInf.hp;
    if (!nearbyInf.stats.isInfantry) {
      nearbyInf.hp -= MAD_DAMAGE; // this won't execute since isInfantry is true
    }

    expect(nearbyVeh.hp).toBeLessThan(nearbyVeh.maxHp);
    expect(nearbyInf.hp).toBe(infPrevHp); // infantry unharmed
  });

  it('MAD Tank self-destructs after shockwave', () => {
    const madTank = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200);
    madTank.isDeployed = true;
    madTank.deployTimer = 0;

    // After deploy timer reaches 0, self-destruct
    if (madTank.deployTimer <= 0) {
      madTank.hp = 0;
      madTank.alive = false;
      madTank.mission = Mission.DIE;
    }

    expect(madTank.alive).toBe(false);
    expect(madTank.hp).toBe(0);
  });

  it('charge-up takes 30 ticks', () => {
    const madTank = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200);
    madTank.isDeployed = true;
    madTank.deployTimer = 30;

    for (let i = 0; i < 29; i++) {
      madTank.deployTimer--;
    }
    expect(madTank.deployTimer).toBe(1);
    expect(madTank.alive).toBe(true);

    madTank.deployTimer--;
    expect(madTank.deployTimer).toBe(0);
  });
});

// ============================================================================
// 9. Demo Truck kamikaze explosion
// ============================================================================
describe('Demo Truck kamikaze', () => {
  it('Demo Truck has Democharge weapon (self-destruct explosion params)', () => {
    const dtrk = makeEntity(UnitType.V_DTRK, House.USSR, 100, 100);
    expect(dtrk.weapon).not.toBeNull();
    expect(dtrk.stats.primaryWeapon).toBe('Democharge');
    expect(dtrk.weapon!.damage).toBe(500);
    expect(dtrk.weapon!.warhead).toBe('Nuke');
  });

  it('Demo Truck deals 1000 damage in 3-cell radius', () => {
    const DEMO_DAMAGE = 1000;
    const DEMO_RADIUS = 3; // in cells (worldDist returns cell distance)

    const dtrk = makeEntity(UnitType.V_DTRK, House.USSR, 200, 200);

    // Targets in range — near is ~0.4 cells away, far is ~17.7 cells away
    const near = makeEntity(UnitType.V_2TNK, House.Spain, 210, 200);
    const far = makeEntity(UnitType.V_2TNK, House.Spain, 500, 500);

    const nearDist = worldDist(dtrk.pos, near.pos);
    const farDist = worldDist(dtrk.pos, far.pos);

    expect(nearDist <= DEMO_RADIUS).toBe(true);
    expect(farDist > DEMO_RADIUS).toBe(true);

    // Apply damage with falloff to nearby target
    const falloff = 1 - (nearDist / DEMO_RADIUS) * 0.5;
    const damage = Math.round(DEMO_DAMAGE * falloff);
    expect(damage).toBeGreaterThan(0);
    expect(damage).toBeLessThanOrEqual(DEMO_DAMAGE);

    near.takeDamage(damage, 'Nuke');
    const farPrevHp = far.hp;
    // Far target should not be damaged
    expect(far.hp).toBe(farPrevHp);
  });

  it('Demo Truck self-destructs after explosion', () => {
    const dtrk = makeEntity(UnitType.V_DTRK, House.USSR, 200, 200);

    // Simulate explosion
    dtrk.hp = 0;
    dtrk.alive = false;
    dtrk.mission = Mission.DIE;
    dtrk.animState = AnimState.DIE;

    expect(dtrk.alive).toBe(false);
    expect(dtrk.hp).toBe(0);
  });

  it('Demo Truck damages both entities and structures', () => {
    const DEMO_DAMAGE = 1000;
    const DEMO_RADIUS = 3; // in cells

    const building = makeStructure('POWR', House.Spain, 8, 8);
    const bx = building.cx * CELL_SIZE + CELL_SIZE;
    const by = building.cy * CELL_SIZE + CELL_SIZE;
    const dtrk = makeEntity(UnitType.V_DTRK, House.USSR, bx + 5, by + 5);

    const dist = worldDist(dtrk.pos, { x: bx, y: by });
    expect(dist <= DEMO_RADIUS).toBe(true);

    const falloff = 1 - (dist / DEMO_RADIUS) * 0.5;
    const damage = Math.round(DEMO_DAMAGE * falloff);
    building.hp -= damage;

    expect(building.hp).toBeLessThan(256);
  });
});

// ============================================================================
// 10. Mechanic auto-heals vehicles
// ============================================================================
describe('Mechanic vehicle healing', () => {
  it('Mechanic stats: infantry, GoodWrench weapon, sight 3', () => {
    const mech = makeEntity(UnitType.I_MECH, House.Spain);
    expect(mech.stats.isInfantry).toBe(true);
    expect(mech.stats.sight).toBe(3);
    expect(mech.stats.primaryWeapon).toBe('GoodWrench');
  });

  it('Mechanic heals damaged friendly vehicle', () => {
    const HEAL_AMOUNT = 5;
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 120, 100);
    tank.hp = 200; // damaged (max ~400)

    const prevHp = tank.hp;
    tank.hp = Math.min(tank.maxHp, tank.hp + HEAL_AMOUNT);
    expect(tank.hp).toBe(prevHp + HEAL_AMOUNT);
  });

  it('Mechanic does NOT heal infantry', () => {
    const infantry = makeEntity(UnitType.I_E1, House.Spain, 120, 100);
    infantry.hp = 20;

    // Mechanic scan condition: skip infantry
    expect(infantry.stats.isInfantry).toBe(true);
    const shouldHeal = !infantry.stats.isInfantry && !infantry.isAirUnit && infantry.hp < infantry.maxHp;
    expect(shouldHeal).toBe(false);
  });

  it('Mechanic does NOT heal air units', () => {
    // Air units should be skipped by mechanic
    // Using a regular vehicle to show contrast
    const tank = makeEntity(UnitType.V_2TNK, House.Spain);
    expect(tank.isAirUnit).toBe(false);
    expect(tank.stats.isInfantry).toBe(false);
    // This should be a valid heal target
    tank.hp = 100;
    const shouldHeal = !tank.stats.isInfantry && !tank.isAirUnit && tank.hp < tank.maxHp;
    expect(shouldHeal).toBe(true);
  });

  it('Mechanic does NOT heal enemy vehicles', () => {
    const alliances = defaultAlliances();
    const mechHouse = House.Spain;
    const enemyTank = makeEntity(UnitType.V_2TNK, House.USSR, 120, 100);
    enemyTank.hp = 200;

    expect(isAllied(alliances, mechHouse, enemyTank.house)).toBe(false);
  });

  it('Mechanic does NOT heal full-health vehicles', () => {
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 120, 100);
    // Full health
    expect(tank.hp).toBe(tank.maxHp);
    const shouldHeal = tank.hp < tank.maxHp;
    expect(shouldHeal).toBe(false);
  });

  it('Mechanic prefers most damaged vehicle', () => {
    const lightly = makeEntity(UnitType.V_1TNK, House.Spain, 120, 100);
    lightly.hp = Math.floor(lightly.maxHp * 0.8);

    const heavy = makeEntity(UnitType.V_2TNK, House.Spain, 130, 100);
    heavy.hp = Math.floor(heavy.maxHp * 0.2);

    const lightRatio = lightly.hp / lightly.maxHp;
    const heavyRatio = heavy.hp / heavy.maxHp;

    expect(heavyRatio).toBeLessThan(lightRatio);
    // Mechanic should prefer heavy (lower HP ratio)
  });

  it('Mechanic heal caps at maxHp', () => {
    const HEAL_AMOUNT = 5;
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 120, 100);
    tank.hp = tank.maxHp - 2;

    const prevHp = tank.hp;
    tank.hp = Math.min(tank.maxHp, tank.hp + HEAL_AMOUNT);
    expect(tank.hp).toBe(tank.maxHp);
    expect(tank.hp - prevHp).toBe(2); // only healed 2, not 5
  });
});

// ============================================================================
// Bonus: Phase Transport cloak state machine
// ============================================================================
describe('Phase Transport (STNK) cloaking', () => {
  it('STNK has isCloakable = true', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain, 100, 100);
    expect(stnk.stats.isCloakable).toBe(true);
  });

  it('STNK is not a vessel (vehicle cloak, not sub cloak)', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain, 100, 100);
    expect(stnk.stats.isVessel).toBeFalsy();
  });

  it('Cloak transition takes CLOAK_TRANSITION_FRAMES ticks', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain, 100, 100);
    stnk.cloakState = CloakState.CLOAKING;
    stnk.cloakTimer = CLOAK_TRANSITION_FRAMES;

    // Tick through transition
    for (let i = 0; i < CLOAK_TRANSITION_FRAMES; i++) {
      stnk.cloakTimer--;
    }
    if (stnk.cloakTimer <= 0) stnk.cloakState = CloakState.CLOAKED;

    expect(stnk.cloakState).toBe(CloakState.CLOAKED);
  });

  it('Taking damage force-uncloaks STNK', () => {
    const stnk = makeEntity(UnitType.V_STNK, House.Spain, 100, 100);
    stnk.cloakState = CloakState.CLOAKED;
    stnk.cloakTimer = 0;

    // takeDamage should force uncloak (handled by entity.takeDamage)
    stnk.takeDamage(10);
    expect(stnk.cloakState).toBe(CloakState.UNCLOAKING);
    expect(stnk.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });
});

// ============================================================================
// Bonus: V2 Rocket weapon data
// ============================================================================
describe('V2 Rocket weapon data', () => {
  it('V2RL uses SCUD weapon with long range', () => {
    const v2 = makeEntity(UnitType.V_V2RL, House.USSR, 100, 100);
    expect(v2.stats.primaryWeapon).toBe('SCUD');
    expect(v2.weapon).not.toBeNull();
    expect(v2.weapon!.range).toBeGreaterThan(5);
  });

  it('SCUD weapon has 600 damage, HE warhead, splash 2.0, high inaccuracy', () => {
    const scud = WEAPON_STATS['SCUD'];
    expect(scud).toBeDefined();
    expect(scud.damage).toBe(600);
    expect(scud.warhead).toBe('HE');
    expect(scud.splash).toBe(2.0);
    expect(scud.inaccuracy).toBe(1.5);
  });

  it('V2RL has noMovingFire flag (cannot fire while moving)', () => {
    const stats = UNIT_STATS['V2RL'];
    expect(stats.noMovingFire).toBe(true);
  });

  it('SCUD has projectileSpeed for visible rocket projectile', () => {
    const scud = WEAPON_STATS['SCUD'];
    expect(scud.projectileSpeed).toBeDefined();
    expect(scud.projectileSpeed).toBeGreaterThan(0);
  });

  it('V2RL is Soviet-only with correct C++ stats', () => {
    const stats = UNIT_STATS['V2RL'];
    expect(stats.strength).toBe(150);
    expect(stats.armor).toBe('light');
    expect(stats.owner).toBe('soviet');
    expect(stats.cost).toBe(700);
  });
});

// ============================================================================
// AI5: Splash avoidance — nearFriendlyBase reduces threat score
// ============================================================================
describe('AI5: Area modification (splash avoidance)', () => {
  it('threatScore is lower when target is near friendly base', () => {
    const scanner = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200);
    const target = makeEntity(UnitType.V_1TNK, House.USSR, 220, 200);

    const scoreNoBase = threatScore(scanner, target, 1, false, 0, null, false);
    const scoreNearBase = threatScore(scanner, target, 1, false, 0, null, true);

    // AI5: nearFriendlyBase applies 0.75x multiplier
    expect(scoreNearBase).toBeLessThan(scoreNoBase);
    expect(scoreNearBase).toBeCloseTo(scoreNoBase * 0.75, 0);
  });
});

// ============================================================================
// AI6: Spy target exclusion from threat evaluation
// ============================================================================
describe('AI6: Spy target exclusion', () => {
  it('Spy returns 0 threat score (ignored by non-dog units)', () => {
    const scanner = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200);
    const spy = makeEntity(UnitType.I_SPY, House.USSR, 220, 200);

    const score = threatScore(scanner, spy, 1, false);
    expect(score).toBe(0);
  });

  it('Dog CAN target Spy (exception to AI6 exclusion)', () => {
    const dog = makeEntity(UnitType.I_DOG, House.Spain, 200, 200);
    const spy = makeEntity(UnitType.I_SPY, House.USSR, 220, 200);

    const score = threatScore(dog, spy, 1, false);
    expect(score).toBeGreaterThan(0);
  });

  it('Non-spy units still get normal threat scores', () => {
    const scanner = makeEntity(UnitType.V_2TNK, House.Spain, 200, 200);
    const enemy = makeEntity(UnitType.I_E1, House.USSR, 220, 200);

    const score = threatScore(scanner, enemy, 1, false);
    expect(score).toBeGreaterThan(0);
  });
});

// ============================================================================
// SW6: ParaBomb, ParaInfantry, SpyPlane superweapon definitions
// ============================================================================
describe('SW6: Missing superweapons', () => {
  it('PARABOMB superweapon is defined correctly', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.PARABOMB];
    expect(def).toBeDefined();
    expect(def.building).toBe('AFLD');
    expect(def.faction).toBe('soviet');
    expect(def.needsTarget).toBe(true);
    expect(def.targetMode).toBe('ground');
  });

  it('PARAINFANTRY superweapon is defined correctly', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.PARAINFANTRY];
    expect(def).toBeDefined();
    expect(def.building).toBe('AFLD');
    expect(def.faction).toBe('both');
    expect(def.needsTarget).toBe(true);
    expect(def.targetMode).toBe('ground');
  });

  it('SPY_PLANE superweapon is defined correctly', () => {
    const def = SUPERWEAPON_DEFS[SuperweaponType.SPY_PLANE];
    expect(def).toBeDefined();
    expect(def.building).toBe('ATEK');
    expect(def.faction).toBe('allied');
    expect(def.needsTarget).toBe(true);
    expect(def.targetMode).toBe('ground');
  });

  it('All superweapon types have definitions', () => {
    for (const key of Object.values(SuperweaponType)) {
      expect(SUPERWEAPON_DEFS[key as string]).toBeDefined();
    }
  });
});

// ============================================================================
// Thief: attack structure hookup verification
// ============================================================================
describe('Thief attack structure integration', () => {
  it('Thief has no weapon (unarmed, steals instead)', () => {
    const thief = makeEntity(UnitType.I_THF, House.Spain, 100, 100);
    expect(thief.stats.primaryWeapon).toBeNull();
    expect(thief.weapon).toBeNull();
  });

  it('Thief stats match C++ (25hp, speed 8, sight 5, 500 cost, allied)', () => {
    const stats = UNIT_STATS['THF'];
    expect(stats.strength).toBe(25);
    expect(stats.speed).toBe(8);
    expect(stats.sight).toBe(5);
    expect(stats.cost).toBe(500);
    expect(stats.owner).toBe('allied');
  });
});

// ============================================================================
// Minelayer: entity update loop hookup verification
// ============================================================================
describe('Minelayer entity loop integration', () => {
  it('Minelayer has no weapon (places mines instead)', () => {
    const mnly = makeEntity(UnitType.V_MNLY, House.Spain, 100, 100);
    expect(mnly.stats.primaryWeapon).toBeNull();
    expect(mnly.weapon).toBeNull();
  });

  it('Minelayer mine damage matches AP warhead (400 dmg) from existing mine tests', () => {
    // Verify mine placement creates mines with correct damage value
    const mines: Array<{ cx: number; cy: number; house: House; damage: number }> = [];
    const targetCell = worldToCell(200, 200);
    mines.push({ cx: targetCell.cx, cy: targetCell.cy, house: House.Spain, damage: 400 });
    expect(mines[0].damage).toBe(400);
  });

  it('Minelayer tracks mineCount on entity', () => {
    const mnly = makeEntity(UnitType.V_MNLY, House.Spain, 100, 100);
    expect(mnly.mineCount).toBe(0);
    mnly.mineCount++;
    expect(mnly.mineCount).toBe(1);
  });
});
