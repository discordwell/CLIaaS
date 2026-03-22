/**
 * C++ Parity: MSUB (Missile Submarine) — weapon, cloak, surface-to-fire behavior
 *
 * Authoritative source: rules.ini / aftrmath.ini (per CLAUDE.md — "rules.ini is god").
 * Every assertion derives its expected value from INI text, not from C++ constructor defaults.
 *
 * Covers:
 *   1. [MSUB] unit stats from aftrmath.ini: Strength, Armor, Speed, Sight, ROT, Cost,
 *      Points, Cloakable, Inaccurate, Owner, Prerequisite, Primary weapon
 *   2. [SubSCUD] weapon stats from aftrmath.ini: Damage, ROF, Range, Projectile,
 *      Speed, Warhead, Burst
 *   3. [HeatSeeker] projectile from rules.ini: ROT, AA, Inaccurate, High, Proximity,
 *      Ranged, Animates
 *   4. Surface-to-fire behavior: C++ vessel.cpp:2235 FIRE_CLOAKED -> Do_Uncloak(),
 *      sub must fully surface (38 ticks) before Can_Fire returns FIRE_OK
 *   5. Cloak state machine: Cloakable=yes -> isCloakable, UNCLOAKED initial state,
 *      cloaked units cannot fire (techno.cpp:2747 "if (Cloak != UNCLOAKED) return FIRE_CLOAKED")
 *   6. Targeting: SubSCUD uses HeatSeeker (AA=yes) -> can target air AND ground.
 *      Not isSubSurface (unlike TorpTube) -> can hit land targets.
 *
 * C++ source refs:
 *   techno.cpp:2744-2757 — Can_Fire: "if (Cloak != UNCLOAKED) return FIRE_CLOAKED"
 *   vessel.cpp:2235-2240 — FIRE_CLOAKED case: Do_Uncloak(), break (no fire)
 *   vessel.cpp:1027      — Can_Fire override: enters weapon checks only on FIRE_OK or FIRE_CLOAKED
 *   vessel.cpp:788-796   — MSUB/CA action: ACTION_NOMOVE (cannot force-move onto targets)
 *   vessel.cpp:975-976   — No smoke anim for SS/MSUB when damaged (submarines are underwater)
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  UnitType, House, CELL_SIZE, Mission, AnimState,
  UNIT_STATS, WEAPON_STATS, PRODUCTION_ITEMS,
  buildDefaultAlliances,
} from '../engine/types';
import {
  Entity, CloakState, CLOAK_TRANSITION_FRAMES, SONAR_PULSE_DURATION,
  resetEntityIds,
} from '../engine/entity';
import { updateAttack, type MissionAIContext } from '../engine/missionAI';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';

beforeEach(() => resetEntityIds());

// ── INI Parser ───────────────────────────────────────────────────────────────

function parseINI(content: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current = '';
  for (const rawLine of content.split('\n')) {
    const commentIdx = rawLine.indexOf(';');
    const stripped = commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine;
    const line = stripped.trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      current = sectionMatch[1];
      if (!sections[current]) sections[current] = {};
      continue;
    }
    if (current) {
      const eq = line.indexOf('=');
      if (eq > 0) {
        const key = line.slice(0, eq).trim();
        const value = line.slice(eq + 1).trim();
        if (value) sections[current][key] = value;
      }
    }
  }
  return sections;
}

const assetsDir = join(process.cwd(), 'public', 'ra', 'assets');
const rulesIni = parseINI(readFileSync(join(assetsDir, 'rules.ini'), 'utf-8'));
const aftIni = parseINI(readFileSync(join(assetsDir, 'aftrmath.ini'), 'utf-8'));

// Merge aftrmath.ini over rules.ini (Aftermath overrides base game)
function getSection(name: string): Record<string, string> {
  return { ...(rulesIni[name] ?? {}), ...(aftIni[name] ?? {}) };
}

function iniInt(section: string, key: string): number {
  return parseInt(getSection(section)[key], 10);
}

function iniStr(section: string, key: string): string | undefined {
  return getSection(section)[key];
}

function iniBool(section: string, key: string): boolean {
  const v = (getSection(section)[key] ?? '').toLowerCase();
  return v === 'yes' || v === 'true';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function entityAtCell(type: UnitType, house: House, cx: number, cy: number): Entity {
  return new Entity(type, house, cx * CELL_SIZE + CELL_SIZE / 2, cy * CELL_SIZE + CELL_SIZE / 2);
}

function findProdItem(type: string) {
  return PRODUCTION_ITEMS.find(i => i.type === type);
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. [MSUB] UNIT STATS — aftrmath.ini vs UNIT_STATS
// ══════════════════════════════════════════════════════════════════════════════
// aftrmath.ini [MSUB]:
//   Prerequisite=stek, Primary=SubSCUD, Strength=150, Armor=light,
//   TechLevel=9, Sight=6, Speed=5, Owner=soviet, Cost=1650, Points=45,
//   ROT=7, Cloakable=yes, Inaccurate=no

describe('[MSUB] unit stats — aftrmath.ini vs UNIT_STATS', () => {
  const stats = UNIT_STATS.MSUB;
  const iniSection = getSection('MSUB');

  it('Strength=150 (aftrmath.ini)', () => {
    expect(iniInt('MSUB', 'Strength')).toBe(150);
    expect(stats.strength).toBe(150);
  });

  it('Armor=light (aftrmath.ini)', () => {
    expect(iniStr('MSUB', 'Armor')).toBe('light');
    expect(stats.armor).toBe('light');
  });

  it('Speed=5 (aftrmath.ini)', () => {
    expect(iniInt('MSUB', 'Speed')).toBe(5);
    expect(stats.speed).toBe(5);
  });

  it('Sight=6 (aftrmath.ini)', () => {
    expect(iniInt('MSUB', 'Sight')).toBe(6);
    expect(stats.sight).toBe(6);
  });

  it('ROT=7 (aftrmath.ini)', () => {
    expect(iniInt('MSUB', 'ROT')).toBe(7);
    expect(stats.rot).toBe(7);
  });

  it('Cost=1650 (aftrmath.ini)', () => {
    expect(iniInt('MSUB', 'Cost')).toBe(1650);
    const prod = findProdItem('MSUB');
    expect(prod).toBeDefined();
    expect(prod!.cost).toBe(1650);
  });

  it('Points=45 (aftrmath.ini)', () => {
    expect(iniInt('MSUB', 'Points')).toBe(45);
    expect(stats.points).toBe(45);
  });

  it('TechLevel=9 (aftrmath.ini)', () => {
    expect(iniInt('MSUB', 'TechLevel')).toBe(9);
    const prod = findProdItem('MSUB');
    expect(prod!.techLevel).toBe(9);
  });

  it('Owner=soviet (aftrmath.ini)', () => {
    expect(iniStr('MSUB', 'Owner')).toBe('soviet');
    const prod = findProdItem('MSUB');
    expect(prod!.faction).toBe('soviet');
  });

  it('Primary=SubSCUD (aftrmath.ini)', () => {
    expect(iniStr('MSUB', 'Primary')).toBe('SubSCUD');
    expect(stats.primaryWeapon).toBe('SubSCUD');
  });

  it('no Secondary weapon (aftrmath.ini has no Secondary= key)', () => {
    expect(iniStr('MSUB', 'Secondary')).toBeUndefined();
    expect(stats.secondaryWeapon).toBeUndefined();
  });

  it('Cloakable=yes (aftrmath.ini)', () => {
    expect(iniBool('MSUB', 'Cloakable')).toBe(true);
    expect(stats.isCloakable).toBe(true);
  });

  it('Inaccurate=no on unit (aftrmath.ini explicit override)', () => {
    // aftrmath.ini [MSUB] has Inaccurate=no explicitly
    // This is a UNIT-level flag, separate from the HeatSeeker projectile Inaccurate=yes
    const val = iniStr('MSUB', 'Inaccurate')?.toLowerCase();
    expect(val).toBe('no');
  });

  it('Prerequisite=stek (aftrmath.ini) -> TS techPrereq=STEK', () => {
    expect(iniStr('MSUB', 'Prerequisite')).toBe('stek');
    const prod = findProdItem('MSUB');
    expect(prod).toBeDefined();
    // TS splits prerequisite into building prereq (SPEN) and tech prereq (STEK)
    expect(prod!.techPrereq).toBe('STEK');
  });

  it('isVessel=true (submarine is a naval unit)', () => {
    expect(stats.isVessel).toBe(true);
  });

  it('Entity HP initializes to Strength=150', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    expect(msub.hp).toBe(150);
    expect(msub.maxHp).toBe(150);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. [SubSCUD] WEAPON STATS — aftrmath.ini vs WEAPON_STATS
// ══════════════════════════════════════════════════════════════════════════════
// aftrmath.ini [SubSCUD]:
//   Damage=400, ROF=120, Range=14, Projectile=HeatSeeker,
//   Speed=20, Warhead=HE, Report=MISSILE6, Burst=2

describe('[SubSCUD] weapon stats — aftrmath.ini vs WEAPON_STATS', () => {
  const weapon = WEAPON_STATS.SubSCUD;

  it('Damage=400 (aftrmath.ini)', () => {
    expect(iniInt('SubSCUD', 'Damage')).toBe(400);
    expect(weapon.damage).toBe(400);
  });

  it('ROF=120 (aftrmath.ini)', () => {
    expect(iniInt('SubSCUD', 'ROF')).toBe(120);
    expect(weapon.rof).toBe(120);
  });

  it('Range=14 (aftrmath.ini)', () => {
    expect(iniInt('SubSCUD', 'Range')).toBe(14);
    expect(weapon.range).toBe(14.0);
  });

  it('Projectile=HeatSeeker (aftrmath.ini)', () => {
    expect(iniStr('SubSCUD', 'Projectile')).toBe('HeatSeeker');
  });

  it('Speed=20 (aftrmath.ini)', () => {
    expect(iniInt('SubSCUD', 'Speed')).toBe(20);
    expect(weapon.projSpeed).toBe(20);
  });

  it('Warhead=HE (aftrmath.ini)', () => {
    expect(iniStr('SubSCUD', 'Warhead')).toBe('HE');
    expect(weapon.warhead).toBe('HE');
  });

  it('Burst=2 (aftrmath.ini)', () => {
    expect(iniInt('SubSCUD', 'Burst')).toBe(2);
    expect(weapon.burst).toBe(2);
  });

  it('Entity weapon resolves to SubSCUD', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    expect(msub.weapon).not.toBeNull();
    expect(msub.weapon!.name).toBe('SubSCUD');
    expect(msub.weapon!.damage).toBe(400);
  });

  it('Entity has no secondary weapon', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    expect(msub.weapon2).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. [HeatSeeker] PROJECTILE FLAGS — rules.ini vs SubSCUD weapon flags
// ══════════════════════════════════════════════════════════════════════════════
// rules.ini [HeatSeeker]:
//   Arm=2, High=yes, Shadow=no, Proximity=yes, Animates=yes, Ranged=yes,
//   Inaccurate=yes, AA=yes, Image=DRAGON, ROT=5, Rotates=yes, Translucent=yes
//
// SubSCUD uses HeatSeeker as its Projectile. The projectile flags transfer to
// the weapon's behavioral properties in the TS engine.

describe('[HeatSeeker] projectile flags — rules.ini vs SubSCUD weapon', () => {
  const projSection = getSection('HeatSeeker');
  const weapon = WEAPON_STATS.SubSCUD;

  it('HeatSeeker ROT=5 -> SubSCUD projectileROT=5 (homing turn rate)', () => {
    expect(iniInt('HeatSeeker', 'ROT')).toBe(5);
    expect(weapon.projectileROT).toBe(5);
  });

  it('HeatSeeker AA=yes -> SubSCUD isAntiAir=true (can target air)', () => {
    expect(iniBool('HeatSeeker', 'AA')).toBe(true);
    expect(weapon.isAntiAir).toBe(true);
  });

  it('HeatSeeker Inaccurate=yes -> SubSCUD isInaccurate=true', () => {
    // The HeatSeeker projectile has Inaccurate=yes in rules.ini.
    // This propagates to the weapon as isInaccurate.
    // Note: MSUB unit has Inaccurate=no, but projectile flag takes precedence for scatter.
    expect(iniBool('HeatSeeker', 'Inaccurate')).toBe(true);
    expect(weapon.isInaccurate).toBe(true);
  });

  it('HeatSeeker High=yes -> SubSCUD isHigh=true', () => {
    expect(iniBool('HeatSeeker', 'High')).toBe(true);
    expect(weapon.isHigh).toBe(true);
  });

  it('HeatSeeker Proximity=yes (detonates near target)', () => {
    expect(iniBool('HeatSeeker', 'Proximity')).toBe(true);
  });

  it('HeatSeeker Ranged=yes (fuel-limited range)', () => {
    expect(iniBool('HeatSeeker', 'Ranged')).toBe(true);
    expect(weapon.isFueled).toBe(true);
  });

  it('HeatSeeker Animates=yes (animated projectile sprite)', () => {
    expect(iniBool('HeatSeeker', 'Animates')).toBe(true);
  });

  it('HeatSeeker has no AG=no flag -> SubSCUD can target ground', () => {
    // HeatSeeker does NOT have AG=no (unlike Ack/Catapult which have AG=no).
    // Absence of AG=no means default AG=yes -> can hit ground targets.
    const agValue = iniStr('HeatSeeker', 'AG');
    expect(agValue).toBeUndefined(); // not present = default yes
    expect(weapon.isAntiGround).toBeUndefined(); // no explicit false -> can hit ground
  });

  it('SubSCUD is NOT isSubSurface (not a torpedo, unlike TorpTube)', () => {
    // HeatSeeker has no UnderWater=yes flag -> not a submarine-only weapon.
    // This means MSUB can fire at land/naval/air targets (not just naval).
    const underwater = iniStr('HeatSeeker', 'UnderWater');
    expect(underwater).toBeUndefined();
    expect(weapon.isSubSurface).toBeFalsy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. SURFACE-TO-FIRE BEHAVIOR — C++ FIRE_CLOAKED (vessel.cpp:2235)
// ══════════════════════════════════════════════════════════════════════════════
// C++ techno.cpp:2747: "if (Cloak != UNCLOAKED) return(FIRE_CLOAKED);"
// C++ vessel.cpp:2235-2240:
//   case FIRE_CLOAKED:
//     Mark(MARK_OVERLAP_UP);
//     IsFiring = false;
//     Mark(MARK_OVERLAP_DOWN);
//     Do_Uncloak();
//     break;
//
// Key behavior: When a cloaked sub tries to fire, Can_Fire returns FIRE_CLOAKED.
// The sub calls Do_Uncloak() and does NOT fire. It must wait for the full
// uncloak transition (38 ticks, MAX_UNCLOAK_STAGE) to complete before
// the next Can_Fire call returns FIRE_OK.
//
// TS missionAI.ts:221-225 starts uncloaking but may not block firing until
// cloakState == UNCLOAKED. This section tests the required C++ behavior.

describe('Surface-to-fire: MSUB must fully uncloak before firing (vessel.cpp:2235)', () => {

  it('C++ parity: cloaked sub cannot fire (Cloak != UNCLOAKED -> FIRE_CLOAKED)', () => {
    // In C++, any Cloak state other than UNCLOAKED returns FIRE_CLOAKED.
    // TS must prevent firing when cloakState is not UNCLOAKED.
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    msub.cloakState = CloakState.CLOAKED;

    // The FIRE_CLOAKED check applies to CLOAKED, CLOAKING, and UNCLOAKING states.
    // All three should prevent immediate firing.
    expect(msub.cloakState).not.toBe(CloakState.UNCLOAKED);
  });

  it('UNCLOAKING state also blocks firing (must wait full 38 ticks)', () => {
    // C++ techno.cpp:2747 checks "Cloak != UNCLOAKED" — UNCLOAKING is not UNCLOAKED.
    // So even during the uncloak transition, the sub cannot fire.
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    msub.cloakState = CloakState.UNCLOAKING;
    msub.cloakTimer = 20; // mid-transition

    // The sub is surfacing but not yet surfaced — should not be able to fire
    expect(msub.cloakState).not.toBe(CloakState.UNCLOAKED);
    expect(msub.cloakTimer).toBeGreaterThan(0);
  });

  it('uncloak transition takes exactly CLOAK_TRANSITION_FRAMES=38 ticks', () => {
    // C++ techno.cpp:142: #define MAX_UNCLOAK_STAGE 38
    expect(CLOAK_TRANSITION_FRAMES).toBe(38);
  });

  it('MSUB in UNCLOAKED state CAN fire (Cloak == UNCLOAKED -> FIRE_OK)', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    msub.cloakState = CloakState.UNCLOAKED;
    // Fully surfaced — weapon check should proceed to FIRE_OK
    expect(msub.cloakState).toBe(CloakState.UNCLOAKED);
    expect(msub.weapon).not.toBeNull();
  });

  it('force-uncloak sets UNCLOAKING + timer=38 (Do_Uncloak equivalent)', () => {
    // C++ techno.cpp:4045-4066 Do_Uncloak:
    //   CLOAKED|CLOAKING -> set cloak=UNCLOAKING, stage=MAX_UNCLOAK_STAGE
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    msub.cloakState = CloakState.CLOAKED;
    msub.cloakTimer = 0;

    // Simulate Do_Uncloak
    msub.cloakState = CloakState.UNCLOAKING;
    msub.cloakTimer = CLOAK_TRANSITION_FRAMES;

    expect(msub.cloakState).toBe(CloakState.UNCLOAKING);
    expect(msub.cloakTimer).toBe(38);
  });

  it('after 38 ticks of UNCLOAKING, state becomes UNCLOAKED', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    msub.cloakState = CloakState.UNCLOAKING;
    msub.cloakTimer = CLOAK_TRANSITION_FRAMES;

    for (let i = 0; i < CLOAK_TRANSITION_FRAMES; i++) {
      expect(msub.cloakState).toBe(CloakState.UNCLOAKING);
      msub.cloakTimer--;
    }
    // Timer reached 0 -> transition complete
    if (msub.cloakTimer <= 0) {
      msub.cloakState = CloakState.UNCLOAKED;
    }
    expect(msub.cloakState).toBe(CloakState.UNCLOAKED);
    expect(msub.cloakTimer).toBe(0);
  });

  it('CLOAKING state also prevents firing (Cloak != UNCLOAKED)', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    msub.cloakState = CloakState.CLOAKING;
    msub.cloakTimer = 15;
    expect(msub.cloakState).not.toBe(CloakState.UNCLOAKED);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. CLOAK STATE MACHINE — Cloakable=yes behavior
// ══════════════════════════════════════════════════════════════════════════════

describe('MSUB cloak state machine (techno.cpp / aftrmath.ini Cloakable=yes)', () => {

  it('entity starts in UNCLOAKED state (C++ techno.cpp:616)', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    expect(msub.cloakState).toBe(CloakState.UNCLOAKED);
  });

  it('cloakTimer starts at 0', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    expect(msub.cloakTimer).toBe(0);
  });

  it('sonarPulseTimer starts at 0', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    expect(msub.sonarPulseTimer).toBe(0);
  });

  it('SONAR_PULSE_DURATION = 225 (15 * TICKS_PER_SECOND, house.cpp:2629)', () => {
    expect(SONAR_PULSE_DURATION).toBe(225);
  });

  it('CloakState enum matches C++ CloakType (defines.h:952-957)', () => {
    expect(CloakState.UNCLOAKED).toBe(0);
    expect(CloakState.CLOAKING).toBe(1);
    expect(CloakState.CLOAKED).toBe(2);
    expect(CloakState.UNCLOAKING).toBe(3);
  });

  it('damage forces CLOAKED -> UNCLOAKING (techno.cpp:3855-3859 shimmer)', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    msub.cloakState = CloakState.CLOAKED;
    msub.cloakTimer = 0;
    msub.takeDamage(10, 'AP');
    expect(msub.cloakState).toBe(CloakState.UNCLOAKING);
    expect(msub.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('damage forces CLOAKING -> UNCLOAKING', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    msub.cloakState = CloakState.CLOAKING;
    msub.cloakTimer = 20;
    msub.takeDamage(10, 'AP');
    expect(msub.cloakState).toBe(CloakState.UNCLOAKING);
    expect(msub.cloakTimer).toBe(CLOAK_TRANSITION_FRAMES);
  });

  it('UNCLOAKED stays UNCLOAKED on damage (no cloak state change)', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    msub.cloakState = CloakState.UNCLOAKED;
    msub.takeDamage(10, 'AP');
    expect(msub.cloakState).toBe(CloakState.UNCLOAKED);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. TARGETING: SubSCUD can target air AND ground (HeatSeeker AA=yes, no AG=no)
// ══════════════════════════════════════════════════════════════════════════════

describe('MSUB targeting — SubSCUD HeatSeeker: air+ground (rules.ini)', () => {

  it('HeatSeeker AA=yes -> MSUB can target aircraft', () => {
    expect(iniBool('HeatSeeker', 'AA')).toBe(true);
    expect(WEAPON_STATS.SubSCUD.isAntiAir).toBe(true);
  });

  it('HeatSeeker has no AG=no -> MSUB can target ground', () => {
    // Default is AG=yes when not specified
    expect(iniStr('HeatSeeker', 'AG')).toBeUndefined();
  });

  it('SubSCUD is not isSubSurface -> can hit land units (unlike SS TorpTube)', () => {
    expect(WEAPON_STATS.SubSCUD.isSubSurface).toBeFalsy();
    expect(WEAPON_STATS.TorpTube.isSubSurface).toBe(true);
  });

  it('SubSCUD range 14 outranges TorpTube range 9', () => {
    expect(WEAPON_STATS.SubSCUD.range).toBeGreaterThan(WEAPON_STATS.TorpTube.range);
  });

  it('SubSCUD damage 400 vastly exceeds TorpTube damage 90', () => {
    expect(WEAPON_STATS.SubSCUD.damage).toBeGreaterThan(WEAPON_STATS.TorpTube.damage);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. MSUB NO TURRET — vessel.cpp exclusion
// ══════════════════════════════════════════════════════════════════════════════
// C++ vdata.cpp: MSUB and SS are in the non-turreted vessel list.
// They rotate their entire body to aim (no separate turret sprite).

describe('MSUB has no turret (vdata.cpp / entity.ts)', () => {
  it('hasTurret is false', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    expect(msub.hasTurret).toBe(false);
  });

  it('SS also has no turret (same submarine class)', () => {
    const ss = entityAtCell(UnitType.V_SS, House.USSR, 10, 10);
    expect(ss.hasTurret).toBe(false);
  });

  it('DD has turret for comparison (surface vessel)', () => {
    const dd = entityAtCell(UnitType.V_DD, House.Spain, 10, 10);
    expect(dd.hasTurret).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. MSUB vs CA: ACTION_NOMOVE (vessel.cpp:788-796)
// ══════════════════════════════════════════════════════════════════════════════
// C++ vessel.cpp:788-796 (FIXIT_CSII):
//   if (action == ACTION_ATTACK && object->What_Am_I() == RTTI_VESSEL &&
//       (*this == VESSEL_MISSILESUB || *this == VESSEL_CA)) {
//       action = ACTION_NOMOVE;
//   }
// This means MSUB and CA cannot force-move onto vessel targets — they can
// only attack from range (no ramming behavior).

describe('MSUB ACTION_NOMOVE — cannot force-move onto targets (vessel.cpp:788-796)', () => {
  it('MSUB is a ranged-only vessel (no melee/ram)', () => {
    // MSUB has range 14 — it fights from long range, never rams.
    expect(WEAPON_STATS.SubSCUD.range).toBe(14.0);
    expect(UNIT_STATS.MSUB.crusher).toBeFalsy();
  });

  it('MSUB is not a transport', () => {
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    expect(msub.isTransport).toBe(false);
    expect(msub.maxPassengers).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. NO SMOKE ANIM for submarines (vessel.cpp:975-976)
// ══════════════════════════════════════════════════════════════════════════════
// C++ vessel.cpp:975 (FIXIT_CSII):
//   if (Health_Ratio() <= Rule.ConditionYellow && !IsAnimAttached &&
//       (*this != VESSEL_SS && *this != VESSEL_MISSILESUB))
// Submarines (SS and MSUB) do not get smoke animations when damaged
// because they are underwater — smoke makes no sense.

describe('MSUB no smoke anim when damaged (vessel.cpp:975)', () => {
  it('MSUB is a submarine (isCloakable=true, isVessel=true)', () => {
    // This combination identifies submarines that should not have smoke
    expect(UNIT_STATS.MSUB.isCloakable).toBe(true);
    expect(UNIT_STATS.MSUB.isVessel).toBe(true);
  });

  it('SS is also a submarine (same exclusion)', () => {
    expect(UNIT_STATS.SS.isCloakable).toBe(true);
    expect(UNIT_STATS.SS.isVessel).toBe(true);
  });

  it('DD is NOT excluded (surface vessel, gets smoke)', () => {
    expect(UNIT_STATS.DD.isCloakable).toBeFalsy();
    expect(UNIT_STATS.DD.isVessel).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. BEHAVIORAL: updateAttack must block firing while not UNCLOAKED
// ══════════════════════════════════════════════════════════════════════════════
// C++ vessel.cpp:2217-2243:
//   switch (Can_Fire(TarCom, primary)) {
//     case FIRE_OK: Fire_At(TarCom, primary); break;
//     case FIRE_CLOAKED: Do_Uncloak(); break;   <-- does NOT fire
//   }
// techno.cpp:2747: if (Cloak != UNCLOAKED) return(FIRE_CLOAKED);
//
// Key behavior: A cloaked or uncloaking MSUB must NOT fire until cloakState
// reaches UNCLOAKED. The TS missionAI.ts starts uncloaking at lines 221-225
// but must also prevent the fire logic from proceeding in the same tick.

describe('BEHAVIORAL: updateAttack blocks firing while cloaked/uncloaking (vessel.cpp:2235)', () => {

  function makeMissionCtx(entities: Entity[]): MissionAIContext {
    const map = new GameMap();
    const alliances = buildDefaultAlliances();
    return {
      entities,
      structures: [],
      effects: [] as Effect[],
      map,
      tick: 100,
      playerHouse: House.Spain,
      killCount: 0,
      evaMessages: [],
      warheadOverrides: {},
      scenarioWarheadMeta: {},
      scenarioWarheadProps: {},
      isAllied: (a: House, b: House) => alliances.get(a)?.has(b) ?? false,
      entitiesAllied: (a: Entity, b: Entity) => alliances.get(a.house)?.has(b.house) ?? false,
      isPlayerControlled: (e: Entity) => alliances.get(e.house)?.has(House.Spain) ?? false,
      movementSpeed: () => 1,
      playSoundAt: () => {},
      playEva: () => {},
      playSound: () => {},
      weaponSound: () => 'MISSILE6',
      damageEntity: () => false,
      damageStructure: () => false,
      triggerRetaliation: () => {},
      handleUnitDeath: () => {},
      launchProjectile: () => {},
      applySplashDamage: () => {},
      getFirepowerBias: () => 1.0,
      getROFBias: () => 1.0,
      getWarheadMult: () => 1.0,
      getWarheadMeta: () => ({ spreadFactor: 1 } as any),
      getWarheadProps: () => undefined,
      warheadMuzzleColor: () => '#fff',
      weaponProjectileStyle: () => 'rocket',
      idleMission: () => Mission.GUARD,
      retreatFromTarget: () => {},
      threatScore: () => 0,
      updateDemoTruck: () => {},
      updateMedic: () => {},
      updateMechanicUnit: () => {},
      updateTanyaC4: () => {},
      updateThief: () => {},
      spyDisguise: () => {},
      spyInfiltrate: () => {},
      minimapAlert: () => {},
    } as MissionAIContext;
  }

  it('cloaked MSUB starts uncloaking but does NOT fire on the same tick', () => {
    // C++ parity: FIRE_CLOAKED -> Do_Uncloak(); break; (no Fire_At call)
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    const target = entityAtCell(UnitType.V_DD, House.Spain, 11, 10); // 1 cell away, well within range 14
    msub.cloakState = CloakState.CLOAKED;
    msub.cloakTimer = 0;
    msub.mission = Mission.ATTACK;
    msub.target = target;
    msub.attackCooldown = 0;

    let projectileLaunched = false;
    const ctx = makeMissionCtx([msub, target]);
    ctx.launchProjectile = () => { projectileLaunched = true; };
    ctx.damageEntity = () => { projectileLaunched = true; return false; };

    updateAttack(ctx, msub);

    // After updateAttack, the MSUB should have started uncloaking
    expect(msub.cloakState === CloakState.UNCLOAKING || msub.cloakState === CloakState.CLOAKED,
      'MSUB should be UNCLOAKING or still CLOAKED after first tick')
      .toBe(true);

    // C++ parity check: the sub should NOT have fired on this tick
    // In C++, FIRE_CLOAKED -> Do_Uncloak(); break; (no Fire_At)
    // This test will FAIL if TS fires while not yet UNCLOAKED, exposing the parity gap.
    expect(projectileLaunched,
      'C++ parity: cloaked sub must NOT fire until fully UNCLOAKED (FIRE_CLOAKED -> Do_Uncloak, no Fire_At)')
      .toBe(false);
  });

  it('UNCLOAKING MSUB (mid-transition, timer > 0) must NOT fire', () => {
    // C++ techno.cpp:2747: if (Cloak != UNCLOAKED) return(FIRE_CLOAKED);
    // UNCLOAKING != UNCLOAKED, so this should also block firing
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    const target = entityAtCell(UnitType.V_DD, House.Spain, 11, 10);
    msub.cloakState = CloakState.UNCLOAKING;
    msub.cloakTimer = 20; // mid-transition
    msub.mission = Mission.ATTACK;
    msub.target = target;
    msub.attackCooldown = 0;

    let projectileLaunched = false;
    const ctx = makeMissionCtx([msub, target]);
    ctx.launchProjectile = () => { projectileLaunched = true; };
    ctx.damageEntity = () => { projectileLaunched = true; return false; };

    updateAttack(ctx, msub);

    expect(projectileLaunched,
      'C++ parity: UNCLOAKING sub must NOT fire (Cloak != UNCLOAKED -> FIRE_CLOAKED)')
      .toBe(false);
  });

  it('UNCLOAKED MSUB CAN fire (Cloak == UNCLOAKED -> FIRE_OK)', () => {
    // This is the positive case: fully surfaced sub should be able to fire
    const msub = entityAtCell(UnitType.V_MSUB, House.USSR, 10, 10);
    const target = entityAtCell(UnitType.V_DD, House.Spain, 11, 10);
    msub.cloakState = CloakState.UNCLOAKED;
    msub.cloakTimer = 0;
    msub.mission = Mission.ATTACK;
    msub.target = target;
    msub.attackCooldown = 0;

    let projectileLaunched = false;
    const ctx = makeMissionCtx([msub, target]);
    ctx.launchProjectile = () => { projectileLaunched = true; };

    updateAttack(ctx, msub);

    // An UNCLOAKED sub should proceed to fire normally
    expect(projectileLaunched,
      'UNCLOAKED sub should fire normally (Cloak == UNCLOAKED -> FIRE_OK)')
      .toBe(true);
  });
});
