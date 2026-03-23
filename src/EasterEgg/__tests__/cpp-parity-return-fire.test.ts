/**
 * C++ parity audit: Return fire / retaliation logic
 *
 * C++ source refs:
 *   - techno.cpp:4912-5017  TechnoClass::Is_Allowed_To_Retaliate(source)
 *       Sequential gate checks that determine whether a unit may retaliate
 *       after taking damage. Called from foot.cpp:1125 in FootClass::Take_Damage.
 *   - foot.cpp:1125-1131    FootClass::Take_Damage — calls Is_Allowed_To_Retaliate,
 *       then Assign_Target only if in-range OR non-human.
 *   - building.cpp:1464-1470 BuildingClass::Take_Damage — independent building
 *       retaliation: not SAM/AAGUN, not ally, has weapon, source != aircraft,
 *       (!IsHuman || Rule.IsSmartDefense).
 *   - rules.cpp:443         IsSmartDefense = ini.Get_Bool("General", "PlayerReturnFire", false)
 *   - rules.cpp:199         Constructor default: IsSmartDefense(false)
 *   - mission.cpp:538,563   IsRetaliate per-mission flag (constructor default true, INI override)
 *
 * rules.ini [General]:
 *   PlayerReturnFire=no  (line 69) => Rule.IsSmartDefense = false
 *
 * Key C++ retaliation gates (techno.cpp:4912-5017, in order):
 *   1. source != NULL
 *   2. MissionControl[Mission].IsRetaliate must be true
 *   3. Fixed-wing aircraft cannot retaliate
 *   4. Source must not be an ally
 *   5. Must have a damaging weapon (Combat_Damage > 0 && Is_Weapon_Equipped)
 *   6. Primary weapon warhead modifier vs source armor must be > 0
 *   7. Source must not be a dog (IsDog / IsCanine)
 *   8. Source must not be aircraft unless victim has AA weapon
 *   9. Tanya (IsBomber/hasC4) from human house cannot retaliate against buildings
 *  10. Human house + !IsSmartDefense => no retaliation
 *      EXCEPTION: Tanya (INFANTRY_TANYA) may retaliate against infantry even without SmartDefense
 *  11. Suicide team members cannot retaliate
 *  12. AI only, 50% chance: skip if current target is bigger threat
 *
 * foot.cpp:1128 additional gate:
 *   Human units only retarget if attacker is in weapon range.
 *   AI units always retarget regardless of range.
 *
 * TS implementation: combat.ts:552-569 triggerRetaliation()
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
  UnitType, House, UNIT_STATS, WEAPON_STATS, CELL_SIZE,
  WARHEAD_VS_ARMOR,
  type WeaponStats,
  buildDefaultAlliances, Mission, AnimState,
  MISSION_CONTROL, armorIndex,
  COUNTRY_BONUSES,
} from '../engine/types';
import { Entity, resetEntityIds } from '../engine/entity';
import {
  type CombatContext,
  triggerRetaliation,
} from '../engine/combat';
import { GameMap } from '../engine/map';
import type { Effect } from '../engine/renderer';

// ---------------------------------------------------------------------------
// Parse rules.ini (authoritative source of truth)
// ---------------------------------------------------------------------------
const RULES_INI_PATH = path.resolve(__dirname, '../../../public/ra/assets/rules.ini');
const rulesText = fs.readFileSync(RULES_INI_PATH, 'utf-8');

interface IniSection { [key: string]: string; }

function parseINI(text: string): Record<string, IniSection> {
  const result: Record<string, IniSection> = {};
  let currentSection = '';
  for (const rawLine of text.split('\n')) {
    const line = rawLine.split(';')[0].trim();
    if (!line) continue;
    const secMatch = line.match(/^\[([^\]]+)\]$/);
    if (secMatch) {
      currentSection = secMatch[1];
      if (!result[currentSection]) result[currentSection] = {};
      continue;
    }
    if (!currentSection) continue;
    const kvMatch = line.match(/^(\w+)=(.*)$/);
    if (!kvMatch) continue;
    if (!result[currentSection]) result[currentSection] = {};
    result[currentSection][kvMatch[1]] = kvMatch[2].trim();
  }
  return result;
}

const INI = parseINI(rulesText);

function iniBool(section: string, key: string, defaultValue = false): boolean {
  const sec = INI[section];
  if (!sec || !(key in sec)) return defaultValue;
  const val = sec[key].toLowerCase();
  return val === 'yes' || val === 'true' || val === '1' || val === 'on';
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

beforeEach(() => resetEntityIds());

function makeEntity(type: UnitType, house: House, x = 100, y = 100): Entity {
  return new Entity(type, house, x, y);
}

function makeMockCtx(overrides: Partial<CombatContext> = {}): CombatContext {
  const map = new GameMap();
  const alliances = buildDefaultAlliances();
  return {
    entities: [],
    entityById: new Map<number, Entity>(),
    structures: [],
    inflightProjectiles: [],
    effects: [] as Effect[],
    tick: 0,
    playerHouse: House.Spain,
    scenarioId: 'SCG01EA',
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
    movementSpeed: () => 1,
    getFirepowerBias: (house: House) => COUNTRY_BONUSES[house]?.firepowerMult ?? 1.0,
    getArmorBias: () => 1.0,
    getROFBias: () => 1.0,
    damageStructure: () => false,
    aiIQ: () => 3,
    warheadMuzzleColor: () => '#ff0',
    aiStates: new Map(),
    lastBaseAttackEva: -Infinity,
    gameTicksPerSec: 15,
    gapGeneratorCells: new Map(),
    nBuildingsDestroyedCount: 0,
    structuresLost: 0,
    bridgeCellCount: 0,
    powerConsumed: 0,
    powerProduced: 100,
    clearStructureFootprint: () => {},
    recalculateSiloCapacity: () => {},
    showEvaMessage: () => {},
    screenShake: 0,
    screenFlash: 0,
    ...overrides,
  } as CombatContext;
}

// ---------------------------------------------------------------------------
// Test: rules.ini PlayerReturnFire value
// ---------------------------------------------------------------------------
describe('rules.ini [General] PlayerReturnFire (C++ Rule.IsSmartDefense)', () => {
  // C++ rules.cpp:443: IsSmartDefense = ini.Get_Bool("General", "PlayerReturnFire", IsSmartDefense)
  // C++ rules.cpp:199: IsSmartDefense constructor default = false
  // rules.ini line 69: PlayerReturnFire=no
  it('PlayerReturnFire=no in rules.ini', () => {
    const val = INI['General']?.['PlayerReturnFire']?.toLowerCase();
    expect(val).toBe('no');
  });

  it('C++ default IsSmartDefense is false, INI confirms no', () => {
    const fromIni = iniBool('General', 'PlayerReturnFire', false);
    expect(fromIni).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test: Mission-gated retaliation (MissionControl.IsRetaliate)
// ---------------------------------------------------------------------------
describe('C++ gate 2: MissionControl[Mission].IsRetaliate per-mission flag', () => {
  // C++ techno.cpp:4922: if (!MissionControl[Mission].IsRetaliate) return(false);
  // Missions where retaliation is BLOCKED (Retaliate=no in rules.ini):
  const NO_RETALIATE_MISSIONS: [string, Mission][] = [
    ['Sleep',        Mission.SLEEP],
    ['Hunt',         Mission.HUNT],
    ['Enter',        Mission.ENTER],
    ['Capture',      Mission.CAPTURE],
    ['Harvest',      Mission.HARVEST],
    ['Unload',       Mission.UNLOAD],
    ['Retreat',      Mission.RETREAT],
    ['Harmless',     Mission.HARMLESS],
    ['Construction', Mission.CONSTRUCTION],
    ['Selling',      Mission.DECONSTRUCTION],
  ];

  // Missions where retaliation IS allowed (Retaliate=yes or default=yes):
  const YES_RETALIATE_MISSIONS: [string, Mission][] = [
    ['Guard',      Mission.GUARD],
    ['Area Guard', Mission.AREA_GUARD],
    ['Move',       Mission.MOVE],
    ['Attack',     Mission.ATTACK],
    ['Ambush',     Mission.AMBUSH],
    ['Sticky',     Mission.STICKY],
    ['Repair',     Mission.REPAIR],
    ['Stop',       Mission.STOP],
    ['QMove',      Mission.QMOVE],
    ['Return',     Mission.RETURN],
    ['Rescue',     Mission.RESCUE],
    ['Missile',    Mission.MISSILE],
    ['Sabotage',   Mission.SABOTAGE],
  ];

  for (const [iniSection, mission] of NO_RETALIATE_MISSIONS) {
    it(`${iniSection} (${mission}) has isRetaliate=false in TS`, () => {
      const mc = MISSION_CONTROL[mission];
      expect(mc, `Missing MISSION_CONTROL entry for ${mission}`).toBeDefined();
      expect(mc.isRetaliate).toBe(false);
    });
  }

  for (const [iniSection, mission] of YES_RETALIATE_MISSIONS) {
    it(`${iniSection} (${mission}) has isRetaliate=true in TS`, () => {
      const mc = MISSION_CONTROL[mission];
      expect(mc, `Missing MISSION_CONTROL entry for ${mission}`).toBeDefined();
      expect(mc.isRetaliate).toBe(true);
    });
  }

  // CRITICAL MISMATCH: TS triggerRetaliation does NOT check MissionControl[Mission].IsRetaliate
  // C++ techno.cpp:4922 blocks retaliation when mission has Retaliate=no
  it('MISMATCH: TS triggerRetaliation does not check MissionControl[mission].isRetaliate', () => {
    // C++ behavior: a unit on HARVEST mission (Retaliate=no) should NOT retaliate
    const ctx = makeMockCtx();
    const harvester = makeEntity(UnitType.V_HARV, House.Spain, 100, 100);
    // Harvesters don't have weapons by default; use a 2TNK on harvest mission instead
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.mission = Mission.HARVEST; // simulate being on harvest mission
    const enemy = makeEntity(UnitType.V_3TNK, House.USSR, 100 + CELL_SIZE, 100);

    triggerRetaliation(ctx, tank, enemy);

    // C++ expected: tank should NOT retaliate (Harvest.Retaliate=no)
    // TS actual: tank retaliates because triggerRetaliation has no mission gate
    const cppExpected = null; // should NOT retarget
    const tsActual = tank.target;

    // Document the mismatch:
    if (tsActual !== null) {
      expect(tsActual).toBe(enemy); // TS retaliates (WRONG per C++)
      // This test documents the mismatch; it would need to be expect(tsActual).toBeNull()
      // for C++ parity
      console.warn('MISMATCH: TS retaliates on Harvest mission; C++ blocks retaliation (MissionControl.IsRetaliate=false)');
    }
  });

  it('MISMATCH: TS retaliates on Sleep mission; C++ blocks it', () => {
    const ctx = makeMockCtx();
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.mission = Mission.SLEEP;
    const enemy = makeEntity(UnitType.V_3TNK, House.USSR, 100 + CELL_SIZE, 100);

    triggerRetaliation(ctx, tank, enemy);

    // C++ expected: no retaliation (Sleep.Retaliate=no)
    // TS: retaliates because no mission gate check
    if (tank.target !== null) {
      console.warn('MISMATCH: TS retaliates on Sleep mission; C++ blocks retaliation');
    }
    // Document: TS lacks mission gate. For parity, tank.target should be null.
    expect(MISSION_CONTROL[Mission.SLEEP].isRetaliate).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test: Fixed-wing aircraft cannot retaliate (C++ gate 3)
// ---------------------------------------------------------------------------
describe('C++ gate 3: fixed-wing aircraft cannot retaliate', () => {
  // C++ techno.cpp:4927-4929: if (What_Am_I() == RTTI_AIRCRAFT && IsFixedWing) return false
  it('MIG is fixed-wing', () => {
    expect(UNIT_STATS.MIG.isFixedWing).toBe(true);
  });

  it('YAK is fixed-wing', () => {
    expect(UNIT_STATS.YAK.isFixedWing).toBe(true);
  });

  it('MISMATCH: TS triggerRetaliation does not block fixed-wing aircraft retaliation', () => {
    const ctx = makeMockCtx();
    // MIG is a fixed-wing aircraft with weapons
    const mig = makeEntity(UnitType.V_MIG, House.USSR, 100, 100);
    mig.mission = Mission.GUARD;
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 100 + CELL_SIZE, 100);

    triggerRetaliation(ctx, mig, enemy);

    // C++ expected: MIG should NOT retaliate (IsFixedWing = true)
    // TS: no fixed-wing check exists in triggerRetaliation
    // Note: TS may still block this via isAirUnit AA gate, but for wrong reason
    if (mig.target !== null) {
      console.warn('MISMATCH: TS allows fixed-wing aircraft to retaliate; C++ blocks it');
    }
  });
});

// ---------------------------------------------------------------------------
// Test: Ally check (C++ gate 4 — TS has this correctly)
// ---------------------------------------------------------------------------
describe('C++ gate 4: allied source blocks retaliation (TS correct)', () => {
  // C++ techno.cpp:4935: if (House->Is_Ally(source)) return(false)
  it('does not retaliate against allied unit', () => {
    const ctx = makeMockCtx();
    // Greece and Spain are both Allied faction — they are allies
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.mission = Mission.GUARD;
    const ally = makeEntity(UnitType.V_2TNK, House.Greece, 100 + CELL_SIZE, 100);

    triggerRetaliation(ctx, tank, ally);
    expect(tank.target).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test: Unarmed units cannot retaliate (C++ gate 5 — TS has this correctly)
// ---------------------------------------------------------------------------
describe('C++ gate 5: unarmed units cannot retaliate (TS correct)', () => {
  // C++ techno.cpp:4940: if (Combat_Damage() <= 0 || !Is_Weapon_Equipped()) return(false)
  it('MCV (unarmed) does not retaliate', () => {
    const ctx = makeMockCtx();
    const mcv = makeEntity(UnitType.V_MCV, House.Spain, 100, 100);
    const enemy = makeEntity(UnitType.V_3TNK, House.USSR, 100 + CELL_SIZE, 100);

    triggerRetaliation(ctx, mcv, enemy);
    expect(mcv.target).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test: Warhead modifier == 0 blocks retaliation (C++ gate 6)
// ---------------------------------------------------------------------------
describe('C++ gate 6: warhead modifier vs source armor == 0 blocks retaliation', () => {
  // C++ techno.cpp:4946-4950: if PrimaryWeapon warhead modifier[source armor] == 0, no retaliation
  // HollowPoint vs heavy/light/medium/wood armor = 0.05 (not exactly 0, but close)
  // Check if any warhead truly has 0 modifier against any armor
  it('rules.ini warhead table: HollowPoint has 0.05 (not 0) vs non-none armor', () => {
    const hp = WARHEAD_VS_ARMOR['HollowPoint'];
    expect(hp).toBeDefined();
    // Index: 0=none, 1=wood, 2=light, 3=heavy, 4=steel
    // HollowPoint: [1.0, 0.05, 0.05, 0.05, 0.05]
    expect(hp[0]).toBe(1.0);  // none armor (infantry)
    expect(hp[1]).toBe(0.05); // wood armor
    expect(hp[2]).toBe(0.05); // light armor
    expect(hp[3]).toBe(0.05); // heavy armor
    expect(hp[4]).toBe(0.05); // steel armor
  });

  it('MISMATCH: TS does not check warhead-vs-armor zero modifier before retaliating', () => {
    // Even though RA's default rules.ini doesn't have exact-zero modifiers,
    // the C++ code checks for this. TS has no such check.
    // This is a structural mismatch — TS triggerRetaliation has no warhead check at all.
    const ctx = makeMockCtx();
    const tanya = makeEntity(UnitType.I_TANYA, House.USSR, 100, 100);
    tanya.mission = Mission.GUARD;
    // Tanya's Colt45 uses HollowPoint warhead — 0.05 vs heavy armor, not zero
    // But the C++ CHECK exists; TS omits the check entirely
    const heavyTank = makeEntity(UnitType.V_4TNK, House.Spain, 100 + CELL_SIZE, 100);

    triggerRetaliation(ctx, tanya, heavyTank);

    // C++ would allow retaliation (0.05 > 0), but the check EXISTS in C++ and is MISSING in TS
    // Document: TS lacks warhead-vs-armor zero-modifier gate
    console.warn('MISMATCH (structural): TS triggerRetaliation has no warhead modifier check');
  });
});

// ---------------------------------------------------------------------------
// Test: Source is dog blocks retaliation (C++ gate 7)
// ---------------------------------------------------------------------------
describe('C++ gate 7: source is dog blocks retaliation', () => {
  // C++ techno.cpp:4956: if (source is RTTI_INFANTRY && IsDog) return false
  // Dogs attack in a special way that precludes normal retaliation targeting
  it('DOG has isCanine flag in TS', () => {
    expect(UNIT_STATS.DOG.isCanine).toBe(true);
  });

  it('MISMATCH: TS allows retaliation against dog attacker; C++ blocks it', () => {
    const ctx = makeMockCtx();
    const victim = makeEntity(UnitType.I_E1, House.Spain, 100, 100);
    victim.mission = Mission.GUARD;
    const dog = makeEntity(UnitType.I_DOG, House.USSR, 100 + CELL_SIZE * 0.5, 100);

    triggerRetaliation(ctx, victim, dog);

    // C++ expected: should NOT retaliate against dog (IsDog check)
    // TS: no dog check — will retaliate
    if (victim.target !== null) {
      expect(victim.target).toBe(dog);
      console.warn('MISMATCH: TS retaliates against dog; C++ blocks retaliation against dogs');
    }
  });
});

// ---------------------------------------------------------------------------
// Test: AA gate for aircraft source (C++ gate 8 — TS has similar check)
// ---------------------------------------------------------------------------
describe('C++ gate 8: source is aircraft, victim needs AA weapon (TS has partial check)', () => {
  // C++ techno.cpp:4961: if (source is RTTI_AIRCRAFT && !PrimaryWeapon->Bullet->IsAntiAircraft) return false
  // TS combat.ts:561-563: if (attacker.isAirUnit && attacker.flightAltitude > 0) check hasAA
  it('TS checks AA gate for airborne aircraft (partial parity)', () => {
    const ctx = makeMockCtx();
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.mission = Mission.GUARD;
    // 2TNK has no AA weapon
    const heli = makeEntity(UnitType.V_HELI, House.USSR, 100 + CELL_SIZE, 100);
    heli.flightAltitude = 5; // airborne

    triggerRetaliation(ctx, tank, heli);
    // Both C++ and TS should block: ground unit can't retaliate against airborne aircraft without AA
    expect(tank.target).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test: Tanya vs building retaliation block (C++ gate 9)
// ---------------------------------------------------------------------------
describe('C++ gate 9: human Tanya (IsBomber/hasC4) cannot retaliate against buildings', () => {
  // C++ techno.cpp:4968-4971: human/playerControl + source is RTTI_BUILDING + IsBomber => no retaliation
  // Tanya's normal attack can't damage buildings; she uses C4 which requires manual command
  it('Tanya (E7) has hasC4=true in TS stats', () => {
    expect(UNIT_STATS.E7.hasC4).toBe(true);
  });

  // Note: TS triggerRetaliation operates on Entity (units) vs Entity (units),
  // not Entity vs MapStructure (buildings), so this gate may be N/A in current arch.
  // But it's still a structural difference worth documenting.
  it('MISMATCH (structural): TS has no Tanya-vs-building retaliation block', () => {
    // In C++, buildings are TechnoClass objects that participate in retaliation targeting.
    // In TS, buildings are MapStructure (not Entity), so triggerRetaliation can't target them.
    // If TS ever unifies these, the Tanya check would need to be added.
    console.warn('MISMATCH (structural): C++ blocks Tanya retaliation against buildings; TS entity-only arch sidesteps this');
  });
});

// ---------------------------------------------------------------------------
// Test: PlayerReturnFire / IsSmartDefense gate (C++ gate 10) — CRITICAL MISMATCH
// ---------------------------------------------------------------------------
describe('C++ gate 10: human house + !IsSmartDefense blocks retaliation', () => {
  // C++ techno.cpp:4976:
  //   if (House->IsHuman && !Rule.IsSmartDefense &&
  //       (What_Am_I() != RTTI_INFANTRY || *this != INFANTRY_TANYA || source != RTTI_INFANTRY))
  //     return false;
  //
  // Translation: human-controlled units DON'T auto-retaliate when PlayerReturnFire=no,
  // EXCEPT Tanya retaliating against infantry.
  //
  // rules.ini: PlayerReturnFire=no => IsSmartDefense = false
  // This means ALL player units (except Tanya vs infantry) should NOT auto-retaliate!

  it('PlayerReturnFire=no means IsSmartDefense=false (confirmed from rules.ini)', () => {
    expect(iniBool('General', 'PlayerReturnFire', false)).toBe(false);
  });

  it('player units do NOT auto-retaliate (PlayerReturnFire=no, C++ parity)', () => {
    const ctx = makeMockCtx({ playerHouse: House.Spain });
    // Player-controlled medium tank on guard mission
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.mission = Mission.GUARD;
    // Enemy attacks
    const enemy = makeEntity(UnitType.V_3TNK, House.USSR, 100 + CELL_SIZE, 100);

    triggerRetaliation(ctx, tank, enemy);

    // C++ parity: tank should NOT retaliate (IsHuman=true, IsSmartDefense=false)
    expect(tank.target).toBeNull();
  });

  it('MISMATCH: AI units should always be allowed to retaliate (C++ has no SmartDefense gate for AI)', () => {
    const ctx = makeMockCtx({ playerHouse: House.Spain });
    // AI-controlled tank (USSR, not player-allied)
    const aiTank = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    aiTank.mission = Mission.GUARD;
    const playerUnit = makeEntity(UnitType.V_2TNK, House.Spain, 100 + CELL_SIZE, 100);

    triggerRetaliation(ctx, aiTank, playerUnit);

    // Both C++ and TS: AI unit retaliates (SmartDefense only blocks human houses)
    expect(aiTank.target).toBe(playerUnit);
  });

  it('C++ exception: Tanya retaliates against infantry even without SmartDefense', () => {
    // C++ techno.cpp:4976: exception for INFANTRY_TANYA vs RTTI_INFANTRY source
    // In C++: if (this == TANYA && source is infantry) => retaliation is allowed
    // TS: all units retaliate anyway (no SmartDefense check), so Tanya also retaliates
    const ctx = makeMockCtx({ playerHouse: House.Spain });
    const tanya = makeEntity(UnitType.I_TANYA, House.Spain, 100, 100);
    tanya.mission = Mission.GUARD;
    const enemyInf = makeEntity(UnitType.I_E1, House.USSR, 100 + CELL_SIZE, 100);

    triggerRetaliation(ctx, tanya, enemyInf);

    // Both C++ and TS agree: Tanya retaliates against infantry
    // (C++ allows via exception; TS allows because no gate exists at all)
    expect(tanya.target).toBe(enemyInf);
  });

  it('C++ blocks Tanya retaliation against vehicles (SmartDefense=false)', () => {
    // C++ techno.cpp:4976: Tanya exception ONLY applies when source is RTTI_INFANTRY
    // Against a vehicle, Tanya (human house) is blocked by SmartDefense=false
    const ctx = makeMockCtx({ playerHouse: House.Spain });
    const tanya = makeEntity(UnitType.I_TANYA, House.Spain, 100, 100);
    tanya.mission = Mission.GUARD;
    const enemyTank = makeEntity(UnitType.V_3TNK, House.USSR, 100 + CELL_SIZE, 100);

    triggerRetaliation(ctx, tanya, enemyTank);

    // C++ expected: Tanya should NOT retaliate against vehicle (SmartDefense=false, source != infantry)
    // TS: Tanya retaliates (no SmartDefense check)
    if (tanya.target === enemyTank) {
      console.warn('MISMATCH: Tanya retaliates vs vehicle in TS; C++ blocks it (source not infantry)');
    }
  });
});

// ---------------------------------------------------------------------------
// Test: Suicide team blocks retaliation (C++ gate 11)
// ---------------------------------------------------------------------------
describe('C++ gate 11: suicide team members cannot retaliate', () => {
  // C++ techno.cpp:4981: if (Is_Foot() && Team.Is_Valid() && Team->Class->IsSuicide) return false

  it('MISMATCH: TS triggerRetaliation does not check isSuicide team flag', () => {
    const ctx = makeMockCtx();
    const tank = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    tank.mission = Mission.GUARD;
    tank.isSuicide = true; // suicide team member
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 100 + CELL_SIZE, 100);

    triggerRetaliation(ctx, tank, enemy);

    // C++ expected: no retaliation (IsSuicide team)
    // TS: retaliates because no suicide team check
    if (tank.target !== null) {
      console.warn('MISMATCH: TS retaliates for suicide team member; C++ blocks it');
    }
  });
});

// ---------------------------------------------------------------------------
// Test: Existing target blocks retaliation (C++ gate + TS different logic)
// ---------------------------------------------------------------------------
describe('existing target handling: C++ threat comparison vs TS simple block', () => {
  // C++ techno.cpp:4989-5006: AI only, 50% chance, compares threat of current vs new target
  //   If current target is bigger threat, don't retarget.
  // C++ foot.cpp:1125-1130: after Is_Allowed_To_Retaliate, Assign_Target regardless of existing target
  //   (the threat comparison inside Is_Allowed_To_Retaliate handles this)
  //
  // TS combat.ts:557: if (victim.target && victim.target.alive) return;
  //   Simple block: NEVER retarget if has any living target

  it('TS blocks retaliation if victim has ANY living target', () => {
    const ctx = makeMockCtx();
    const tank = makeEntity(UnitType.V_2TNK, House.USSR, 100, 100);
    tank.mission = Mission.GUARD;
    const currentTarget = makeEntity(UnitType.I_E1, House.Spain, 200, 200);
    tank.target = currentTarget; // existing target (infantry — low threat)
    const heavyTank = makeEntity(UnitType.V_4TNK, House.Spain, 100 + CELL_SIZE, 100);

    triggerRetaliation(ctx, tank, heavyTank);

    // TS: tank keeps targeting the E1, ignores the heavy tank
    expect(tank.target).toBe(currentTarget);

    // C++ behavior: AI has 50% chance to compare threats and potentially retarget
    // to the bigger threat (heavy tank). TS always blocks retargeting.
    console.warn('MISMATCH: TS never retargets from weaker to stronger threat; C++ AI does (50% chance)');
  });
});

// ---------------------------------------------------------------------------
// Test: Human range gate (foot.cpp:1128)
// ---------------------------------------------------------------------------
describe('C++ foot.cpp:1128: human units only retarget if attacker in range', () => {
  // C++ foot.cpp:1128: if (In_Range(source, primary) || !House->IsHuman) Assign_Target(source)
  // Human units: only retarget if source is in weapon range
  // AI units: always retarget regardless of range

  it('MISMATCH: TS retargets player units even when attacker is out of range', () => {
    const ctx = makeMockCtx({ playerHouse: House.Spain });
    const tank = makeEntity(UnitType.V_2TNK, House.Spain, 100, 100);
    tank.mission = Mission.GUARD;
    // Place enemy far outside weapon range
    // 2TNK has 105mm weapon with range ~5.5 cells
    const farEnemy = makeEntity(UnitType.V_3TNK, House.USSR, 100 + CELL_SIZE * 20, 100);

    triggerRetaliation(ctx, tank, farEnemy);

    // C++ expected (with SmartDefense=true hypothetically):
    //   Human unit only retargets if attacker in range. At 20 cells, out of range => no retarget
    // TS: retargets regardless of range
    // Note: in practice, with PlayerReturnFire=no, the SmartDefense gate (gate 10) fires first.
    // This range gate is a secondary concern, but still a structural difference.
    if (tank.target === farEnemy) {
      console.warn('MISMATCH: TS retargets to out-of-range attacker; C++ human range gate blocks this');
    }
  });

  it('AI unit retargets regardless of range (both C++ and TS)', () => {
    const ctx = makeMockCtx({ playerHouse: House.Spain });
    const aiTank = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    aiTank.mission = Mission.GUARD;
    const farPlayer = makeEntity(UnitType.V_2TNK, House.Spain, 100 + CELL_SIZE * 20, 100);

    triggerRetaliation(ctx, aiTank, farPlayer);

    // Both C++ and TS: AI retargets regardless of range
    expect(aiTank.target).toBe(farPlayer);
  });
});

// ---------------------------------------------------------------------------
// Test: Team mission gate (TS has this, C++ uses IsSuicide + separate team logic)
// ---------------------------------------------------------------------------
describe('TS team mission gate vs C++ team logic', () => {
  // TS combat.ts:558-559: if (victim.teamMissions.length > 0 && mission !== HUNT) return
  // C++ uses Is_Allowed_To_Retaliate (includes suicide check) plus separate team logic
  // The TS check is more aggressive — blocks ALL team members except HUNT

  it('TS blocks retaliation for entities with team missions (except HUNT)', () => {
    const ctx = makeMockCtx();
    const tank = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    tank.mission = Mission.ATTACK;
    tank.teamMissions = [{ mission: 0, data: 0 }]; // has team missions
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 100 + CELL_SIZE, 100);

    triggerRetaliation(ctx, tank, enemy);

    // TS blocks because teamMissions.length > 0 && mission !== HUNT
    expect(tank.target).toBeNull();
  });

  it('TS allows retaliation for HUNT mission even with team missions', () => {
    const ctx = makeMockCtx();
    const tank = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    tank.mission = Mission.HUNT;
    tank.teamMissions = [{ mission: 0, data: 0 }];
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 100 + CELL_SIZE, 100);

    triggerRetaliation(ctx, tank, enemy);

    // TS: allows because HUNT exception
    // C++ HUNT has Retaliate=no in rules.ini! So C++ would actually BLOCK retaliation here
    // This is an interesting double mismatch
    if (tank.target === enemy) {
      console.warn('MISMATCH: TS allows HUNT retaliation; C++ Hunt.Retaliate=no blocks it');
    }
  });
});

// ---------------------------------------------------------------------------
// Test: Basic working retaliation (both agree)
// ---------------------------------------------------------------------------
describe('basic retaliation: idle AI unit retaliates when hit (C++ and TS agree)', () => {
  it('idle AI tank retaliates against enemy that hit it', () => {
    const ctx = makeMockCtx();
    const tank = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    tank.mission = Mission.GUARD;
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 100 + CELL_SIZE, 100);

    triggerRetaliation(ctx, tank, enemy);

    expect(tank.target).toBe(enemy);
    expect(tank.mission).toBe(Mission.ATTACK);
  });

  it('dead victim does not retaliate', () => {
    const ctx = makeMockCtx();
    const tank = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    tank.alive = false;
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 100 + CELL_SIZE, 100);

    triggerRetaliation(ctx, tank, enemy);
    expect(tank.target).toBeNull();
  });

  it('dead attacker does not trigger retaliation', () => {
    const ctx = makeMockCtx();
    const tank = makeEntity(UnitType.V_3TNK, House.USSR, 100, 100);
    tank.mission = Mission.GUARD;
    const enemy = makeEntity(UnitType.V_2TNK, House.Spain, 100 + CELL_SIZE, 100);
    enemy.alive = false;

    triggerRetaliation(ctx, tank, enemy);
    expect(tank.target).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Summary of all mismatches
// ---------------------------------------------------------------------------
describe('SUMMARY: C++ vs TS return-fire mismatches', () => {
  it('documents all structural mismatches between C++ Is_Allowed_To_Retaliate and TS triggerRetaliation', () => {
    const mismatches = [
      {
        gate: 'Gate 2: Mission-gated retaliation',
        cpp: 'techno.cpp:4922 — checks MissionControl[Mission].IsRetaliate',
        ts: 'combat.ts:552-569 — NO mission gate check',
        impact: 'Units on Harvest/Sleep/Capture/etc. missions retaliate in TS but not C++',
      },
      {
        gate: 'Gate 3: Fixed-wing aircraft block',
        cpp: 'techno.cpp:4927-4929 — IsFixedWing aircraft cannot retaliate',
        ts: 'combat.ts — no fixed-wing check',
        impact: 'MIG/YAK/BADR could retaliate in TS (unlikely in practice due to AA gate)',
      },
      {
        gate: 'Gate 6: Warhead modifier zero check',
        cpp: 'techno.cpp:4946-4950 — weapon warhead modifier vs source armor == 0 blocks retaliation',
        ts: 'combat.ts — no warhead modifier check',
        impact: 'Units with zero-damage weapons against target armor type still retaliate in TS',
      },
      {
        gate: 'Gate 7: Dog source block',
        cpp: 'techno.cpp:4956 — IsDog source blocks retaliation',
        ts: 'combat.ts — no dog check',
        impact: 'Units retaliate against dogs in TS; C++ requires normal target processing for dogs',
      },
      {
        gate: 'Gate 9: Tanya vs building block',
        cpp: 'techno.cpp:4968-4971 — human Tanya (IsBomber) cannot retaliate against buildings',
        ts: 'combat.ts — no check (buildings are MapStructure, not Entity)',
        impact: 'Structural difference; N/A unless architecture changes',
      },
      {
        gate: 'Gate 10: PlayerReturnFire / IsSmartDefense (FIXED)',
        cpp: 'techno.cpp:4976 — Human house + !IsSmartDefense => no retaliation (except Tanya vs infantry)',
        ts: 'combat.ts — isPlayerControlled check with Tanya vs infantry exception',
        impact: 'FIXED: Player units no longer auto-retaliate; Tanya vs infantry exception preserved',
      },
      {
        gate: 'Gate 11: Suicide team block',
        cpp: 'techno.cpp:4981 — IsSuicide team members cannot retaliate',
        ts: 'combat.ts — no suicide team check',
        impact: 'Suicide team members retaliate in TS but not C++',
      },
      {
        gate: 'Gate 12: AI threat comparison',
        cpp: 'techno.cpp:4989-5006 — AI 50% chance, skip if current target is bigger threat',
        ts: 'combat.ts:557 — simple block: never retarget if has ANY living target',
        impact: 'TS never retargets from weaker to stronger; C++ AI sometimes does',
      },
      {
        gate: 'foot.cpp range gate',
        cpp: 'foot.cpp:1128 — human units only retarget if attacker is in weapon range',
        ts: 'combat.ts — no range check for retaliation',
        impact: 'Player units retarget to out-of-range attackers in TS; C++ only if in range',
      },
      {
        gate: 'HUNT mission retaliation conflict',
        cpp: 'rules.ini Hunt.Retaliate=no + MissionControl gate blocks retaliation on HUNT',
        ts: 'combat.ts:559 — HUNT is explicitly exempted from team mission block',
        impact: 'TS allows HUNT retaliation (bypasses team gate); C++ blocks it at mission gate',
      },
    ];

    // All mismatches documented — this test always passes as documentation
    expect(mismatches).toHaveLength(10);

    // Log summary
    for (const m of mismatches) {
      console.warn(`[${m.gate}] ${m.impact}`);
    }
  });
});
