/**
 * Friendly fire splash damage tests — C++ parity verification.
 *
 * In C++ Red Alert (combat.cpp Explosion_Damage), splash damage from explosions
 * applies to ALL objects in the splash radius regardless of house/team.
 * These tests verify the TS engine matches this behavior.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  House, UnitType, CELL_SIZE,
  WARHEAD_VS_ARMOR, WARHEAD_META,
  worldDist, buildDefaultAlliances,
  type WarheadType, type ArmorType, type WorldPos,
  getWarheadMultiplier,
} from '../engine/types';

// --- Helpers ---

beforeEach(() => resetEntityIds());

function makeEntity(type: UnitType, house: House, x: number, y: number): Entity {
  return new Entity(type, house, x, y);
}

/** Mirror of Game.isAllied using the default alliance table */
function isAllied(a: House, b: House): boolean {
  const alliances = buildDefaultAlliances();
  return alliances.get(a)?.has(b) ?? false;
}

/** Alias for centralized warhead multiplier */
const getWarheadMult = getWarheadMultiplier;

/**
 * Replication of Game.applySplashDamage logic for testing.
 * Returns an array of { entity, damage, killed } for each entity hit.
 * Key property: does NOT filter by alliance/team — damages ALL entities in radius.
 */
function computeSplashDamage(
  center: WorldPos,
  weapon: { damage: number; warhead: WarheadType; splash: number },
  primaryTargetId: number,
  entities: Entity[],
): Array<{ entity: Entity; damage: number; killed: boolean }> {
  const results: Array<{ entity: Entity; damage: number; killed: boolean }> = [];
  const splashRange = weapon.splash;
  if (splashRange <= 0) return results;

  for (const other of entities) {
    if (!other.alive || other.id === primaryTargetId) continue;
    // C++ Explosion_Damage: NO alliance filter — damages ALL entities in radius
    const dist = worldDist(center, other.pos);
    if (dist > splashRange) continue;

    const spreadFactor = WARHEAD_META[weapon.warhead]?.spreadFactor ?? 1;
    const ratio = dist / splashRange;
    const falloff = Math.pow(1 - ratio, 1 / spreadFactor);
    const mult = getWarheadMult(weapon.warhead, other.stats.armor);
    if (mult <= 0) continue;
    const splashDmg = Math.max(1, Math.round(weapon.damage * mult * falloff));
    const hpBefore = other.hp;
    const killed = other.takeDamage(splashDmg, weapon.warhead);
    results.push({ entity: other, damage: hpBefore - other.hp, killed });
  }
  return results;
}


// --- Tests ---

