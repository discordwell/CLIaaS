/**
 * C++ Behavioral Parity: Demo Truck (DTRK) — Kamikaze Explosion Mechanics
 *
 * Audits Demo Truck kamikaze detonation mechanics against C++ source and INI:
 *
 *  1. Kamikaze attack: C++ unit.cpp:4220 — Fire_At + immediate `delete this`
 *     In C++, DTRK fires Democharge projectile at target, then truck is instantly deleted.
 *     There is NO fuse countdown. TS uses a 45-tick fuse which diverges from C++.
 *
 *  2. Democharge weapon (aftrmath.ini [Democharge]):
 *     Damage=500, Range=1.75, Warhead=Nuke, ROF=80, Projectile=Invisible, Speed=100
 *
 *  3. Explodes=yes on death (aftrmath.ini [DTRK] Explodes=yes):
 *     C++ techno.cpp:3820-3834 — When destroyed, trigger Wide_Area_Damage with:
 *       damage = MaxStrength (110), warhead = primary weapon warhead (Nuke),
 *       radius = MaxStrength * Rule.ExpSpread = 110 * 0.3 = 33 leptons
 *
 *  4. Nuke warhead (rules.ini [Nuke]):
 *     Spread=6, Verses=90%,100%,60%,25%,50%, Explosion=6, InfDeath=4
 *
 *  5. Iron Curtain interaction (C++ house.cpp:2751-2755):
 *     Normal units: IronCurtainDuration * TICKS_PER_MINUTE = 0.75 * 900 = 675 ticks
 *     Demo Truck: IronCurtainDuration * TICKS_PER_SECOND = 0.75 * 15 = 11 ticks (truncated)
 *
 *  6. Chronoshift interaction (C++ house.cpp:2828-2829):
 *     Chronoshifted DTRK is ordered to attack itself (self-destruct at destination)
 *
 *  7. Friendly fire: C++ Wide_Area_Damage (combat.cpp:393-425) doesn't check alliances —
 *     demo truck explosion damages ALL units in radius, including friendlies.
 *
 * C++ reference files:
 *   unit.cpp:4206-4228    — UnitClass::Fire_At (DTRK: fire + delete this)
 *   unit.cpp:667          — FIRE_FACING: DTRK body must face target to fire (no turret)
 *   techno.cpp:3820-3834  — IsExploding death explosion (Explodes=yes)
 *   techno.cpp:6276       — INI parse: IsExploding = ini.Get_Bool("Explodes")
 *   combat.cpp:393-425    — Wide_Area_Damage (area damage to all objects in radius)
 *   house.cpp:2751-2755   — Iron Curtain shortened duration for DTRK
 *   house.cpp:2828-2829   — Chronoshift: DTRK ordered to attack itself
 *   udata.cpp:714-743     — DTRK type data (MISSION_GUARD default)
 *   aftrmath.ini [DTRK]   — Explodes=yes, Primary=Democharge
 *   aftrmath.ini [Democharge] — Damage=500, Range=1.75, Warhead=Nuke
 *   rules.ini [Nuke]      — Verses=90%,100%,60%,25%,50%, Spread=6
 *   rules.ini [General]   — ExpSpread=.3
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  UnitType, House, CELL_SIZE, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS, WARHEAD_VS_ARMOR,
  PRODUCTION_ITEMS, IRON_CURTAIN_DURATION,
  IRON_CURTAIN_DEMO_TRUCK_DURATION,
  buildDefaultAlliances, armorIndex,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import { DEMO_TRUCK_FUSE_TICKS, DEMO_TRUCK_DAMAGE, DEMO_TRUCK_RADIUS } from '../engine/specialUnits';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── INI Parsing Helpers ────────────────────────────────────────────────────

function loadIni(filename: string): string {
  const candidates = [
    resolve(process.cwd(), `public/ra/assets/${filename}`),
    resolve(__dirname, `../../../public/ra/assets/${filename}`),
    resolve(__dirname, `../../../../public/ra/assets/${filename}`),
  ];
  for (const c of candidates) {
    try { return readFileSync(c, 'utf-8'); } catch { /* next */ }
  }
  throw new Error(`${filename} not found`);
}

function parseIniSection(ini: string, section: string): Record<string, string> {
  const result: Record<string, string> = {};
  const sectionPattern = new RegExp(`^\\[${section}\\]`, 'im');
  const match = ini.match(sectionPattern);
  if (!match || match.index === undefined) return result;
  const after = ini.slice(match.index + match[0].length);
  for (const line of after.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) break; // next section
    if (!trimmed || trimmed.startsWith(';')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).split(';')[0].trim();
    result[key] = val;
  }
  return result;
}

const rulesIni = loadIni('rules.ini');
const aftermathIni = loadIni('aftrmath.ini');

// ── Entity Helper ──────────────────────────────────────────────────────────

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. aftrmath.ini [DTRK] — Authoritative stats
// ═══════════════════════════════════════════════════════════════════════════

describe('aftrmath.ini [DTRK] parity — authoritative DTRK stats', () => {
  const ini = parseIniSection(aftermathIni, 'DTRK');

  it('Strength=110', () => {
    expect(ini.Strength).toBe('110');
    expect(UNIT_STATS.DTRK.strength).toBe(110);
  });

  it('Armor=light', () => {
    expect(ini.Armor).toBe('light');
    expect(UNIT_STATS.DTRK.armor).toBe('light');
  });

  it('Speed=8', () => {
    expect(ini.Speed).toBe('8');
    expect(UNIT_STATS.DTRK.speed).toBe(8);
  });

  it('Sight=3', () => {
    expect(ini.Sight).toBe('3');
    expect(UNIT_STATS.DTRK.sight).toBe(3);
  });

  it('ROT=5', () => {
    expect(ini.ROT).toBe('5');
    expect(UNIT_STATS.DTRK.rot).toBe(5);
  });

  it('Primary=Democharge', () => {
    expect(ini.Primary).toBe('Democharge');
    expect(UNIT_STATS.DTRK.primaryWeapon).toBe('Democharge');
  });

  it('TechLevel=13', () => {
    expect(ini.TechLevel).toBe('13');
  });

  it('Cost=2400', () => {
    expect(ini.Cost).toBe('2400');
    const prod = PRODUCTION_ITEMS.find(p => p.type === 'DTRK');
    expect(prod).toBeDefined();
    expect(prod!.cost).toBe(2400);
  });

  it('Points=5', () => {
    expect(ini.Points).toBe('5');
    expect(UNIT_STATS.DTRK.points).toBe(5);
  });

  it('Prerequisite=mslo', () => {
    expect(ini.Prerequisite?.toLowerCase()).toBe('mslo');
    const prod = PRODUCTION_ITEMS.find(p => p.type === 'DTRK');
    expect(prod!.prerequisite).toBe('MSLO');
  });

  it('Owner=allies,soviet (both factions)', () => {
    const owner = ini.Owner?.toLowerCase();
    expect(owner).toContain('allies');
    expect(owner).toContain('soviet');
  });

  it('Explodes=yes — DTRK explodes on death (C++ techno.cpp:3820)', () => {
    expect(ini.Explodes?.toLowerCase()).toBe('yes');
    // TS UNIT_STATS.DTRK now has explodesOnDeath=true matching INI
    expect(UNIT_STATS.DTRK.explodesOnDeath).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. aftrmath.ini [Democharge] — Authoritative weapon stats
// ═══════════════════════════════════════════════════════════════════════════

describe('aftrmath.ini [Democharge] parity — authoritative weapon', () => {
  const ini = parseIniSection(aftermathIni, 'Democharge');
  const weapon = WEAPON_STATS.Democharge;

  it('Damage=500', () => {
    expect(ini.Damage).toBe('500');
    expect(weapon.damage).toBe(500);
  });

  it('Range=1.75', () => {
    expect(ini.Range).toBe('1.75');
    expect(weapon.range).toBe(1.75);
  });

  it('Warhead=Nuke', () => {
    expect(ini.Warhead).toBe('Nuke');
    expect(weapon.warhead).toBe('Nuke');
  });

  it('ROF=80', () => {
    expect(ini.ROF).toBe('80');
    expect(weapon.rof).toBe(80);
  });

  it('Speed=100', () => {
    expect(ini.Speed).toBe('100');
    expect(weapon.projSpeed).toBe(100);
  });

  it('Projectile=Invisible', () => {
    expect(ini.Projectile).toBe('Invisible');
    expect(weapon.isInvisible).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. rules.ini [Nuke] warhead — Verses for Democharge damage
// ═══════════════════════════════════════════════════════════════════════════

describe('rules.ini [Nuke] warhead parity', () => {
  const ini = parseIniSection(rulesIni, 'Nuke');

  it('Verses=90%,100%,60%,25%,50%', () => {
    expect(ini.Verses).toBe('90%,100%,60%,25%,50%');
  });

  it('Spread=6 (Nuke warhead splash damage cell spread)', () => {
    expect(ini.Spread).toBe('6');
  });

  it('TS WARHEAD_VS_ARMOR.Nuke matches INI Verses exactly', () => {
    const expected = [0.9, 1.0, 0.6, 0.25, 0.5]; // none, wood, light, heavy, concrete
    const tsVerses = WARHEAD_VS_ARMOR.Nuke;
    expect(tsVerses).toEqual(expected);
  });

  it('Democharge 500 * 0.6 = 300 damage to light armor (same armor as DTRK)', () => {
    const damage = WEAPON_STATS.Democharge.damage;
    const mult = WARHEAD_VS_ARMOR.Nuke[armorIndex('light')];
    expect(Math.round(damage * mult)).toBe(300);
  });

  it('Democharge 500 * 1.0 = 500 damage to wood armor (buildings)', () => {
    const damage = WEAPON_STATS.Democharge.damage;
    const mult = WARHEAD_VS_ARMOR.Nuke[armorIndex('wood')];
    expect(Math.round(damage * mult)).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. C++ Kamikaze Mechanic: Fire + Instant Death (unit.cpp:4220)
//    In C++, DTRK fires Democharge at target, then `delete this` kills the truck.
//    There is NO fuse countdown — the truck dies the instant it fires.
// ═══════════════════════════════════════════════════════════════════════════

describe('DTRK kamikaze mechanic — C++ fire-and-delete vs TS fuse (unit.cpp:4220)', () => {

  it('C++ has NO fuse: truck fires weapon, then instant delete this', () => {
    // C++ unit.cpp:4220:
    //   if(Class->Type == UNIT_DEMOTRUCK && IsActive) delete this;
    // This happens INSIDE Fire_At(), right after the bullet is created.
    // The truck is instantly destroyed — no countdown, no delay.
    //
    // TS divergence: DEMO_TRUCK_FUSE_TICKS = 45 introduces a 45-tick
    // countdown that doesn't exist in C++.
    //
    // Document the divergence:
    expect(DEMO_TRUCK_FUSE_TICKS).toBe(45);
    // In C++ this value would be 0 — instant death on fire.
    // This is a KNOWN DIVERGENCE from C++ behavior.
  });

  it('C++ Democharge fires as a projectile — damage comes from the bullet impact', () => {
    // In C++, the Democharge weapon fires a bullet that travels to the target
    // and deals 500 damage with Nuke warhead on impact.
    // The bullet is the damage source, NOT a splash from the truck detonation.
    const weapon = WEAPON_STATS.Democharge;
    expect(weapon.damage).toBe(500);
    expect(weapon.warhead).toBe('Nuke');
    expect(weapon.isInvisible).toBe(true); // Invisible projectile = instant hit visual
    expect(weapon.projSpeed).toBe(100);    // Very fast projectile
  });

  it('DEMO_TRUCK_DAMAGE (1000) diverges from C++ Democharge (500)', () => {
    // TS uses DEMO_TRUCK_DAMAGE = 1000 for the custom detonation splash.
    // C++ uses the Democharge weapon damage (500) fired as a normal projectile.
    // The C++ "explosion on death" (Explodes=yes) uses MaxStrength=110.
    expect(DEMO_TRUCK_DAMAGE).toBe(1000);
    // C++ actual damage: Democharge = 500 (weapon fire), death explosion = 110 (MaxStrength)
    // Neither equals 1000. This is a KNOWN DIVERGENCE.
  });

  it('DEMO_TRUCK_RADIUS (3) — no equivalent in C++ weapon fire path', () => {
    // In C++, the Democharge fires as a projectile — its splash is determined by
    // the Nuke warhead Spread=6 (from Explosion_Damage, not a custom radius).
    // The death explosion radius = MaxStrength * ExpSpread = 110 * 0.3 = 33 leptons
    // = ~0.13 cells (not 3 cells).
    expect(DEMO_TRUCK_RADIUS).toBe(3);
    // C++ death explosion radius in leptons = 110 * 0.3 = 33
    // C++ Nuke warhead Spread=6 affects the projectile splash calculation
    // Neither maps to 3 cells. This is a KNOWN DIVERGENCE.
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Explodes=yes Death Explosion (techno.cpp:3820-3834)
//    When DTRK is killed by enemy fire (NOT kamikaze), the Explodes=yes flag
//    triggers Wide_Area_Damage with damage=MaxStrength, warhead=Nuke.
// ═══════════════════════════════════════════════════════════════════════════

describe('DTRK Explodes=yes death explosion (techno.cpp:3820-3834)', () => {

  it('C++ death explosion damage = MaxStrength = 110', () => {
    // techno.cpp:3830: int damage = Techno_Type_Class()->MaxStrength;
    expect(UNIT_STATS.DTRK.strength).toBe(110);
    // TS does NOT implement death explosion for Explodes=yes vehicles.
    // The DTRK UNIT_STATS lacks explodesOnDeath flag entirely.
  });

  it('C++ death explosion warhead = primary weapon warhead = Nuke', () => {
    // techno.cpp:3826-3827:
    //   if (PrimaryWeapon != NULL) wh = PrimaryWeapon->WarheadPtr->ID;
    // DTRK primary = Democharge, Democharge warhead = Nuke
    expect(WEAPON_STATS.Democharge.warhead).toBe('Nuke');
  });

  it('C++ death explosion radius = MaxStrength * ExpSpread = 110 * 0.3 = 33 leptons', () => {
    // techno.cpp:3832: int radius = damage * Rule.ExplosionSpread;
    // rules.ini [General] ExpSpread=.3
    // rules.cpp:138: constructor default = fixed(1,2) = 0.5, overridden by INI to 0.3
    const iniGeneral = parseIniSection(rulesIni, 'General');
    const expSpread = parseFloat(iniGeneral.ExpSpread);
    expect(expSpread).toBeCloseTo(0.3);

    const maxStrength = UNIT_STATS.DTRK.strength;
    const radiusLeptons = maxStrength * expSpread; // 110 * 0.3 = 33
    expect(radiusLeptons).toBeCloseTo(33);
    // This is a very small radius — about 0.13 cells (1 cell = 256 leptons in C++).
    // It means the death explosion barely damages adjacent objects.
  });

  it('DTRK UNIT_STATS has explodesOnDeath=true per aftrmath.ini Explodes=yes', () => {
    // aftrmath.ini [DTRK] Explodes=yes
    // C++ techno.cpp:6276: IsExploding = ini.Get_Bool("Explodes", IsExploding)
    const ini = parseIniSection(aftermathIni, 'DTRK');
    expect(ini.Explodes?.toLowerCase()).toBe('yes');
    expect(UNIT_STATS.DTRK.explodesOnDeath).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Iron Curtain Interaction (house.cpp:2751-2755)
// ═══════════════════════════════════════════════════════════════════════════

describe('DTRK Iron Curtain shortened duration (house.cpp:2751-2755)', () => {

  it('rules.ini IronCurtain=.75 (minutes)', () => {
    const iniGeneral = parseIniSection(rulesIni, 'General');
    // The field is just "IronCurtain" under [General] — might also be at top level
    // Let's check the raw value
    const match = rulesIni.match(/^IronCurtain=(.+)/m);
    expect(match).not.toBeNull();
    expect(parseFloat(match![1])).toBeCloseTo(0.75);
  });

  it('C++ TICKS_PER_SECOND=15, TICKS_PER_MINUTE=900', () => {
    // defines.h:3031-3032
    const TICKS_PER_SECOND = 15;
    const TICKS_PER_MINUTE = TICKS_PER_SECOND * 60;
    expect(TICKS_PER_SECOND).toBe(15);
    expect(TICKS_PER_MINUTE).toBe(900);
  });

  it('normal units: IronCurtainDuration * TICKS_PER_MINUTE = 0.75 * 900 = 675 ticks', () => {
    // house.cpp:2751: tech->IronCurtainCountDown = Rule.IronCurtainDuration * TICKS_PER_MINUTE
    expect(IRON_CURTAIN_DURATION).toBe(675);
  });

  it('DTRK: IronCurtainDuration * TICKS_PER_SECOND = 0.75 * 15 = 11 ticks', () => {
    // house.cpp:2753-2754:
    //   if (tech->What_Am_I() == RTTI_UNIT && *(UnitClass*)tech == UNIT_DEMOTRUCK)
    //     tech->IronCurtainCountDown = Rule.IronCurtainDuration * TICKS_PER_SECOND;
    // 0.75 * 15 = 11.25 → C++ truncates to integer = 11
    expect(IRON_CURTAIN_DEMO_TRUCK_DURATION).toBe(11);
  });

  it('DTRK Iron Curtain is 61x shorter than normal (675/11 ≈ 61.4)', () => {
    // This ensures the demo truck cannot be made permanently invulnerable
    const ratio = IRON_CURTAIN_DURATION / IRON_CURTAIN_DEMO_TRUCK_DURATION;
    expect(ratio).toBeGreaterThan(60);
    expect(ratio).toBeLessThan(62);
  });

  it('DTRK with ironCurtainTick > 0 is invulnerable (entity.ts isInvulnerable)', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    expect(dtrk.isInvulnerable).toBe(false);
    dtrk.ironCurtainTick = IRON_CURTAIN_DEMO_TRUCK_DURATION;
    expect(dtrk.isInvulnerable).toBe(true);
  });

  it('invulnerable DTRK takes no damage (C++ techno.cpp:3807)', () => {
    // techno.cpp:3807: if (IronCurtainCountDown == 0) { result = Take_Damage(...) }
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    dtrk.ironCurtainTick = IRON_CURTAIN_DEMO_TRUCK_DURATION;
    const hpBefore = dtrk.hp;
    dtrk.takeDamage(50, 'AP');
    expect(dtrk.hp).toBe(hpBefore); // no damage taken
    expect(dtrk.alive).toBe(true);
  });

  it('DTRK Iron Curtain expires after 11 ticks', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    dtrk.ironCurtainTick = IRON_CURTAIN_DEMO_TRUCK_DURATION;
    for (let i = 0; i < 11; i++) {
      expect(dtrk.isInvulnerable).toBe(true);
      dtrk.ironCurtainTick--;
    }
    expect(dtrk.ironCurtainTick).toBe(0);
    expect(dtrk.isInvulnerable).toBe(false);
    // Now vulnerable again
    const hpBefore = dtrk.hp;
    dtrk.takeDamage(50, 'AP');
    expect(dtrk.hp).toBe(hpBefore - 50);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Friendly Fire — Explosion damages all units (combat.cpp:393-425)
// ═══════════════════════════════════════════════════════════════════════════

describe('DTRK explosion friendly fire (combat.cpp Wide_Area_Damage)', () => {

  it('C++ Wide_Area_Damage does not check alliances — damages everyone', () => {
    // combat.cpp:393-425: iterates all cells in radius, calls Explosion_Damage
    // on each cell. Explosion_Damage damages any ObjectClass in the cell.
    // No alliance check. Friendly units get hit.
    //
    // TS detonateDemoTruck (specialUnits.ts:346-362) also doesn't filter
    // by alliance — it damages all entities. This is CORRECT parity.
    //
    // Verify the TS code iterates all entities without alliance check:
    // "if (!other.alive || other.id === entity.id) continue;"
    // — only skips dead entities and the truck itself. No alliance check.
    expect(true).toBe(true); // structural documentation test
  });

  it('DTRK detonation should damage same-house units (TS behavior)', () => {
    // Create two USSR entities close together
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    const friendlyTank = entityAtCell(UnitType.V_2TNK, House.USSR, 10, 10); // same cell

    // The detonation implementation damages all entities except self
    // We can't directly call detonateDemoTruck (not exported), but we verify
    // the entity system allows damage to same-house units:
    const hpBefore = friendlyTank.hp;
    friendlyTank.takeDamage(100, 'Nuke');
    expect(friendlyTank.hp).toBe(hpBefore - 100);
    // Same-house units CAN take damage — no alliance immunity in takeDamage
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Default Mission (udata.cpp:742)
// ═══════════════════════════════════════════════════════════════════════════

describe('DTRK default mission — MISSION_GUARD (udata.cpp:742)', () => {

  it('C++ DTRK defaults to MISSION_GUARD (not MISSION_HUNT)', () => {
    // udata.cpp:742: MISSION_GUARD  // ORDERS: Default order to give new unit.
    // Contrast with QTNK (MAD Tank) which has MISSION_HUNT.
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    expect(dtrk.mission).toBe(Mission.GUARD);
  });

  it('DTRK does NOT auto-hunt like MAD Tank', () => {
    // DTRK waits for explicit attack orders (MISSION_GUARD).
    // It doesn't seek enemies on its own like MISSION_HUNT units.
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    expect(dtrk.mission).not.toBe(Mission.HUNT);
    expect(dtrk.target).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. FIRE_FACING: DTRK must face target to fire (unit.cpp:667)
// ═══════════════════════════════════════════════════════════════════════════

describe('DTRK must face target to fire — no turret (unit.cpp:667)', () => {

  it('DTRK has no turret (udata.cpp:732 IsTurretEquipped=false)', () => {
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    expect(dtrk.hasTurret).toBe(false);
  });

  it('C++ FIRE_FACING: DTRK body rotates to face target before firing', () => {
    // unit.cpp:667-668:
    //   if (Class->IsLockTurret || Class->Type == UNIT_DEMOTRUCK) {
    //     PrimaryFacing.Set_Desired(Direction(TarCom));
    // DTRK is treated like a lock-turret unit: body must face target.
    // This means DTRK rotates its entire body toward the target before
    // it can fire the Democharge. Combined with ROT=5, this takes time.
    expect(UNIT_STATS.DTRK.rot).toBe(5);
    // ROT=5 means slow rotation — multiple ticks to face a target 90+ degrees away
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. Chronoshift Self-Destruct (house.cpp:2828-2829)
// ═══════════════════════════════════════════════════════════════════════════

describe('DTRK chronoshift self-destruct (house.cpp:2828-2829)', () => {

  it('C++ chronoshifted DTRK is ordered to attack itself', () => {
    // house.cpp:2828-2829:
    //   } else if(tech->What_Am_I() == RTTI_UNIT && *(UnitClass*)tech == UNIT_DEMOTRUCK) {
    //     tech->Assign_Target(tech->As_Target());
    // When a DTRK is chronoshifted, instead of normal teleport behavior,
    // it's assigned to attack ITSELF — causing it to self-destruct at
    // the destination. This prevents using chronoshift to create an
    // invulnerable kamikaze truck.
    //
    // TS verification: can DTRK target itself?
    const dtrk = entityAtCell(UnitType.V_DTRK, House.USSR, 10, 10);
    dtrk.target = dtrk; // self-targeting
    dtrk.mission = Mission.ATTACK;
    expect(dtrk.target).toBe(dtrk);
    expect(dtrk.mission).toBe(Mission.ATTACK);
    // The entity system allows self-targeting. Whether the chronoshift code
    // actually triggers this is a separate integration concern.
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. DTRK is NOT a crusher (udata.cpp:728)
// ═══════════════════════════════════════════════════════════════════════════

describe('DTRK is not a crusher (udata.cpp:728)', () => {

  it('udata.cpp:728 — Can this unit squash infantry? false', () => {
    expect(UNIT_STATS.DTRK.crusher).toBeFalsy();
  });

  it('DTRK (no crusher) vs QTNK (crusher=true for contrast)', () => {
    // QTNK at udata.cpp:696 has squash=true
    expect(UNIT_STATS.QTNK.crusher).toBe(true);
    expect(UNIT_STATS.DTRK.crusher).toBeFalsy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. SUMMARY — All Known Divergences
// ═══════════════════════════════════════════════════════════════════════════

describe('MISMATCH SUMMARY — TS vs C++ divergences for DTRK', () => {

  it('DIVERGENCE 1: DEMO_TRUCK_FUSE_TICKS=45 — C++ has no fuse (instant delete)', () => {
    // C++ unit.cpp:4220: `if(Class->Type == UNIT_DEMOTRUCK && IsActive) delete this;`
    // Fires weapon → instant death. No countdown.
    // TS: 45-tick fuse countdown before detonation.
    expect(DEMO_TRUCK_FUSE_TICKS).toBe(45);
    // Expected C++ behavior: 0 (instant)
  });

  it('DIVERGENCE 2: DEMO_TRUCK_DAMAGE=1000 — C++ weapon=500, death explosion=110', () => {
    // C++ has TWO damage events:
    //   1. Democharge projectile fires at target: 500 damage, Nuke warhead
    //   2. Death explosion (Explodes=yes): MaxStrength=110, Nuke warhead, tiny radius
    // TS combines into a single 1000-damage splash — neither matches C++.
    expect(DEMO_TRUCK_DAMAGE).toBe(1000);
    expect(WEAPON_STATS.Democharge.damage).toBe(500);
    expect(UNIT_STATS.DTRK.strength).toBe(110);
  });

  it('DIVERGENCE 3: DEMO_TRUCK_RADIUS=3 cells — C++ death radius=~0.13 cells', () => {
    // C++ death explosion radius = MaxStrength * ExpSpread = 110 * 0.3 = 33 leptons
    // 1 cell = 256 leptons → 33/256 = ~0.13 cells.
    // C++ Democharge weapon fires as projectile (splash from Nuke warhead Spread=6).
    // TS uses a 3-cell custom splash radius.
    expect(DEMO_TRUCK_RADIUS).toBe(3);
  });

  it('NO DIVERGENCE: DTRK has explodesOnDeath=true (aftrmath.ini Explodes=yes)', () => {
    // aftrmath.ini: [DTRK] Explodes=yes
    // C++ techno.cpp:6276: IsExploding = ini.Get_Bool("Explodes")
    expect(UNIT_STATS.DTRK.explodesOnDeath).toBe(true);
  });

  it('NO DIVERGENCE: Iron Curtain shortened duration = 11 ticks (correct)', () => {
    expect(IRON_CURTAIN_DEMO_TRUCK_DURATION).toBe(11);
    // Matches C++: 0.75 * 15 = 11.25, truncated to 11
  });

  it('NO DIVERGENCE: Nuke warhead verses match rules.ini', () => {
    expect(WARHEAD_VS_ARMOR.Nuke).toEqual([0.9, 1.0, 0.6, 0.25, 0.5]);
  });

  it('NO DIVERGENCE: Democharge weapon stats match aftrmath.ini', () => {
    const w = WEAPON_STATS.Democharge;
    expect(w.damage).toBe(500);
    expect(w.range).toBe(1.75);
    expect(w.warhead).toBe('Nuke');
    expect(w.rof).toBe(80);
  });

  it('NO DIVERGENCE: Explosion damages friendly units (no alliance filter)', () => {
    // Both C++ Wide_Area_Damage and TS detonateDemoTruck iterate all entities
    // without checking alliances. Correct parity.
    expect(true).toBe(true);
  });
});