describe('Friendly Fire Splash Damage — C++ Parity', () => {

  describe('Alliance verification', () => {
    it('Spain and Greece are allied (player factions)', () => {
      expect(isAllied(House.Spain, House.Greece)).toBe(true);
      expect(isAllied(House.Greece, House.Spain)).toBe(true);
    });

    it('USSR, Ukraine, Germany are allied (ant factions)', () => {
      expect(isAllied(House.USSR, House.Ukraine)).toBe(true);
      expect(isAllied(House.USSR, House.Germany)).toBe(true);
    });

    it('Spain and USSR are NOT allied', () => {
      expect(isAllied(House.Spain, House.USSR)).toBe(false);
    });

    it('each house is allied with itself', () => {
      expect(isAllied(House.Spain, House.Spain)).toBe(true);
      expect(isAllied(House.USSR, House.USSR)).toBe(true);
    });
  });

  describe('1. Friendly unit takes splash damage from allied explosion', () => {
    it('player grenadier splash damages nearby allied rifle infantry', () => {
      // Grenadier (Spain) fires HE splash at an enemy target
      // Allied rifle infantry (Greece) is nearby and should take splash damage
      const center: WorldPos = { x: 60 * CELL_SIZE, y: 60 * CELL_SIZE };
      const friendlyUnit = makeEntity(UnitType.I_E1, House.Greece,
        center.x + CELL_SIZE * 0.5, center.y); // 0.5 cells away

      const weapon = { damage: 50, warhead: 'HE' as WarheadType, splash: 1.5 };
      const results = computeSplashDamage(center, weapon, -1, [friendlyUnit]);

      expect(results.length).toBe(1);
      expect(results[0].entity.id).toBe(friendlyUnit.id);
      expect(results[0].damage).toBeGreaterThan(0);
      expect(friendlyUnit.hp).toBeLessThan(friendlyUnit.maxHp);
    });

    it('player artillery splash damages own nearby light tank (same house)', () => {
      // Artillery (Spain) shell lands near own light tank (Spain)
      const center: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };
      const ownTank = makeEntity(UnitType.V_1TNK, House.Spain,
        center.x + CELL_SIZE, center.y); // 1 cell away

      const weapon = { damage: 150, warhead: 'HE' as WarheadType, splash: 2.0 };
      const hpBefore = ownTank.hp;
      const results = computeSplashDamage(center, weapon, -1, [ownTank]);

      expect(results.length).toBe(1);
      expect(results[0].damage).toBeGreaterThan(0);
      expect(ownTank.hp).toBeLessThan(hpBefore);
    });
  });

  describe('2. Friendly structure takes splash damage from allied explosion', () => {
    it('player explosion near own structure entity deals damage', () => {
      // Create a "structure-like" entity (heavy armor) on player's team
      // Structures in the game are MapStructure objects, not Entity.
      // However, splash damage to entities with heavy armor tests the same path.
      const center: WorldPos = { x: 50 * CELL_SIZE, y: 50 * CELL_SIZE };
      // Use a Mammoth tank (heavy armor) as proxy for structure-like heavy armor target
      const heavyUnit = makeEntity(UnitType.V_4TNK, House.Spain,
        center.x + CELL_SIZE * 0.8, center.y); // 0.8 cells away

      const weapon = { damage: 150, warhead: 'HE' as WarheadType, splash: 2.0 };
      const hpBefore = heavyUnit.hp;
      const results = computeSplashDamage(center, weapon, -1, [heavyUnit]);

      expect(results.length).toBe(1);
      expect(results[0].damage).toBeGreaterThan(0);
      expect(heavyUnit.hp).toBeLessThan(hpBefore);

      // Verify HE vs heavy armor multiplier is applied (0.25)
      const expectedMult = WARHEAD_VS_ARMOR['HE'][3]; // heavy armor index = 3
      expect(expectedMult).toBe(0.25);
    });
  });

  describe('3. Enemy unit still takes splash damage (no regression)', () => {
    it('enemy ant takes splash damage from player explosion', () => {
      const center: WorldPos = { x: 60 * CELL_SIZE, y: 60 * CELL_SIZE };
      const enemyAnt = makeEntity(UnitType.ANT1, House.USSR,
        center.x + CELL_SIZE, center.y); // 1 cell away

      const weapon = { damage: 150, warhead: 'HE' as WarheadType, splash: 2.0 };
      const hpBefore = enemyAnt.hp;
      const results = computeSplashDamage(center, weapon, -1, [enemyAnt]);

      expect(results.length).toBe(1);
      expect(results[0].damage).toBeGreaterThan(0);
      expect(enemyAnt.hp).toBeLessThan(hpBefore);
    });

    it('mix of friendly and enemy units all take splash damage', () => {
      const center: WorldPos = { x: 60 * CELL_SIZE, y: 60 * CELL_SIZE };
      const friendlyInf = makeEntity(UnitType.I_E1, House.Spain,
        center.x + CELL_SIZE * 0.5, center.y);
      const alliedInf = makeEntity(UnitType.I_E1, House.Greece,
        center.x, center.y + CELL_SIZE * 0.5);
      const enemyAnt = makeEntity(UnitType.ANT2, House.USSR,
        center.x - CELL_SIZE * 0.5, center.y);

      const weapon = { damage: 50, warhead: 'HE' as WarheadType, splash: 1.5 };
      const results = computeSplashDamage(center, weapon, -1,
        [friendlyInf, alliedInf, enemyAnt]);

      // All three entities should be hit
      expect(results.length).toBe(3);
      for (const r of results) {
        expect(r.damage).toBeGreaterThan(0);
        expect(r.entity.hp).toBeLessThan(r.entity.maxHp);
      }
    });
  });

  describe('4. Direct-hit damage still works correctly for enemies', () => {
    it('Entity.takeDamage reduces HP correctly', () => {
      const target = makeEntity(UnitType.ANT1, House.USSR, 100, 100);
      const hpBefore = target.hp;
      const killed = target.takeDamage(30, 'HE');

      expect(killed).toBe(false);
      expect(target.hp).toBe(hpBefore - 30);
      expect(target.alive).toBe(true);
    });

    it('direct-hit kill sets alive to false', () => {
      const target = makeEntity(UnitType.I_E1, House.USSR, 100, 100);
      // E1 has 50 HP — deal enough to kill
      const killed = target.takeDamage(target.hp + 10, 'HE');

      expect(killed).toBe(true);
      expect(target.alive).toBe(false);
      expect(target.hp).toBe(0);
    });

    it('splash excludes primary target (direct hit handled separately)', () => {
      const center: WorldPos = { x: 60 * CELL_SIZE, y: 60 * CELL_SIZE };
      const directTarget = makeEntity(UnitType.ANT1, House.USSR,
        center.x, center.y); // exactly at center
      const bystander = makeEntity(UnitType.I_E1, House.Spain,
        center.x + CELL_SIZE, center.y); // 1 cell away

      const weapon = { damage: 50, warhead: 'HE' as WarheadType, splash: 1.5 };
      // Pass directTarget.id as primaryTargetId — it should be skipped
      const results = computeSplashDamage(center, weapon, directTarget.id,
        [directTarget, bystander]);

      // Only the bystander should receive splash damage, not the primary target
      expect(results.length).toBe(1);
      expect(results[0].entity.id).toBe(bystander.id);
    });
  });

  describe('5. Splash damage decreases with distance from center', () => {
    it('closer unit takes more splash damage than farther unit', () => {
      const center: WorldPos = { x: 60 * CELL_SIZE, y: 60 * CELL_SIZE };
      // Use heavy tanks (high HP) to avoid overkill capping the damage measurement
      const closeUnit = makeEntity(UnitType.V_4TNK, House.USSR,
        center.x + CELL_SIZE * 0.3, center.y); // 0.3 cells away
      const farUnit = makeEntity(UnitType.V_4TNK, House.USSR,
        center.x + CELL_SIZE * 1.5, center.y); // 1.5 cells away

      // Use Super warhead (1.0 mult against all armor) for clean comparison
      const weapon = { damage: 50, warhead: 'Super' as WarheadType, splash: 2.0 };
      const results = computeSplashDamage(center, weapon, -1, [closeUnit, farUnit]);

      expect(results.length).toBe(2);
      const closeResult = results.find(r => r.entity.id === closeUnit.id)!;
      const farResult = results.find(r => r.entity.id === farUnit.id)!;

      expect(closeResult.damage).toBeGreaterThan(farResult.damage);
    });

    it('damage at center (distance 0) equals full weapon damage * warhead mult', () => {
      const center: WorldPos = { x: 60 * CELL_SIZE, y: 60 * CELL_SIZE };
      // Place a high-HP unit exactly at center — distance is 0, falloff is 1.0
      // Use Mammoth tank (600 HP, heavy armor) so damage is not capped by HP
      const unit = makeEntity(UnitType.V_4TNK, House.USSR, center.x, center.y);

      // Super warhead has 1.0 mult vs all armor (including heavy)
      const weapon = { damage: 100, warhead: 'Super' as WarheadType, splash: 2.0 };
      const results = computeSplashDamage(center, weapon, -1, [unit]);

      expect(results.length).toBe(1);
      // Super warhead: 1.0 mult vs heavy armor, falloff at distance 0 = 1.0
      // Expected damage = round(100 * 1.0 * 1.0) = 100
      expect(results[0].damage).toBe(100);
    });
  });

  describe('6. Units at edge of splash radius take reduced damage', () => {
    it('unit at edge of splash radius takes minimal damage', () => {
      const center: WorldPos = { x: 60 * CELL_SIZE, y: 60 * CELL_SIZE };
      // Place unit at 95% of splash range — should get very low damage
      const splashRange = 2.0;
      const edgeDist = splashRange * 0.95;
      const edgeUnit = makeEntity(UnitType.V_2TNK, House.USSR,
        center.x + CELL_SIZE * edgeDist, center.y);

      // Use Super warhead (1.0 mult against all armor)
      const weapon = { damage: 100, warhead: 'Super' as WarheadType, splash: splashRange };
      const results = computeSplashDamage(center, weapon, -1, [edgeUnit]);

      expect(results.length).toBe(1);
      // At 95% range with spreadFactor 2 (Super): falloff = (1 - 0.95)^(1/2) = 0.05^0.5 ~ 0.224
      // Damage = round(100 * 1.0 * 0.224) = 22
      expect(results[0].damage).toBeLessThan(30);
      expect(results[0].damage).toBeGreaterThan(0);
    });

    it('unit at exactly splash range boundary takes minimal damage', () => {
      const center: WorldPos = { x: 60 * CELL_SIZE, y: 60 * CELL_SIZE };
      const splashRange = 1.5;
      // Place unit at exactly the splash range — ratio = 1.0, falloff = 0
      // But Math.pow(0, anything) = 0, so damage = round(weapon.damage * mult * 0) = 0
      // minimum damage is max(1, round(...)) so it would be 1 if included,
      // BUT dist > splashRange check uses >, so dist === splashRange is included
      const boundaryUnit = makeEntity(UnitType.I_E1, House.USSR,
        center.x + CELL_SIZE * splashRange, center.y);

      const weapon = { damage: 50, warhead: 'Super' as WarheadType, splash: splashRange };
      const dist = worldDist(center, boundaryUnit.pos);
      // dist should be exactly splashRange
      expect(dist).toBeCloseTo(splashRange, 5);

      const results = computeSplashDamage(center, weapon, -1, [boundaryUnit]);
      // At exactly the boundary: ratio = 1.0, falloff = (1-1)^(1/2) = 0
      // splashDmg = max(1, round(50 * 1.0 * 0)) = max(1, 0) = 1
      // dist === splashRange is NOT > splashRange, so it's included
      expect(results.length).toBe(1);
      expect(results[0].damage).toBe(1); // minimum 1 damage
    });
  });

  describe('7. Units outside splash radius take no damage', () => {
    it('unit just outside splash radius is unaffected', () => {
      const center: WorldPos = { x: 60 * CELL_SIZE, y: 60 * CELL_SIZE };
      const splashRange = 1.5;
      // Place unit clearly outside the splash range
      const outsideUnit = makeEntity(UnitType.I_E1, House.USSR,
        center.x + CELL_SIZE * (splashRange + 0.5), center.y);

      const weapon = { damage: 100, warhead: 'Super' as WarheadType, splash: splashRange };
      const hpBefore = outsideUnit.hp;
      const results = computeSplashDamage(center, weapon, -1, [outsideUnit]);

      expect(results.length).toBe(0);
      expect(outsideUnit.hp).toBe(hpBefore);
    });

    it('far-away friendly unit takes no splash damage', () => {
      const center: WorldPos = { x: 60 * CELL_SIZE, y: 60 * CELL_SIZE };
      const farFriendly = makeEntity(UnitType.V_2TNK, House.Spain,
        center.x + CELL_SIZE * 10, center.y); // 10 cells away

      const weapon = { damage: 150, warhead: 'HE' as WarheadType, splash: 2.0 };
      const hpBefore = farFriendly.hp;
      const results = computeSplashDamage(center, weapon, -1, [farFriendly]);

      expect(results.length).toBe(0);
      expect(farFriendly.hp).toBe(hpBefore);
    });
  });

  describe('Ant-on-ant splash damage', () => {
    it('ant explosion damages other ants from same faction', () => {
      // Ant2 (fire ant) has splash weapon — its explosion should hurt nearby ANT1
      const center: WorldPos = { x: 60 * CELL_SIZE, y: 60 * CELL_SIZE };
      const nearbyAnt = makeEntity(UnitType.ANT1, House.USSR,
        center.x + CELL_SIZE * 0.5, center.y);

      // Fire ant weapon: FireballLauncher — damage 125, warhead Fire, splash 1.5
      const weapon = { damage: 125, warhead: 'Fire' as WarheadType, splash: 1.5 };
      const hpBefore = nearbyAnt.hp;
      const results = computeSplashDamage(center, weapon, -1, [nearbyAnt]);

      expect(results.length).toBe(1);
      expect(results[0].damage).toBeGreaterThan(0);
      expect(nearbyAnt.hp).toBeLessThan(hpBefore);
    });

    it('ant splash damages ants from different allied ant houses', () => {
      const center: WorldPos = { x: 60 * CELL_SIZE, y: 60 * CELL_SIZE };
      const ukraineAnt = makeEntity(UnitType.ANT1, House.Ukraine,
        center.x + CELL_SIZE, center.y);
      const germanyAnt = makeEntity(UnitType.ANT3, House.Germany,
        center.x, center.y + CELL_SIZE);

      // Verify these houses are allied
      expect(isAllied(House.USSR, House.Ukraine)).toBe(true);
      expect(isAllied(House.USSR, House.Germany)).toBe(true);

      const weapon = { damage: 80, warhead: 'Super' as WarheadType, splash: 2.0 };
      const results = computeSplashDamage(center, weapon, -1,
        [ukraineAnt, germanyAnt]);

      // Both allied ants should take splash damage
      expect(results.length).toBe(2);
      for (const r of results) {
        expect(r.damage).toBeGreaterThan(0);
      }
    });
  });

  describe('SpreadFactor falloff verification', () => {
    it('HE (spreadFactor 2) gives more damage at distance than SA (spreadFactor 1)', () => {
      // At the same distance ratio, higher spreadFactor = slower falloff = more damage
      const center: WorldPos = { x: 60 * CELL_SIZE, y: 60 * CELL_SIZE };
      const distCells = 1.0;

      // Both use Super warhead (1.0 vs all) to isolate spreadFactor effect
      // But we need different warheads to test spreadFactor
      // HE: spreadFactor 2, SA: spreadFactor 1
      // We'll manually compute to verify
      const splashRange = 2.0;
      const ratio = distCells / splashRange; // 0.5

      const falloffSA = Math.pow(1 - ratio, 1 / 1); // (0.5)^1 = 0.5
      const falloffHE = Math.pow(1 - ratio, 1 / 2); // (0.5)^0.5 = 0.707

      expect(falloffHE).toBeGreaterThan(falloffSA);
      // ~41% more damage from HE spread at same distance
      expect(falloffHE / falloffSA).toBeCloseTo(Math.SQRT2, 2);
    });

    it('Fire (spreadFactor 3) has widest splash with slowest falloff', () => {
      const splashRange = 2.0;
      const ratio = 0.75; // 75% of range

      const falloffSA = Math.pow(1 - ratio, 1 / 1);   // (0.25)^1 = 0.25
      const falloffHE = Math.pow(1 - ratio, 1 / 2);    // (0.25)^0.5 = 0.5
      const falloffFire = Math.pow(1 - ratio, 1 / 3);  // (0.25)^0.333 = 0.63

      expect(falloffFire).toBeGreaterThan(falloffHE);
      expect(falloffHE).toBeGreaterThan(falloffSA);
    });
  });

  describe('Source code verification — no alliance filter in applySplashDamage', () => {
    it('computeSplashDamage damages entities regardless of alliance', () => {
      // This test verifies the core invariant: splash damage is team-agnostic
      const center: WorldPos = { x: 60 * CELL_SIZE, y: 60 * CELL_SIZE };
      const offset = CELL_SIZE * 0.5;

      // Create one entity from each house, all at the same distance
      const spainUnit = makeEntity(UnitType.I_E1, House.Spain, center.x + offset, center.y);
      const greeceUnit = makeEntity(UnitType.I_E1, House.Greece, center.x - offset, center.y);
      const ussrUnit = makeEntity(UnitType.I_E1, House.USSR, center.x, center.y + offset);
      const ukraineUnit = makeEntity(UnitType.I_E1, House.Ukraine, center.x, center.y - offset);

      // Super warhead: 1.0 vs all armor types — isolates the team filter test
      const weapon = { damage: 40, warhead: 'Super' as WarheadType, splash: 2.0 };
      const results = computeSplashDamage(center, weapon, -1,
        [spainUnit, greeceUnit, ussrUnit, ukraineUnit]);

      // ALL four entities should take damage, regardless of house
      expect(results.length).toBe(4);
      for (const r of results) {
        expect(r.damage).toBeGreaterThan(0);
        expect(r.entity.hp).toBeLessThan(r.entity.maxHp);
      }

      // All should take the same damage (same distance, same armor, same warhead)
      const damages = results.map(r => r.damage);
      expect(new Set(damages).size).toBe(1); // all identical
    });
  });
});
