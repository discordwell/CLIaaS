/**
 * OracleStrategy: rule-based strategy for Red Alert missions driven by the
 * original WASM agent harness.
 *
 * The original harness currently supports unit motion and targeting, but not
 * sidebar production, so this strategy focuses on tactical control only.
 */

import type { RAGameState, RAEntity, RAStructure, RABuildable } from './WasmAdapter';

export interface OracleDecision {
  commands: Array<Record<string, unknown>>;
  reason: string;
}

export type OracleResult = 'playing' | 'victory' | 'defeat' | 'timeout';

type Point = { cx: number; cy: number };

// Mission enum values from C++ (MISSION_*)
const MISSION_SLEEP = 0;
const MISSION_GUARD = 5;
const MISSION_GUARD_AREA = 10;

// HP threshold for retreat (fraction of max HP)
const RETREAT_HP_FRACTION = 0.3;

const NON_COMBAT_TYPES = new Set(['C7', 'C8', 'EINSTEIN', 'TRAN']);

// RTTIType enum values from C++ defines.h (used for produce/place commands)
const RTTI_BUILDINGTYPE = 6;
const RTTI_UNITTYPE = 29;
const RTTI_INFANTRYTYPE = 14;

// Non-combat unit types excluded from attack orders
const BASE_NON_COMBAT_TYPES = new Set(['MCV', 'HARV', 'MNLY', 'TRUK']);

// Build order entries — alternatives array allows TENT/BARR flexibility
interface BuildOrderEntry {
  names: string[];
  type_ids: number[];
  maxCount?: number;  // build up to this many (default 1)
}

const BUILD_ORDER: BuildOrderEntry[] = [
  { names: ['POWR'],         type_ids: [17] },            // STRUCT_POWER — always first
  { names: ['PROC'],         type_ids: [12] },            // STRUCT_REFINERY — WEAP prerequisite
  { names: ['WEAP'],         type_ids: [2] },             // STRUCT_WEAP — tanks ASAP
  { names: ['BARR', 'TENT'], type_ids: [21, 22] },        // Barracks — before 2nd refinery
  { names: ['PROC'],         type_ids: [12], maxCount: 2 }, // Second refinery — double income
  { names: ['PBOX', 'FTUR'], type_ids: [4, 10] },         // Base defense
  { names: ['POWR'],         type_ids: [17], maxCount: 99 }, // Extra power — no cap (after core infra)
];

// Tank preference order (best to worst — covers both Allied and Soviet)
// 3TNK=Heavy(Soviet), 2TNK=Medium(Allied), 4TNK=Mammoth(Soviet), 1TNK=Light(both)
const TANK_PREFERENCE = ['3TNK', '2TNK', '4TNK', '1TNK'];

// Faction-aware house classification
const SOVIET_HOUSES = new Set(['USSR', 'Ukraine', 'BadGuy']);
function isSovietHouse(house: string | undefined): boolean {
  return house != null && SOVIET_HOUSES.has(house);
}

// Infantry production preference
const INFANTRY_PREFERENCE = ['E3', 'E1', 'E2', 'E4'];

// ── Tactical micro-management constants ──────────────────────────────────────

type UnitRole = 'anti_infantry' | 'anti_armor' | 'general' | 'non_combat';

const UNIT_ROLES: Record<string, UnitRole> = {
  'E1': 'anti_infantry', 'E4': 'anti_infantry', 'DOG': 'anti_infantry', 'JEEP': 'anti_infantry',
  'E3': 'anti_armor', 'ARTY': 'anti_armor', 'V2RL': 'anti_armor',
  '1TNK': 'anti_armor', '2TNK': 'anti_armor', '3TNK': 'anti_armor', '4TNK': 'anti_armor',
  'MCV': 'non_combat', 'HARV': 'non_combat', 'MNLY': 'non_combat', 'TRUK': 'non_combat', 'MEDI': 'non_combat',
};

const INFANTRY_TYPES = new Set(['E1','E2','E3','E4','E6','E7','SPY','THF','MEDI','GNRL','DOG',
  'C1','C2','C3','C4','C5','C6','C7','C8','C9','C10','EINSTEIN','CHAN','DELPHI']);

function isInfantryByType(t: string): boolean { return INFANTRY_TYPES.has(t); }

// Spiral offsets for building placement around Construction Yard
const PLACEMENT_OFFSETS: Point[] = [
  { cx: 3, cy: 0 }, { cx: -3, cy: 0 }, { cx: 0, cy: 3 }, { cx: 0, cy: -3 },
  { cx: 3, cy: 3 }, { cx: -3, cy: 3 }, { cx: 3, cy: -3 }, { cx: -3, cy: -3 },
  { cx: 5, cy: 0 }, { cx: -5, cy: 0 }, { cx: 0, cy: 5 }, { cx: 0, cy: -5 },
  { cx: 5, cy: 3 }, { cx: -5, cy: 3 }, { cx: 5, cy: -3 }, { cx: -5, cy: -3 },
  { cx: 3, cy: 5 }, { cx: -3, cy: 5 }, { cx: 3, cy: -5 }, { cx: -3, cy: -5 },
  { cx: 7, cy: 0 }, { cx: -7, cy: 0 }, { cx: 0, cy: 7 }, { cx: 0, cy: -7 },
];

const SCG01EA_POWER_LINE_X = 67;
const SCG01EA_PRISON: Point = { cx: 62, cy: 63 };
const SCG01EA_PRISON_ASSAULT: Point = { cx: 63, cy: 60 };
const SCG01EA_TANYA_STAGE: Point = { cx: 63, cy: 56 };
const SCG01EA_EVAC_POINT: Point = { cx: 53, cy: 49 };
const SCG01EA_ESCORT_POINT: Point = { cx: 56, cy: 52 };
const SCG01EA_EVAC_READY_DISTANCE_SQ = 81;
const SCG01EA_BOARD_DISTANCE_SQ = 49;
const SCG01EA_PLAYER_TRANSPORT_BOARD_DISTANCE_SQ = 256;

const SCG02EA_SWEEP_POINTS: Point[] = [
  { cx: 80, cy: 56 },
  { cx: 78, cy: 74 },
  { cx: 60, cy: 80 },
  { cx: 49, cy: 76 },
  { cx: 49, cy: 50 },
  { cx: 61, cy: 66 },
  { cx: 63, cy: 62 },
];
const SCG02EA_DEFENSE_POINT: Point = { cx: 80, cy: 56 };
const SCG02EA_BARREL_TRAP: Point = { cx: 73, cy: 50 };
const SCG02EA_CONVOY_ROUTE: Point[] = [
  { cx: 49, cy: 50 },
  { cx: 49, cy: 76 },
  { cx: 65, cy: 82 },
  { cx: 74, cy: 82 },
];
const SCG02EA_NON_COMBAT_TYPES = new Set(['MEDI', 'TRUK', 'MCV']);
const SCG02EA_RETREAT_HP_FRACTION = 0.45;
const SCG02EA_READY_HP_FRACTION = 0.75;

// ── Minelayer defense waypoints ────────────────────────────────────────────
// For SCG04EA: enemy base is NW (~40-50,40-50), player base is SE (~85-95,48-53).
// Mines are laid in a defensive arc NW of the player base to delay enemy heavy tanks.
const MINE_WAYPOINTS: Point[] = [
  { cx: 72, cy: 48 },   // approach path center
  { cx: 70, cy: 45 },   // north of approach
  { cx: 74, cy: 51 },   // south of approach
  { cx: 68, cy: 47 },   // further NW
  { cx: 76, cy: 50 },   // closer to base, southern flank
];

// MISSION_UNLOAD enum value from C++ (used by minelayer/MCV deploy)
const MISSION_UNLOAD = 12;

// ── SCG03EA "Dead End" — destroy two bridges with Tanya ─────────────────────
// Bridge targets (converted from cell numbers: cell%128=cx, cell/128=cy)
const SCG03EA_BRIDGE_V04: Point = { cx: 54, cy: 52 };  // cell 6710 = western bridge
const SCG03EA_BRIDGE_V07: Point = { cx: 53, cy: 57 };  // cell 7349 = central bridge
const SCG03EA_FALLBACK: Point = { cx: 62, cy: 49 };    // cell 6334 = starting area
const SCG03EA_ARTY_POS: Point = { cx: 54, cy: 55 };    // cell 7094 = central fire support

// Exploration waypoints — spiral pattern covering 64x64 cell map
const EXPLORE_WAYPOINTS = [
  { cx: 32, cy: 32 },
  { cx: 10, cy: 10 },
  { cx: 54, cy: 10 },
  { cx: 54, cy: 54 },
  { cx: 10, cy: 54 },
  { cx: 32, cy: 10 },
  { cx: 54, cy: 32 },
  { cx: 32, cy: 54 },
  { cx: 10, cy: 32 },
  { cx: 20, cy: 20 },
  { cx: 44, cy: 20 },
  { cx: 44, cy: 44 },
  { cx: 20, cy: 44 },
];

export class OracleStrategy {
  private readonly scenario: string;
  private exploreIndex = 0;
  private ticksSinceLastEnemy = 0;
  private lastEnemyCount = 0;
  private peakUnits = 0;
  private peakStructures = 0;
  private sawTanya = false;
  private sawRescue = false;
  private sawScg02eaConvoy = false;
  private scg02eaAssaultIndex = 0;
  private baseBuildIndex = 0;
  private placementAttempts = 0;
  private lastPlacementTick = 0;
  private scg03eaBridgeIndex = 0;  // 0 = first bridge, 1 = second, 2 = done
  private mineWaypointIndex = 0;
  private mineDeployPending = false;  // true when minelayer has arrived and should deploy
  private minesLaid = 0;              // total mines laid so far
  private mcvSpawnTick = 0;           // tick when MCV first appeared
  private mcvDeployAttempts = 0;      // how many times we've tried deploying
  private lastTick = 0;
  private currentTick = 0;
  private lastUnitTargets = new Map<number, { targetId: number; cx: number; cy: number; tick: number }>();
  private lastKnownEnemyCentroid: Point | null = null;

  constructor(scenario = '') {
    this.scenario = scenario.replace(/\.[^.]+$/, '').toUpperCase();
  }

  decide(state: RAGameState): OracleDecision {
    this.peakUnits = Math.max(this.peakUnits, state.units.length);
    this.peakStructures = Math.max(this.peakStructures, state.structures.length);

    this.currentTick = state.tick;
    const tickDelta = this.lastTick > 0 ? state.tick - this.lastTick : 15;
    if (state.enemies.length > 0) {
      this.ticksSinceLastEnemy = 0;
      this.lastEnemyCount = state.enemies.length;
      this.lastKnownEnemyCentroid = this.centroid(state.enemies);
    } else {
      this.ticksSinceLastEnemy += tickDelta;
    }

    if (state.units.some((u) => u.t === 'E7')) {
      this.sawTanya = true;
    }
    if (this.isScg01eaRescueTriggered(state)) {
      this.sawRescue = true;
    }
    if (state.units.some((u) => u.t === 'TRUK')) {
      this.sawScg02eaConvoy = true;
    }

    let result: OracleDecision;
    if (this.scenario === 'SCG01EA') {
      result = this.decideScg01ea(state);
    } else if (this.scenario === 'SCG02EA') {
      result = this.decideScg02ea(state);
    } else if (this.scenario === 'SCG03EA') {
      result = this.decideScg03ea(state);
    } else {
      result = this.decideGeneric(state);
    }
    this.lastTick = state.tick;
    return result;
  }

  // SCG08EA critical structures — lose if either is destroyed
  // Human-requested design element: ATEK at (58,95), PDOX at (58,102)
  private static readonly SCG08EA_CRITICAL: Point[] = [
    { cx: 58, cy: 95 },   // ATEK (Allied Tech Center)
    { cx: 58, cy: 102 },  // PDOX (Chronosphere)
  ];

  checkResult(state: RAGameState): OracleResult {
    if (state.winPending) {
      return 'victory';
    }
    if (state.losePending) {
      return 'defeat';
    }

    if (this.scenario === 'SCG01EA' && state.civEvacuated) {
      return 'victory';
    }

    if (
      state.units.length === 0 &&
      state.structures.filter((s) => s.ally).length === 0 &&
      state.tick > 100 &&
      this.peakUnits > 0
    ) {
      return 'defeat';
    }

    if ((this.scenario === 'SCG01EA' || this.scenario === 'SCG03EA') && this.sawTanya && state.tick > 240) {
      const tanyaAlive = state.units.some((u) => u.t === 'E7');
      if (!tanyaAlive) {
        return 'defeat';
      }
    }

    if (
      this.scenario === 'SCG02EA' &&
      this.sawScg02eaConvoy &&
      !state.units.some((u) => u.t === 'TRUK') &&
      !state.losePending
    ) {
      return 'victory';
    }

    if (
      state.enemies.length === 0 &&
      state.tick > 200 &&
      this.ticksSinceLastEnemy > 3000 &&
      this.lastEnemyCount > 0 &&
      this.exploreIndex >= EXPLORE_WAYPOINTS.length
    ) {
      return 'victory';
    }

    return 'playing';
  }

  summarize(state: RAGameState, iteration: number, decision: OracleDecision): string {
    const unitTypes = this.countTypes(state.units);
    const enemyTypes = this.countTypes(state.enemies);
    const globals = state.globals?.length ? ` globals=${state.globals.join(',')}` : '';
    const missionTimer = state.missionTimerActive ? ` timer=${state.missionTimer}` : '';
    const bridges = state.bridgeCount != null ? ` bridges=${state.bridgeCount}` : '';
    const prodItems = state.production.map(
      (p) => `${p.t}:${p.prog}%${p.done ? '*' : ''}`,
    ).join(',');
    const prodStr = prodItems ? ` prod=[${prodItems}]` : '';
    return (
      `[Oracle] #${iteration} tick=${state.tick} ` +
      `units=${state.units.length}(${unitTypes}) ` +
      `enemies=${state.enemies.length}(${enemyTypes}) ` +
      `structs=${state.structures.length} ` +
      `credits=${state.credits} ` +
      `power=${state.power.produced}/${state.power.consumed}${prodStr}${globals}${missionTimer}${bridges} ` +
      `| ${decision.reason}`
    );
  }

  private decideGeneric(state: RAGameState): OracleDecision {
    // Detect MCV or Construction Yard — switch to base-building mode
    const playerUnits = this.playerOwnedUnits(state);
    const hasMCV = playerUnits.some((u) => u.t === 'MCV');
    const alliedStructures = state.structures.filter((s) => s.ally);
    const hasConYard = alliedStructures.some((s) => s.t === 'FACT');

    if (hasMCV || hasConYard) {
      return this.decideBaseBuilding(state);
    }

    // Early game before MCV arrives — stay defensive, don't scatter
    // But only if we DON'T have an existing base (if we do, decideGenericCombat handles it)
    if (state.tick < 1500 && playerUnits.length > 0 && !hasConYard && alliedStructures.length === 0) {
      const commands: Array<Record<string, unknown>> = [];
      const reasons: string[] = [];
      const combat = playerUnits.filter(
        (u) => this.isCombatUnit(u) && !BASE_NON_COMBAT_TYPES.has(u.t),
      );
      const nearbyEnemies = state.enemies.filter(
        (e) => combat.some((u) => this.distanceSq(u, e) <= 225),
      );
      if (nearbyEnemies.length > 0 && combat.length > 0) {
        const micro = this.microManage(combat, nearbyEnemies, this.centroid(combat));
        commands.push(...micro.commands);
        reasons.push('early defense', ...micro.reasons);
      } else {
        reasons.push('holding position — waiting for MCV');
      }
      return { commands, reason: reasons.join('; ') };
    }

    // No MCV/ConYard — use force-ratio-aware combat
    return this.decideGenericCombat(state, playerUnits, alliedStructures);
  }

  /**
   * Base-building strategy: deploy MCV, follow build order, produce units, combat.
   */
  private decideBaseBuilding(state: RAGameState): OracleDecision {
    const commands: Array<Record<string, unknown>> = [];
    const reasons: string[] = [];
    const playerUnits = this.playerOwnedUnits(state);
    const alliedStructures = state.structures.filter((s) => s.ally);
    const buildable = state.buildable;

    // --- Phase 1: DEPLOY MCV ---
    const mcv = playerUnits.find((u) => u.t === 'MCV');
    const conYard = alliedStructures.find((s) => s.t === 'FACT');

    if (mcv && !conYard) {
      // Track MCV spawn time for stuck detection
      if (this.mcvSpawnTick === 0) this.mcvSpawnTick = state.tick;
      const mcvAge = state.tick - this.mcvSpawnTick;

      // MCV may be moving to a scenario-scripted position. Don't interrupt movement.
      // Once idle, issue deploy. If deploy doesn't take after many attempts,
      // try a small nudge then deploy next tick.
      if (mcv.m === MISSION_UNLOAD) {
        // MCV is already deploying (MISSION_UNLOAD) — don't re-send deploy
        reasons.push('MCV deploying');
      } else if (this.isIdle(mcv)) {
        commands.push({ cmd: 'deploy', ids: [mcv.id] });
        this.mcvDeployAttempts++;
        reasons.push(mcvAge > 300 ? `deploy MCV (idle, ${mcvAge} ticks)` : 'deploy MCV');
      } else if (mcvAge > 2000 && this.mcvDeployAttempts === 0) {
        // MCV never became idle — force deploy anyway (might be in non-idle guard state)
        commands.push({ cmd: 'deploy', ids: [mcv.id] });
        this.mcvDeployAttempts++;
        reasons.push(`force deploy MCV (never idle, ${mcvAge} ticks)`);
      } else {
        reasons.push('MCV moving to position...');
      }

      const combatEscorts = playerUnits.filter(
        (u) => u.id !== mcv.id && this.isCombatUnit(u) && !BASE_NON_COMBAT_TYPES.has(u.t),
      );

      if (alliedStructures.length > 0) {
        // We have a base — defend it, don't pull army to MCV
        const baseCenter = this.findBase(alliedStructures);
        const baseThreats = state.enemies.filter(
          (e) => this.distanceSq(e, baseCenter) <= 400,
        );
        if (baseThreats.length > 0 && combatEscorts.length > 0) {
          const micro = this.microManage(combatEscorts, baseThreats, baseCenter);
          commands.push(...micro.commands);
          reasons.push(`defend base (${baseThreats.length} threats)`, ...micro.reasons);
        }
      } else {
        // No base — escort the MCV
        const nearbyThreats = state.enemies.filter(
          (e) => this.distanceSq(e, mcv) <= 225,
        );
        if (nearbyThreats.length > 0 && combatEscorts.length > 0) {
          const micro = this.microManage(combatEscorts, nearbyThreats, mcv);
          commands.push(...micro.commands);
          reasons.push(...micro.reasons);
        } else if (combatEscorts.length > 0) {
          const strayEscorts = combatEscorts.filter(
            (u) => this.distanceSq(u, mcv) > 36,
          );
          if (strayEscorts.length > 0) {
            commands.push({
              cmd: 'move',
              ids: strayEscorts.map((u) => u.id),
              cx: mcv.cx,
              cy: mcv.cy,
            });
            reasons.push(`rally ${strayEscorts.length} to MCV`);
          }
        }
      }
      this.dispatchMinelayers(playerUnits, mcv, commands, reasons);
      return { commands, reason: reasons.join('; ') };
    }

    if (!conYard) {
      // No MCV, no ConYard — fall back to basic combat
      return this.decideGenericCombat(state, playerUnits, alliedStructures);
    }

    // --- Phase 2: BUILD ORDER ---
    // Check if something is currently in production (building type)
    const buildingProduction = state.production.find(
      (p) => p.rtti === RTTI_BUILDINGTYPE,
    );

    // Place completed buildings
    if (buildingProduction?.done) {
      // Place refineries away from known enemies to protect harvesters
      let offsets = PLACEMENT_OFFSETS;
      if (buildingProduction.t === 'PROC' && this.lastKnownEnemyCentroid) {
        const ec = this.lastKnownEnemyCentroid;
        offsets = [...PLACEMENT_OFFSETS].sort((a, b) => {
          const aDist = (conYard.cx + a.cx - ec.cx) ** 2 + (conYard.cy + a.cy - ec.cy) ** 2;
          const bDist = (conYard.cx + b.cx - ec.cx) ** 2 + (conYard.cy + b.cy - ec.cy) ** 2;
          return bDist - aDist; // furthest from enemy first
        });
      }
      const offset = offsets[this.placementAttempts % offsets.length];
      const placeCx = conYard.cx + offset.cx;
      const placeCy = conYard.cy + offset.cy;
      commands.push({
        cmd: 'place',
        rtti: RTTI_BUILDINGTYPE,
        cx: placeCx,
        cy: placeCy,
      });
      // Cycle through placement offsets on repeated attempts
      if (state.tick - this.lastPlacementTick > 60) {
        this.placementAttempts++;
        this.lastPlacementTick = state.tick;
      }
      reasons.push(`place ${buildingProduction.t} at (${placeCx},${placeCy})`);
    } else if (!buildingProduction && buildable) {
      // Nothing building — find next item in build order
      // Don't reset placementAttempts — keep advancing through offsets
      // so successive buildings don't land on the same cell

      // Keep power healthy — only build power when actually in deficit,
      // or when consumption is high and surplus is thin (<100 buffer).
      // Don't waste credits on power when we barely consume any.
      const powerDeficit = state.power.consumed - state.power.produced;
      const needMorePower = powerDeficit > 0 ||
        (state.power.consumed >= 200 && powerDeficit > -100);
      if (needMorePower && buildable.structures.includes('APWR')) {
        // Prefer APWR (200 power) over POWR (100 power) when available
        commands.push({
          cmd: 'produce',
          rtti: RTTI_BUILDINGTYPE,
          type_id: 18, // STRUCT_ADVANCED_POWER
        });
        reasons.push(`produce APWR (power ${state.power.produced}/${state.power.consumed})`);
      } else if (needMorePower && buildable.structures.includes('POWR')) {
        commands.push({
          cmd: 'produce',
          rtti: RTTI_BUILDINGTYPE,
          type_id: 17, // STRUCT_POWER
        });
        reasons.push('produce POWR (power deficit)');
      } else {
        // Find next building in build order we don't have yet.
        // Always scan from the start — buildings can be destroyed and
        // need rebuilding. Skip ones that currently exist on the map.
        let ordered = false;
        for (let i = 0; i < BUILD_ORDER.length; i++) {
          const entry = BUILD_ORDER[i];
          // Check if we already have enough of this building type
          const maxCount = entry.maxCount ?? 1;
          const existingCount = entry.names.reduce(
            (count, n) => count + alliedStructures.filter((s) => s.t === n).length, 0,
          );
          if (existingCount >= maxCount) {
            continue;
          }
          // Find the first buildable alternative from the C++ Can_Build list
          // Note: the C++ Can_Build may return cross-faction buildings (known bug)
          // but the game accepts them, so trust the buildable list
          const buildableIdx = entry.names.findIndex((n) =>
            buildable.structures.includes(n),
          );
          if (buildableIdx >= 0) {
            commands.push({
              cmd: 'produce',
              rtti: RTTI_BUILDINGTYPE,
              type_id: entry.type_ids[buildableIdx],
            });
            reasons.push(`produce ${entry.names[buildableIdx]}`);
            ordered = true;
            break;
          } else {
            // Can't build any alternative yet — prerequisites not met, try next entry
            continue;
          }
        }
        // If build order complete and we have credits, build extra power or defenses
        if (!ordered && this.baseBuildIndex >= BUILD_ORDER.length) {
          if (state.power.consumed >= state.power.produced && buildable.structures.includes('POWR')) {
            commands.push({
              cmd: 'produce',
              rtti: RTTI_BUILDINGTYPE,
              type_id: 17, // STRUCT_POWER
            });
            reasons.push('produce POWR (expansion)');
          }
        }
      }
    }

    // --- Phase 3: PRODUCE UNITS ---
    const hasWarFactory = alliedStructures.some((s) => s.t === 'WEAP');
    const hasBarracks = alliedStructures.some(
      (s) => s.t === 'TENT' || s.t === 'BARR',
    );

    // --- Unit production priority: tanks > infantry, save money for structures ---
    const unitProduction = state.production.find(
      (p) => p.rtti === RTTI_UNITTYPE,
    );
    const infantryProduction = state.production.find(
      (p) => p.rtti === RTTI_INFANTRYTYPE,
    );

    // Check if we're still saving for a building (don't drain credits)
    const savingForBuilding = buildingProduction != null ||
      (this.baseBuildIndex < BUILD_ORDER.length && !hasWarFactory);
    const minCreditsForInfantry = savingForBuilding ? 1500 : 300;

    // Produce units from War Factory — priority: harvester replacement > tanks
    const tankCount = playerUnits.filter((u) => u.t.includes('TNK')).length;
    const harvCount = playerUnits.filter((u) => u.t === 'HARV').length;
    const refCount = alliedStructures.filter((s) => s.t === 'PROC').length;
    // Only replace harvesters when we have other units (PROC auto-spawns a free HARV)
    const needHarvester = harvCount < refCount && playerUnits.length > 0 && buildable?.units.includes('HARV');

    if (hasWarFactory && !unitProduction && buildable) {
      if (needHarvester && state.credits > 600) {
        // Replace lost harvester — economy dies without it
        const harvTypeId = this.unitNameToTypeId('HARV');
        if (harvTypeId >= 0) {
          commands.push({
            cmd: 'produce',
            rtti: RTTI_UNITTYPE,
            type_id: harvTypeId,
          });
          reasons.push('produce HARV (replacement)');
        }
      } else {
        // Tank production — first few tanks are critical, lower credit threshold
        const tankCreditThreshold = tankCount < 3 ? 400 : 700;
        if (state.credits > tankCreditThreshold) {
          const tank = TANK_PREFERENCE.find((t) => buildable.units.includes(t));
          if (tank) {
            const unitTypeId = this.unitNameToTypeId(tank);
            if (unitTypeId >= 0) {
              commands.push({
                cmd: 'produce',
                rtti: RTTI_UNITTYPE,
                type_id: unitTypeId,
              });
              reasons.push(`produce ${tank}`);
            }
          }
        }
      }
    }
    // Place/exit completed units
    if (unitProduction?.done) {
      commands.push({
        cmd: 'place',
        rtti: RTTI_UNITTYPE,
      });
      reasons.push(`exit ${unitProduction.t}`);
    }

    // Produce infantry only if we have spare credits (don't starve tank/building production)
    if (hasBarracks && !infantryProduction && buildable && state.credits > minCreditsForInfantry) {
      const inf = INFANTRY_PREFERENCE.find((i) => buildable.infantry.includes(i));
      if (inf) {
        const infTypeId = this.infantryNameToTypeId(inf);
        if (infTypeId >= 0) {
          commands.push({
            cmd: 'produce',
            rtti: RTTI_INFANTRYTYPE,
            type_id: infTypeId,
          });
          reasons.push(`produce ${inf}`);
        }
      }
    }
    if (infantryProduction?.done) {
      commands.push({
        cmd: 'place',
        rtti: RTTI_INFANTRYTYPE,
      });
      reasons.push(`exit ${infantryProduction.t}`);
    }

    // --- Phase 3.5: MINELAYER DEFENSE ---
    this.dispatchMinelayers(playerUnits, conYard, commands, reasons);

    // --- Phase 3.75: CRITICAL STRUCTURE GUARD (mission-specific) ---
    // SCG08EA: always keep 3+ units near ATEK and PDOX — lose if destroyed
    if (this.scenario === 'SCG08EA') {
      const critGuards = playerUnits.filter(
        (u) => this.isCombatUnit(u) && !BASE_NON_COMBAT_TYPES.has(u.t) && u.hp / u.mhp >= 0.5,
      );
      for (const critPoint of OracleStrategy.SCG08EA_CRITICAL) {
        const nearCrit = critGuards.filter((u) => this.distanceSq(u, critPoint) <= 100);
        const critThreats = state.enemies.filter((e) => this.distanceSq(e, critPoint) <= 225);
        if (critThreats.length > 0 && nearCrit.length > 0) {
          const micro = this.microManage(nearCrit, critThreats, critPoint);
          commands.push(...micro.commands);
          reasons.push(`guard critical (${critThreats.length} threats)`);
        } else if (nearCrit.length < 3 && critGuards.length > 6) {
          // Station more guards near critical structure
          const farUnits = critGuards
            .filter((u) => this.distanceSq(u, critPoint) > 100)
            .slice(0, 3 - nearCrit.length);
          if (farUnits.length > 0) {
            commands.push({
              cmd: 'move',
              ids: farUnits.map((u) => u.id),
              cx: critPoint.cx,
              cy: critPoint.cy,
            });
            reasons.push(`station ${farUnits.length} near critical`);
          }
        }
      }
    }

    // --- Phase 4: COMBAT (defend-first, attack with surplus) ---
    const combatUnits = playerUnits.filter(
      (u) => this.isCombatUnit(u) && !BASE_NON_COMBAT_TYPES.has(u.t),
    );

    // Base center = centroid of all allied structures (not just ConYard)
    const baseCenter = alliedStructures.length > 0
      ? this.centroid(alliedStructures as unknown as RAEntity[])
      : { cx: conYard.cx, cy: conYard.cy };

    // Base threats — enemies near ANY allied structure (20 cell radius)
    const baseThreats = state.enemies.filter(
      (e) => alliedStructures.some((s) => this.distanceSq(e, s) <= 400),
    );

    // Retreat injured to base
    const injured = combatUnits.filter(
      (u) => u.hp / u.mhp < RETREAT_HP_FRACTION && u.hp > 0,
    );
    const healthy = combatUnits.filter(
      (u) => u.hp / u.mhp >= RETREAT_HP_FRACTION,
    );
    if (injured.length > 0) {
      commands.push({
        cmd: 'move',
        ids: injured.map((u) => u.id),
        cx: baseCenter.cx,
        cy: baseCenter.cy,
      });
      reasons.push(`retreat ${injured.length} injured`);
    }

    if (healthy.length > 0) {
      // DEFEND FIRST: if base is threatened, send units to deal with threats
      if (baseThreats.length > 0) {
        // How many defenders do we need? Match the threat + buffer
        const threatStr = baseThreats.reduce(
          (s, e) => s + (e.t.includes('TNK') ? 3 : 1), 0,
        );
        const defendersNeeded = Math.min(healthy.length, Math.ceil(threatStr * 1.5));
        const defenders = healthy.slice(0, defendersNeeded);
        const surplus = healthy.slice(defendersNeeded);

        // Defenders engage base threats — only command idle/guard units to avoid
        // stuttering from re-commanding units already mid-attack
        const idleDefenders = defenders.filter((u) => this.isIdle(u) || u.m === MISSION_GUARD);
        if (idleDefenders.length > 0) {
          const micro = this.microManage(idleDefenders, baseThreats, baseCenter);
          commands.push(...micro.commands);
          reasons.push(...micro.reasons);
        }
        reasons.push(`defend base (${baseThreats.length} threats, ${defenders.length} def, ${idleDefenders.length} idle)`);

        // In survival mode, ALL units defend — no surplus chasing.
        // In non-survival, surplus attacks nearby enemies within leash range.
        const isTimedSurvival = state.missionTimerActive && state.missionTimer > 0;
        if (isTimedSurvival) {
          // Survival: surplus also helps defend — everyone fights base threats
          if (surplus.length > 0) {
            const surplusMicro = this.microManage(surplus, baseThreats, baseCenter);
            commands.push(...surplusMicro.commands);
            reasons.push(`all defend (survival, ${surplus.length} surplus)`);
          }
        } else {
          const leashSq = 900; // 30 cells
          const nearbyEnemies = state.enemies.filter(
            (e) => this.distanceSq(e, baseCenter) <= leashSq,
          );
          if (surplus.length > 0 && nearbyEnemies.length > 0) {
            const atkMicro = this.microManage(surplus, nearbyEnemies, baseCenter);
            commands.push(...atkMicro.commands);
            reasons.push(`attack nearby ${surplus.length}`);
          } else if (surplus.length > 0) {
            const stray = surplus.filter((u) => this.isIdle(u) && this.distanceSq(u, baseCenter) > 225);
            if (stray.length > 0) {
              commands.push({
                cmd: 'move',
                ids: stray.map((u) => u.id),
                cx: baseCenter.cx,
                cy: baseCenter.cy,
              });
              reasons.push(`patrol ${stray.length} to base`);
            }
          }
        }
      } else {
        // No base threats — check for unit-proximity engagement first
        // Units should engage enemies near them regardless of full attack threshold
        const unitThreats = state.enemies.filter(
          (e) => healthy.some((u) => this.distanceSq(u, e) <= 225), // 15 cells
        );
        if (unitThreats.length > 0 && healthy.length >= 3) {
          const idleHealthy = healthy.filter((u) => this.isIdle(u));
          if (idleHealthy.length > 0) {
            const micro = this.microManage(idleHealthy, unitThreats, baseCenter);
            commands.push(...micro.commands);
            reasons.push(...micro.reasons);
          }
          reasons.push(`defend units (${unitThreats.length} threats, ${idleHealthy.length} idle)`);
        } else {
        // No base threats, no unit threats — decide: attack or turtle?
        // If there's a mission timer counting down, this is a survival mission — turtle.
        const isTimedSurvival = state.missionTimerActive && state.missionTimer > 0;
        const tankCount = healthy.filter((u) => u.t.includes('TNK')).length;
        const friendlyStr = healthy.reduce(
          (s, u) => s + (u.t.includes('TNK') ? 3 : 1) * (u.hp / u.mhp), 0,
        );
        const enemyStr = state.enemies.reduce(
          (s, e) => s + (e.t.includes('TNK') ? 3 : 1) * (e.hp / e.mhp), 0,
        );
        const shouldAttack = !isTimedSurvival && tankCount >= 6 && friendlyStr > enemyStr * 1.5;

        if (shouldAttack && state.enemies.length > 0) {
          const defenderCount = Math.max(3, Math.floor(healthy.length / 2));
          const defenders = healthy.slice(0, defenderCount);
          const attackers = healthy.slice(defenderCount);
          const leashSq2 = 900; // 30 cells from base

          // Defenders patrol near base (only re-command idle ones)
          const strayDefenders = defenders.filter(
            (u) => this.isIdle(u) && this.distanceSq(u, baseCenter) > 225,
          );
          if (strayDefenders.length > 0) {
            commands.push({
              cmd: 'move',
              ids: strayDefenders.map((u) => u.id),
              cx: baseCenter.cx,
              cy: baseCenter.cy,
            });
            reasons.push(`${strayDefenders.length} defend base`);
          }

          // Attackers only engage enemies within leash range
          const leashEnemies = state.enemies.filter(
            (e) => this.distanceSq(e, baseCenter) <= leashSq2,
          );
          if (attackers.length > 0 && leashEnemies.length > 0) {
            const micro = this.microManage(attackers, leashEnemies, baseCenter);
            commands.push(...micro.commands);
            reasons.push(`attack ${attackers.length} (${tankCount} tanks, leashed)`);
            reasons.push(...micro.reasons);
          } else if (attackers.length > 0) {
            // No enemies in range — all-out push
            const micro = this.microManage(attackers, state.enemies, baseCenter);
            commands.push(...micro.commands);
            reasons.push(`attack ${attackers.length} (${tankCount} tanks)`);
            reasons.push(...micro.reasons);
          }
        } else if (isTimedSurvival) {
          // TURTLE MODE — survival mission, keep idle units near base
          const stray = healthy.filter(
            (u) => this.isIdle(u) && this.distanceSq(u, baseCenter) > 225,
          );
          if (stray.length > 0) {
            commands.push({
              cmd: 'move',
              ids: stray.map((u) => u.id),
              cx: baseCenter.cx,
              cy: baseCenter.cy,
            });
            reasons.push(`turtle ${stray.length} to base (timer=${state.missionTimer})`);
          } else {
            reasons.push(`turtle mode (timer=${state.missionTimer})`);
          }
        } else if (state.enemies.length > 0) {
          // Not enough to attack — build up force, hold near base, send scout
          const stray = healthy.filter(
            (u) => this.isIdle(u) && this.distanceSq(u, baseCenter) > 225,
          );
          if (stray.length > 0) {
            commands.push({
              cmd: 'move',
              ids: stray.map((u) => u.id),
              cx: baseCenter.cx,
              cy: baseCenter.cy,
            });
            reasons.push(`rally ${stray.length} to base`);
          }
          reasons.push(`building up (${tankCount} tanks, ${friendlyStr.toFixed(0)} vs ${enemyStr.toFixed(0)})`);
          if (!isTimedSurvival && this.ticksSinceLastEnemy > 150) {
            const scout = healthy.find((u) => u.t === 'E1' || u.t === 'E3') ?? healthy[0];
            if (scout) {
              const wp = EXPLORE_WAYPOINTS[this.exploreIndex % EXPLORE_WAYPOINTS.length];
              commands.push({ cmd: 'attack_move', ids: [scout.id], cx: wp.cx, cy: wp.cy });
              this.exploreIndex++;
              reasons.push(`scout ${scout.t}`);
            }
          }
        } else {
          // No enemies — scout
          if (this.ticksSinceLastEnemy > 90) {
            const scout = healthy.find((u) => u.t === 'E1' || u.t === 'E3') ?? healthy[0];
            if (scout) {
              const wp = EXPLORE_WAYPOINTS[this.exploreIndex % EXPLORE_WAYPOINTS.length];
              commands.push({ cmd: 'attack_move', ids: [scout.id], cx: wp.cx, cy: wp.cy });
              this.exploreIndex++;
              reasons.push(`scout ${scout.t}`);
            }
          }
        }
        } // close unit-proximity else
      }
    }

    return {
      commands: this.dedupeCommands(commands),
      reason: reasons.join('; ') || 'base building — waiting',
    };
  }

  /**
   * Fallback combat logic when no MCV/ConYard available in base-building mode.
   */
  private decideGenericCombat(
    state: RAGameState,
    playerUnits: RAEntity[],
    alliedStructures: RAStructure[],
  ): OracleDecision {
    const commands: Array<Record<string, unknown>> = [];
    const reasons: string[] = [];
    const controlled = playerUnits.filter((u) => this.isCombatUnit(u));

    const injured = controlled.filter(
      (u) => u.hp / u.mhp < RETREAT_HP_FRACTION && u.hp > 0,
    );
    if (injured.length > 0 && alliedStructures.length > 0) {
      const base = this.findBase(alliedStructures);
      commands.push({
        cmd: 'move',
        ids: injured.map((u) => u.id),
        cx: base.cx,
        cy: base.cy,
      });
      reasons.push(`retreat ${injured.length} injured`);
    }

    const healthy = controlled.filter((u) => u.hp / u.mhp >= RETREAT_HP_FRACTION);

    if (state.enemies.length > 0 && healthy.length > 0) {
      // Estimate force ratio before committing to an attack
      const friendlyStr = healthy.reduce(
        (s, u) => s + (u.t.includes('TNK') ? 3 : 1) * (u.hp / u.mhp), 0,
      );
      const enemyStr = state.enemies.reduce(
        (s, e) => s + (e.t.includes('TNK') ? 3 : 1) * (e.hp / e.mhp), 0,
      );

      if (friendlyStr > enemyStr * 1.5) {
        // Strong enough — attack with micro-management
        const rallyPoint = alliedStructures.length > 0
          ? this.findBase(alliedStructures) as Point
          : this.centroid(healthy);
        const micro = this.microManage(healthy, state.enemies, rallyPoint);
        commands.push(...micro.commands);
        reasons.push(`attack ${healthy.length} (${friendlyStr.toFixed(0)} vs ${enemyStr.toFixed(0)})`);
        reasons.push(...micro.reasons);
      } else {
        // Outgunned — send one scout, keep rest defensive
        const scout = healthy.find((u) => u.t === 'E1' || u.t === 'E3') ?? healthy[healthy.length - 1];
        if (scout && (this.ticksSinceLastEnemy > 120 || this.isIdle(scout))) {
          const wp = EXPLORE_WAYPOINTS[this.exploreIndex % EXPLORE_WAYPOINTS.length];
          commands.push({
            cmd: 'attack_move',
            ids: [scout.id],
            cx: wp.cx,
            cy: wp.cy,
          });
          this.exploreIndex++;
          reasons.push(`scout ${scout.t} (outgunned ${friendlyStr.toFixed(0)} vs ${enemyStr.toFixed(0)})`);
        }
      }
    }

    if (state.enemies.length === 0 && healthy.length > 0) {
      if (this.ticksSinceLastEnemy > 90 || healthy.some((u) => this.isIdle(u))) {
        // Send one scout, not the whole army
        const scout = healthy.find((u) => u.t === 'E1' || u.t === 'E3') ?? healthy[0];
        if (scout) {
          const wp = EXPLORE_WAYPOINTS[this.exploreIndex % EXPLORE_WAYPOINTS.length];
          commands.push({
            cmd: 'attack_move',
            ids: [scout.id],
            cx: wp.cx,
            cy: wp.cy,
          });
          this.exploreIndex++;
          reasons.push(`scout ${scout.t} → (${wp.cx},${wp.cy})`);
        }
      }
    }

    return {
      commands,
      reason: reasons.join('; ') || 'waiting',
    };
  }

  private decideScg01ea(state: RAGameState): OracleDecision {
    const commands: Array<Record<string, unknown>> = [];
    const reasons: string[] = [];

    const playerCombat = this.playerOwnedUnits(state).filter(
      (u) => this.isCombatUnit(u) && u.t !== 'E7',
    );
    const tanya = state.units.find((u) => u.t === 'E7');
    const einstein = state.units.find((u) => u.t === 'EINSTEIN');
    const rescueTriggered = this.isScg01eaRescueTriggered(state);
    const transport = rescueTriggered ? this.pickScg01eaEvacTransport(state) : undefined;
    const transportLoaded = Boolean(
      transport && ((transport.cargo ?? 0) > 0 || transport.cargoTop === 'EINSTEIN'),
    );
    const einsteinAtEvac = Boolean(
      einstein && this.distanceSq(einstein, SCG01EA_EVAC_POINT) <= 4,
    );
    const transportReadyForBoarding = Boolean(
      transport && this.distanceSq(transport, SCG01EA_EVAC_POINT) <= SCG01EA_EVAC_READY_DISTANCE_SQ,
    );
    const transportCloseToEinstein = Boolean(
      transport && einstein && this.distanceSq(transport, einstein) <= SCG01EA_BOARD_DISTANCE_SQ,
    );
    const playerTransportCloseToEinstein = Boolean(
      transport &&
      einstein &&
      state.playerHouse &&
      transport.house === state.playerHouse &&
      this.distanceSq(transport, einstein) <= SCG01EA_PLAYER_TRANSPORT_BOARD_DISTANCE_SQ,
    );
    const playerTransportRescueReady = Boolean(
      transport &&
      state.playerHouse &&
      transport.house === state.playerHouse &&
      this.distanceSq(transport, SCG01EA_ESCORT_POINT) <= 16,
    );

    const westPowerPlants = state.structures
      .filter((s) => !s.ally && s.t === 'POWR' && s.cx <= SCG01EA_POWER_LINE_X)
      .sort((a, b) => a.cx - b.cx || a.cy - b.cy);

    const prisonThreats = state.enemies
      .filter((e) => this.distanceSq(e, SCG01EA_PRISON) <= 49)
      .sort((a, b) => this.distanceSq(a, SCG01EA_PRISON) - this.distanceSq(b, SCG01EA_PRISON));
    const tanyaThreats = state.enemies
      .filter((e) => this.distanceSq(e, SCG01EA_TANYA_STAGE) <= 36)
      .sort((a, b) => this.distanceSq(a, SCG01EA_TANYA_STAGE) - this.distanceSq(b, SCG01EA_TANYA_STAGE));

    const escortCombat = playerCombat.filter((u) => this.distanceSq(u, SCG01EA_PRISON) <= 64);
    const escortShouldFavorPrison = Boolean(
      tanya && tanya.cy >= SCG01EA_TANYA_STAGE.cy - 4,
    );
    const prisonAssaultReady = escortCombat.length >= 2 || escortShouldFavorPrison;
    const rescueThreatReference = einstein ?? SCG01EA_EVAC_POINT;
    const flareThreats = state.enemies
      .filter((e) =>
        this.distanceSq(e, SCG01EA_EVAC_POINT) <= 144 ||
        this.distanceSq(e, SCG01EA_ESCORT_POINT) <= 100,
      )
      .sort((a, b) => {
        const aReferenceDistance = this.distanceSq(a, rescueThreatReference);
        const bReferenceDistance = this.distanceSq(b, rescueThreatReference);
        if (aReferenceDistance !== bReferenceDistance) {
          return aReferenceDistance - bReferenceDistance;
        }
        return this.distanceSq(a, SCG01EA_EVAC_POINT) - this.distanceSq(b, SCG01EA_EVAC_POINT);
      });

    if (tanya) {
      const tanyaHp = tanya.hp / tanya.mhp;
      if (tanyaHp < 0.35) {
        commands.push({
          cmd: 'move',
          ids: [tanya.id],
          cx: SCG01EA_TANYA_STAGE.cx,
          cy: SCG01EA_TANYA_STAGE.cy,
        });
        reasons.push('pull Tanya back');
      } else if (!rescueTriggered && prisonAssaultReady && prisonThreats.length > 0) {
        commands.push({
          cmd: 'attack_move',
          ids: [tanya.id],
          cx: prisonThreats[0].cx,
          cy: prisonThreats[0].cy,
        });
        reasons.push(`Tanya clears prison (${prisonThreats[0].cx},${prisonThreats[0].cy})`);
      } else if (!rescueTriggered && tanyaThreats.length > 0) {
        commands.push({
          cmd: 'attack_move',
          ids: [tanya.id],
          cx: tanyaThreats[0].cx,
          cy: tanyaThreats[0].cy,
        });
        reasons.push(`Tanya clears approach (${tanyaThreats[0].cx},${tanyaThreats[0].cy})`);
      } else if (!rescueTriggered && prisonThreats.length > 0) {
        commands.push({
          cmd: 'attack_move',
          ids: [tanya.id],
          cx: prisonThreats[0].cx,
          cy: prisonThreats[0].cy,
        });
        reasons.push(`Tanya clears prison (${prisonThreats[0].cx},${prisonThreats[0].cy})`);
      } else if (!rescueTriggered && westPowerPlants.length > 0) {
        commands.push({
          cmd: 'attack',
          ids: [tanya.id],
          target: westPowerPlants[0].id,
        });
        reasons.push(`Tanya hits power (${westPowerPlants[0].cx},${westPowerPlants[0].cy})`);
      } else if (!rescueTriggered && escortCombat.length < 2) {
        commands.push({
          cmd: 'move',
          ids: [tanya.id],
          cx: SCG01EA_TANYA_STAGE.cx,
          cy: SCG01EA_TANYA_STAGE.cy,
        });
        reasons.push('stage Tanya');
      } else if (!rescueTriggered) {
        commands.push({
          cmd: 'move',
          ids: [tanya.id],
          cx: SCG01EA_PRISON.cx,
          cy: SCG01EA_PRISON.cy,
        });
        reasons.push('trigger prison rescue');
      }
    }

    if (!rescueTriggered) {
      if (playerCombat.length > 0) {
        const assaultTarget = prisonAssaultReady
          ? prisonThreats[0] ?? tanyaThreats[0]
          : tanyaThreats[0] ?? prisonThreats[0];
        if (assaultTarget) {
          commands.push({
            cmd: 'attack',
            ids: playerCombat.map((u) => u.id),
            target: assaultTarget.id,
          });
          reasons.push(`escort attacks (${assaultTarget.cx},${assaultTarget.cy})`);
        } else {
          commands.push({
            cmd: 'attack_move',
            ids: playerCombat.map((u) => u.id),
            cx: SCG01EA_PRISON_ASSAULT.cx,
            cy: SCG01EA_PRISON_ASSAULT.cy,
          });
          reasons.push('escort advances on prison');
        }
      }
    } else {
      if (
        transport &&
        !transportLoaded &&
        state.playerHouse &&
        transport.house === state.playerHouse &&
        this.distanceSq(transport, SCG01EA_ESCORT_POINT) > 16
      ) {
        commands.push({
          cmd: 'move',
          ids: [transport.id],
          cx: SCG01EA_ESCORT_POINT.cx,
          cy: SCG01EA_ESCORT_POINT.cy,
        });
        reasons.push('stage player transport rescue');
      } else if (transport && !transportLoaded && this.distanceSq(transport, SCG01EA_EVAC_POINT) > 4) {
        commands.push({
          cmd: 'move',
          ids: [transport.id],
          cx: SCG01EA_EVAC_POINT.cx,
          cy: SCG01EA_EVAC_POINT.cy,
        });
        reasons.push('stage evac helicopter');
      }

      if (
        einstein &&
        transport &&
        !transportLoaded &&
        (
          transportCloseToEinstein ||
          playerTransportCloseToEinstein ||
          (playerTransportRescueReady && this.distanceSq(einstein, SCG01EA_ESCORT_POINT) <= 16)
        )
      ) {
        commands.push({
          cmd: 'enter',
          ids: [einstein.id],
          target: transport.id,
        });
        reasons.push('board Einstein');
      } else if (
        einstein &&
        transport &&
        !transportLoaded &&
        state.playerHouse &&
        transport.house === state.playerHouse &&
        this.distanceSq(einstein, SCG01EA_ESCORT_POINT) > 16
      ) {
        commands.push({
          cmd: 'move',
          ids: [einstein.id],
          cx: SCG01EA_ESCORT_POINT.cx,
          cy: SCG01EA_ESCORT_POINT.cy,
        });
        reasons.push('rally Einstein to rescue transport');
      } else if (einstein && !transportLoaded && !einsteinAtEvac) {
        commands.push({
          cmd: 'move',
          ids: [einstein.id],
          cx: SCG01EA_EVAC_POINT.cx,
          cy: SCG01EA_EVAC_POINT.cy,
        });
        reasons.push('move Einstein to evac point');
      } else if (einstein && transport && !transportLoaded && transportReadyForBoarding) {
        commands.push({
          cmd: 'enter',
          ids: [einstein.id],
          target: transport.id,
        });
        reasons.push('board Einstein');
      } else if (einstein && !transportLoaded) {
        reasons.push('wait for evac helicopter');
      } else if (transportLoaded) {
        reasons.push('transport evacuating Einstein');
      }

      if (tanya && this.distanceSq(tanya, SCG01EA_ESCORT_POINT) > 9) {
        commands.push({
          cmd: 'move',
          ids: [tanya.id],
          cx: SCG01EA_ESCORT_POINT.cx,
          cy: SCG01EA_ESCORT_POINT.cy,
        });
        reasons.push('Tanya escorts evac');
      }

      if (playerCombat.length > 0) {
        if (flareThreats.length > 0) {
          commands.push({
            cmd: 'attack',
            ids: playerCombat.map((u) => u.id),
            target: flareThreats[0].id,
          });
          reasons.push(`escort clears route (${flareThreats[0].cx},${flareThreats[0].cy})`);
        } else {
          commands.push({
            cmd: 'attack_move',
            ids: playerCombat.map((u) => u.id),
            cx: SCG01EA_ESCORT_POINT.cx,
            cy: SCG01EA_ESCORT_POINT.cy,
          });
          reasons.push('escort moves to evac zone');
        }
      }
    }

    return {
      commands: this.dedupeCommands(commands),
      reason: reasons.join('; ') || 'waiting',
    };
  }

  private decideScg02ea(state: RAGameState): OracleDecision {
    const commands: Array<Record<string, unknown>> = [];
    const reasons: string[] = [];
    const convoyUnits = state.units.filter((u) => u.t === 'TRUK');
    const playerUnits = this.playerOwnedUnits(state);
    const combatUnits = playerUnits.filter(
      (u) => this.isCombatUnit(u) && !SCG02EA_NON_COMBAT_TYPES.has(u.t),
    );
    const medics = playerUnits.filter((u) => u.t === 'MEDI');
    const alliedStructures = state.structures.filter((structure) => structure.ally);
    const fallbackPoint = alliedStructures.length > 0
      ? { cx: this.findBase(alliedStructures).cx, cy: this.findBase(alliedStructures).cy }
      : SCG02EA_DEFENSE_POINT;
    const convoyRallyPoint =
      state.missionTimerActive && state.missionTimer !== undefined && state.missionTimer <= 3_000
        ? SCG02EA_CONVOY_ROUTE[0]
        : state.missionTimerActive && state.missionTimer !== undefined && state.missionTimer <= 8_000
          ? SCG02EA_CONVOY_ROUTE[1]
          : state.missionTimerActive && state.missionTimer !== undefined && state.missionTimer <= 12_000
            ? SCG02EA_CONVOY_ROUTE[2]
            : undefined;
    const convoyMode = convoyUnits.length > 0 || convoyRallyPoint !== undefined;
    const injuredCombat = combatUnits.filter(
      (unit) => unit.hp / unit.mhp < SCG02EA_RETREAT_HP_FRACTION,
    );
    const recoveringCombat = combatUnits.filter((unit) => {
      const hpFraction = unit.hp / unit.mhp;
      return hpFraction >= SCG02EA_RETREAT_HP_FRACTION && hpFraction < SCG02EA_READY_HP_FRACTION;
    });
    const readyCombat = convoyMode
      ? combatUnits.filter((unit) => unit.hp / unit.mhp >= SCG02EA_RETREAT_HP_FRACTION)
      : combatUnits.filter((unit) => unit.hp / unit.mhp >= SCG02EA_READY_HP_FRACTION);
    const restingCombat = convoyMode ? injuredCombat : [...injuredCombat, ...recoveringCombat];

    if (restingCombat.length > 0) {
      commands.push({
        cmd: 'move',
        ids: restingCombat.map((unit) => unit.id),
        cx: fallbackPoint.cx,
        cy: fallbackPoint.cy,
      });
      reasons.push(`recover ${restingCombat.length} wounded`);
    }

    if (convoyUnits.length > 0) {
      const convoyPoint = convoyUnits.reduce((best, unit) => {
        if (!best) return unit;
        return unit.cx + unit.cy > best.cx + best.cy ? unit : best;
      }, convoyUnits[0]);
      const convoyThreats = state.enemies
        .filter((enemy) => this.distanceSq(enemy, convoyPoint) <= 121)
        .sort((a, b) => this.distanceSq(a, convoyPoint) - this.distanceSq(b, convoyPoint));

      if (medics.length > 0) {
        commands.push({
          cmd: 'move',
          ids: medics.map((unit) => unit.id),
          cx: convoyPoint.cx,
          cy: convoyPoint.cy,
        });
        reasons.push('medic follows convoy');
      }

      if (readyCombat.length > 0) {
        const escortNearby = readyCombat.some((unit) => this.distanceSq(unit, convoyPoint) <= 196);
        if (convoyThreats.length > 0) {
          if (escortNearby) {
            commands.push({
              cmd: 'attack_move',
              ids: readyCombat.map((u) => u.id),
              cx: convoyThreats[0].cx,
              cy: convoyThreats[0].cy,
            });
            reasons.push(`escort convoy (${convoyThreats[0].cx},${convoyThreats[0].cy})`);
          } else {
            commands.push({
              cmd: 'move',
              ids: readyCombat.map((u) => u.id),
              cx: convoyPoint.cx,
              cy: convoyPoint.cy,
            });
            reasons.push(`close escort gap (${convoyPoint.cx},${convoyPoint.cy})`);
          }
        } else {
          const routePoint = this.pickScg02eaRoutePoint(convoyPoint);
          commands.push({
            cmd: 'move',
            ids: readyCombat.map((u) => u.id),
            cx: routePoint.cx,
            cy: routePoint.cy,
          });
          reasons.push(`screen convoy → (${routePoint.cx},${routePoint.cy})`);
        }
      }

      return {
        commands: this.dedupeCommands(commands),
        reason: reasons.join('; ') || 'hold convoy route',
      };
    }

    if (medics.length > 0) {
      const medicPoint = readyCombat.length > 0
        ? (restingCombat.length > 0
          ? fallbackPoint
          : convoyRallyPoint ?? SCG02EA_SWEEP_POINTS[this.scg02eaAssaultIndex % SCG02EA_SWEEP_POINTS.length])
        : fallbackPoint;
      commands.push({
        cmd: 'move',
        ids: medics.map((unit) => unit.id),
        cx: medicPoint.cx,
        cy: medicPoint.cy,
      });
      reasons.push(`medic supports (${medicPoint.cx},${medicPoint.cy})`);
    }

    if (readyCombat.length > 0) {
      if (convoyRallyPoint) {
        const rallyNearby = readyCombat.some((unit) => this.distanceSq(unit, convoyRallyPoint) <= 196);
        const rallyThreat = this.pickScg02eaEnemyTarget(state, convoyRallyPoint, 196);
        if (rallyThreat && rallyNearby) {
          commands.push({
            cmd: 'attack_move',
            ids: readyCombat.map((u) => u.id),
            cx: rallyThreat.cx,
            cy: rallyThreat.cy,
          });
          reasons.push(`screen convoy approach (${rallyThreat.cx},${rallyThreat.cy})`);
        } else {
          commands.push({
            cmd: 'move',
            ids: readyCombat.map((u) => u.id),
            cx: convoyRallyPoint.cx,
            cy: convoyRallyPoint.cy,
          });
          reasons.push(`rally convoy route (${convoyRallyPoint.cx},${convoyRallyPoint.cy})`);
        }

        return {
          commands: this.dedupeCommands(commands),
          reason: reasons.join('; ') || 'hold position',
        };
      }

      const waitingForReinforcements = Boolean(
        state.missionTimerActive &&
        state.missionTimer !== undefined &&
        state.missionTimer > 19_000 &&
        readyCombat.length < 10,
      );
      const regrouping = Boolean(
        state.missionTimerActive &&
        state.missionTimer !== undefined &&
        state.missionTimer > 12_000 &&
        readyCombat.length < 6,
      );

      if (waitingForReinforcements || regrouping) {
        const defenseThreat =
          this.pickScg02eaEnemyTarget(state, SCG02EA_DEFENSE_POINT, 196) ??
          this.pickScg02eaEnemyTarget(state, fallbackPoint, 256);
        if (defenseThreat) {
          commands.push({
            cmd: 'attack_move',
            ids: readyCombat.map((u) => u.id),
            cx: defenseThreat.cx,
            cy: defenseThreat.cy,
          });
          reasons.push(`hold approach (${defenseThreat.cx},${defenseThreat.cy})`);
        } else {
          commands.push({
            cmd: 'attack_move',
            ids: readyCombat.map((u) => u.id),
            cx: SCG02EA_DEFENSE_POINT.cx,
            cy: SCG02EA_DEFENSE_POINT.cy,
          });
          reasons.push(`consolidate (${SCG02EA_DEFENSE_POINT.cx},${SCG02EA_DEFENSE_POINT.cy})`);
        }
      } else {
      const sweepPoint = SCG02EA_SWEEP_POINTS[this.scg02eaAssaultIndex % SCG02EA_SWEEP_POINTS.length];
      const closeUnits = readyCombat.filter((unit) => this.distanceSq(unit, sweepPoint) <= 100).length;
      const arrivedUnits = readyCombat.filter((unit) => this.distanceSq(unit, sweepPoint) <= 36).length;
      const stageGoal = Math.max(1, Math.ceil(readyCombat.length / 3));
      const trapBarrel = this.pickScg02eaTrapBarrel(state);
      const pointThreat = this.pickScg02eaEnemyTarget(state, sweepPoint, 169);
      const priorityStructure = this.pickScg02eaStructureTarget(state, sweepPoint, 196);

      if (trapBarrel && (closeUnits >= stageGoal || arrivedUnits > 0)) {
        commands.push({
          cmd: 'attack',
          ids: readyCombat.map((u) => u.id),
          target: trapBarrel.id,
        });
        reasons.push(`detonate trap ${trapBarrel.t} (${trapBarrel.cx},${trapBarrel.cy})`);
      } else if (pointThreat && (closeUnits >= stageGoal || arrivedUnits > 0)) {
        commands.push({
          cmd: 'attack_move',
          ids: readyCombat.map((u) => u.id),
          cx: pointThreat.cx,
          cy: pointThreat.cy,
        });
        reasons.push(`clear corridor (${pointThreat.cx},${pointThreat.cy})`);
      } else if (priorityStructure && (closeUnits >= stageGoal || arrivedUnits > 0)) {
        commands.push({
          cmd: 'attack',
          ids: readyCombat.map((u) => u.id),
          target: priorityStructure.id,
        });
        reasons.push(`break roadblock ${priorityStructure.t} (${priorityStructure.cx},${priorityStructure.cy})`);
      } else if (arrivedUnits > 0 || closeUnits >= stageGoal) {
        this.scg02eaAssaultIndex++;
        const nextPoint = SCG02EA_SWEEP_POINTS[this.scg02eaAssaultIndex % SCG02EA_SWEEP_POINTS.length];
        commands.push({
          cmd: 'attack_move',
          ids: readyCombat.map((u) => u.id),
          cx: nextPoint.cx,
          cy: nextPoint.cy,
        });
        reasons.push(`sweep route → (${nextPoint.cx},${nextPoint.cy})`);
      } else {
        commands.push({
          cmd: 'attack_move',
          ids: readyCombat.map((u) => u.id),
          cx: sweepPoint.cx,
          cy: sweepPoint.cy,
        });
        reasons.push(`form corridor line (${sweepPoint.cx},${sweepPoint.cy})`);
      }
      }
    }

    return {
      commands: this.dedupeCommands(commands),
      reason: reasons.join('; ') || 'hold position',
    };
  }

  /**
   * SCG03EA "Dead End": Destroy two bridges with Tanya while keeping her alive.
   * ARTY provides fire support, medics heal Tanya.
   */
  private decideScg03ea(state: RAGameState): OracleDecision {
    const commands: Array<Record<string, unknown>> = [];
    const reasons: string[] = [];
    const playerUnits = this.playerOwnedUnits(state);

    const tanya = playerUnits.find((u) => u.t === 'E7');
    const arty = playerUnits.find((u) => u.t === 'ARTY');
    const medics = playerUnits.filter((u) => u.t === 'MEDI');
    const engineer = playerUnits.find((u) => u.t === 'E6');
    const bridges = [SCG03EA_BRIDGE_V04, SCG03EA_BRIDGE_V07];

    if (!tanya) {
      reasons.push('Tanya dead — mission lost');
      return { commands, reason: reasons.join('; ') };
    }

    const tanyaHpFrac = tanya.hp / tanya.mhp;
    const currentBridge = bridges[this.scg03eaBridgeIndex];

    // --- Medics follow Tanya ---
    if (medics.length > 0) {
      const farMedics = medics.filter((m) => this.distanceSq(m, tanya) > 64);
      if (farMedics.length > 0) {
        commands.push({
          cmd: 'move',
          ids: farMedics.map((m) => m.id),
          cx: tanya.cx,
          cy: tanya.cy,
        });
        reasons.push(`medics follow Tanya`);
      }
    }

    // --- ARTY fire support — prioritize V2RL (only real threat) ---
    if (arty) {
      const v2 = state.enemies.find((e) => e.t === 'V2RL');
      const nearbyEnemies = state.enemies.filter(
        (e) => this.distanceSq(e, arty) <= 400,
      );
      if (v2) {
        // V2RL is the #1 priority — it can kill Tanya
        commands.push({ cmd: 'attack', ids: [arty.id], target: v2.id });
        reasons.push('ARTY → V2RL');
      } else if (nearbyEnemies.length > 0) {
        const target = this.nearestEnemy(arty, nearbyEnemies);
        commands.push({ cmd: 'attack', ids: [arty.id], target: target.id });
        reasons.push(`ARTY → ${target.t}`);
      } else {
        // Follow Tanya for support
        commands.push({
          cmd: 'move', ids: [arty.id],
          cx: tanya.cx, cy: tanya.cy,
        });
        reasons.push('ARTY follows');
      }
    }

    // --- Engineer stays near Tanya for support ---
    if (engineer && this.distanceSq(engineer, tanya) > 100) {
      commands.push({
        cmd: 'move',
        ids: [engineer.id],
        cx: tanya.cx,
        cy: tanya.cy,
      });
      reasons.push('engineer follows');
    }

    // --- Tanya: bridge assault state machine ---
    if (this.scg03eaBridgeIndex >= bridges.length) {
      // All bridges blown — hold position, clear nearby threats
      reasons.push('all bridges blown — waiting for victory');
      // Clear nearby threats
      const nearbyThreats = state.enemies.filter(
        (e) => this.distanceSq(e, tanya) <= 144,
      );
      if (nearbyThreats.length > 0) {
        commands.push({
          cmd: 'attack_move',
          ids: [tanya.id],
          cx: nearbyThreats[0].cx,
          cy: nearbyThreats[0].cy,
        });
        reasons.push(`Tanya clears ${nearbyThreats.length} nearby`);
      }
      return { commands, reason: reasons.join('; ') };
    }

    // Retreat if Tanya is hurt — she's the lose condition, be conservative
    if (tanyaHpFrac < 0.5) {
      commands.push({
        cmd: 'move',
        ids: [tanya.id],
        cx: SCG03EA_FALLBACK.cx,
        cy: SCG03EA_FALLBACK.cy,
      });
      reasons.push(`Tanya retreats (${Math.round(tanyaHpFrac * 100)}% HP)`);
      return { commands, reason: reasons.join('; ') };
    }

    // Bridges are template cells — Tanya destroys them by firing at them.
    // attack_move through the bridge position so her guns hit the template.
    // Track bridgeCount from state to know when bridges are actually destroyed.
    const bridgesLeft = state.bridgeCount ?? 99;
    if (bridgesLeft === 0) {
      this.scg03eaBridgeIndex = bridges.length; // all done
      reasons.push('all bridges destroyed (bridgeCount=0)!');
    } else {
      const atBridge = this.distanceSq(tanya, currentBridge) <= 36; // 6 cells
      if (atBridge) {
        // Near bridge — use sabotage (C4) on the bridge hut cell
        commands.push({
          cmd: 'sabotage', ids: [tanya.id],
          cx: currentBridge.cx, cy: currentBridge.cy,
        });
        reasons.push(`Tanya C4 bridge ${this.scg03eaBridgeIndex + 1} (bridges=${bridgesLeft})`);
        // If Tanya goes idle, the sabotage either succeeded or failed
        if (this.isIdle(tanya)) {
          this.scg03eaBridgeIndex++;
        }
      } else {
        // Not at bridge — clear path and advance
        const nearbyInf = state.enemies.filter(
          (e) => isInfantryByType(e.t) && this.distanceSq(e, tanya) <= 144,
        );
        const nearbyVehicles = state.enemies.filter(
          (e) => !isInfantryByType(e.t) && e.t !== 'LST' && this.distanceSq(e, tanya) <= 100,
        );

        if (nearbyVehicles.length > 0 && nearbyInf.length === 0) {
          const awayX = tanya.cx + (tanya.cx - nearbyVehicles[0].cx);
          const awayY = tanya.cy + (tanya.cy - nearbyVehicles[0].cy);
          commands.push({
            cmd: 'move', ids: [tanya.id],
            cx: Math.max(0, Math.min(127, awayX)),
            cy: Math.max(0, Math.min(127, awayY)),
          });
          reasons.push(`Tanya dodges ${nearbyVehicles[0].t}`);
        } else if (nearbyInf.length > 0) {
          const target = this.nearestEnemy(tanya, nearbyInf);
          commands.push({ cmd: 'attack', ids: [tanya.id], target: target.id });
          reasons.push(`Tanya kills ${target.t} (${nearbyInf.length} nearby)`);
        } else {
          commands.push({
            cmd: 'move', ids: [tanya.id],
            cx: currentBridge.cx, cy: currentBridge.cy,
          });
          reasons.push(`Tanya → bridge ${this.scg03eaBridgeIndex + 1}`);
        }
      }
    }

    return { commands, reason: reasons.join('; ') };
  }

  private playerOwnedUnits(state: RAGameState): RAEntity[] {
    if (!state.playerHouse) {
      return state.units;
    }
    const owned = state.units.filter((u) => u.house === state.playerHouse);
    return owned.length > 0 ? owned : state.units;
  }

  /**
   * Dispatch minelayers to lay defensive mines along approach-path waypoints.
   * Workflow per waypoint: move → arrive → deploy → advance to next waypoint.
   */
  private dispatchMinelayers(
    playerUnits: RAEntity[],
    baseRef: Point | undefined,
    commands: Array<Record<string, unknown>>,
    reasons: string[],
  ): void {
    const minelayers = playerUnits.filter(
      (u) => u.t === 'MNLY' && (u.ammo ?? 0) > 0,
    );
    for (const mnly of minelayers) {
      if (this.mineWaypointIndex >= MINE_WAYPOINTS.length) {
        // All waypoints visited — minelayer returns to guard near base
        if (baseRef && this.isIdle(mnly) && this.distanceSq(mnly, baseRef) > 36) {
          commands.push({
            cmd: 'move',
            ids: [mnly.id],
            cx: baseRef.cx,
            cy: baseRef.cy,
          });
          reasons.push('MNLY returns to base');
        }
        break;
      }

      const wp = MINE_WAYPOINTS[this.mineWaypointIndex];
      const atWaypoint = this.distanceSq(mnly, wp) <= 4; // within ~2 cells

      if (atWaypoint && mnly.m !== MISSION_UNLOAD) {
        // At waypoint and not currently deploying — lay mine
        commands.push({ cmd: 'deploy', ids: [mnly.id] });
        this.minesLaid++;
        this.mineDeployPending = false;
        this.mineWaypointIndex++;
        reasons.push(`MNLY deploys mine #${this.minesLaid} at (${wp.cx},${wp.cy})`);
      } else if (atWaypoint) {
        // Currently deploying — wait for completion
        reasons.push(`MNLY deploying at wp${this.mineWaypointIndex}`);
      } else if (!atWaypoint && this.isIdle(mnly)) {
        // Move to next waypoint
        commands.push({
          cmd: 'move',
          ids: [mnly.id],
          cx: wp.cx,
          cy: wp.cy,
        });
        this.mineDeployPending = true;
        reasons.push(`MNLY → mine wp${this.mineWaypointIndex} (${wp.cx},${wp.cy})`);
      } else if (!atWaypoint) {
        // En route — don't interrupt
        reasons.push(`MNLY en route to wp${this.mineWaypointIndex}`);
      }
    }
  }

  private isCombatUnit(unit: RAEntity): boolean {
    return !NON_COMBAT_TYPES.has(unit.t);
  }

  private isIdle(unit: RAEntity): boolean {
    return (
      unit.m === MISSION_SLEEP ||
      unit.m === MISSION_GUARD ||
      unit.m === MISSION_GUARD_AREA
    );
  }

  /**
   * Returns true if a unit should receive a new command.
   * Units busy executing a previous order are left alone to prevent
   * command stuttering. Exceptions: idle units, dead targets, stale commands.
   */
  private shouldRecommand(unit: RAEntity, enemies: RAEntity[]): boolean {
    if (this.isIdle(unit)) return true;
    const last = this.lastUnitTargets.get(unit.id);
    if (!last) return true;
    // Target dead?
    if (!enemies.some(e => e.id === last.targetId)) return true;
    // Stale timeout (>90 ticks since last command)
    if (this.currentTick - last.tick > 90) return true;
    return false;
  }

  private isScg01eaRescueTriggered(state: RAGameState): boolean {
    return Boolean(state.globals?.includes(1) || state.units.some((u) => u.t === 'EINSTEIN'));
  }

  private pickScg01eaEvacTransport(state: RAGameState): RAEntity | undefined {
    const transports = state.units.filter((u) => u.t === 'TRAN');
    if (transports.length === 0) {
      return undefined;
    }
    const einstein = state.units.find((u) => u.t === 'EINSTEIN');
    const reference = einstein ?? SCG01EA_EVAC_POINT;

    return transports
      .slice()
      .sort((a, b) => {
        const aRank = this.scg01eaTransportRank(a, state.playerHouse);
        const bRank = this.scg01eaTransportRank(b, state.playerHouse);
        if (aRank !== bRank) {
          return aRank - bRank;
        }
        const aDistance = this.distanceSq(a, reference);
        const bDistance = this.distanceSq(b, reference);
        if (aDistance !== bDistance) {
          return aDistance - bDistance;
        }
        const aEvacDistance = this.distanceSq(a, SCG01EA_EVAC_POINT);
        const bEvacDistance = this.distanceSq(b, SCG01EA_EVAC_POINT);
        if (aEvacDistance !== bEvacDistance) {
          return aEvacDistance - bEvacDistance;
        }
        return a.id - b.id;
      })[0];
  }

  private scg01eaTransportRank(transport: RAEntity, playerHouse?: string): number {
    if (transport.house === 'GoodGuy') {
      return 0;
    }
    if (playerHouse && transport.house === playerHouse) {
      return 1;
    }
    if (playerHouse && transport.house && transport.house !== playerHouse) {
      return 2;
    }
    return 3;
  }

  private pickScg02eaStructureTarget(state: RAGameState, from: Point, maxDistanceSq = Infinity): RAStructure | undefined {
    const enemyStructures = state.structures
      .filter((structure) => !structure.ally)
      .filter((structure) => this.distanceSq(structure, from) <= maxDistanceSq)
      .sort((a, b) => {
        const rankDiff = this.scg02eaStructureRank(a) - this.scg02eaStructureRank(b);
        if (rankDiff !== 0) {
          return rankDiff;
        }
        return this.distanceSq(a, from) - this.distanceSq(b, from);
      });
    return enemyStructures[0];
  }

  private pickScg02eaTrapBarrel(state: RAGameState): RAStructure | undefined {
    if (this.scg02eaAssaultIndex > 0) {
      return undefined;
    }

    return state.structures
      .filter((structure) => !structure.ally)
      .filter((structure) => structure.t === 'BARL' || structure.t === 'BRL3')
      .filter((structure) => this.distanceSq(structure, SCG02EA_BARREL_TRAP) <= 9)
      .sort((a, b) => this.distanceSq(a, SCG02EA_BARREL_TRAP) - this.distanceSq(b, SCG02EA_BARREL_TRAP))[0];
  }

  private scg02eaStructureRank(structure: RAStructure): number {
    switch (structure.t) {
      case 'WEAP':
      case 'FACT':
      case 'BARR':
        return 0;
      case 'PROC':
      case 'POWR':
      case 'KENN':
        return 1;
      case 'BARL':
      case 'BRL3':
        return 2;
      default:
        return 3;
    }
  }

  private pickScg02eaEnemyTarget(state: RAGameState, from: Point, maxDistanceSq = Infinity): RAEntity | undefined {
    return state.enemies
      .slice()
      .filter((enemy) => this.distanceSq(enemy, from) <= maxDistanceSq)
      .sort((a, b) => {
        const aRank = this.scg02eaEnemyRank(a);
        const bRank = this.scg02eaEnemyRank(b);
        if (aRank !== bRank) {
          return aRank - bRank;
        }
        return this.distanceSq(a, from) - this.distanceSq(b, from);
      })[0];
  }

  private scg02eaEnemyRank(enemy: RAEntity): number {
    switch (enemy.t) {
      case 'DOG':
        return 0;
      case 'E2':
        return 1;
      case 'HARV':
        return 3;
      default:
        return 2;
    }
  }

  private pickScg02eaRoutePoint(convoyLead: RAEntity): Point {
    for (const point of SCG02EA_CONVOY_ROUTE) {
      if (this.distanceSq(convoyLead, point) > 49) {
        return point;
      }
    }
    return SCG02EA_CONVOY_ROUTE[SCG02EA_CONVOY_ROUTE.length - 1];
  }

  private nearestEnemy(from: RAEntity, enemies: RAEntity[]): RAEntity {
    let best = enemies[0];
    let bestDist = Infinity;
    for (const e of enemies) {
      const d = this.distanceSq(from, e);
      if (d < bestDist) {
        bestDist = d;
        best = e;
      }
    }
    return best;
  }

  private findBase(structures: RAStructure[]): RAStructure {
    return (
      structures.find((s) => s.t === 'FACT') ||
      structures.find((s) => s.t === 'PROC') ||
      structures[0]
    );
  }

  private distanceSq(from: Point, to: Point): number {
    const dx = to.cx - from.cx;
    const dy = to.cy - from.cy;
    return dx * dx + dy * dy;
  }

  private dedupeCommands(commands: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    const seen = new Set<string>();
    return commands.filter((command) => {
      const key = JSON.stringify(command);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Map unit type name to UnitType enum index (for produce command).
   * Based on defines.h UnitType enum order.
   */
  private unitNameToTypeId(name: string): number {
    const UNIT_MAP: Record<string, number> = {
      '4TNK': 0,  // UNIT_HTANK (Mammoth)
      '3TNK': 1,  // UNIT_MTANK (Heavy)
      '2TNK': 2,  // UNIT_MTANK2 (Medium)
      '1TNK': 3,  // UNIT_LTANK (Light)
      'APC':  4,  // UNIT_APC
      'MNLY': 5,  // UNIT_MINELAYER
      'JEEP': 6,  // UNIT_JEEP
      'HARV': 7,  // UNIT_HARVESTER
      'ARTY': 8,  // UNIT_ARTY
      'MRJ':  9,  // UNIT_MRJ
      'MGG':  10, // UNIT_MGG
      'MCV':  11, // UNIT_MCV
      'V2RL': 12, // UNIT_V2_LAUNCHER
      'TRUK': 13, // UNIT_TRUCK
    };
    return UNIT_MAP[name] ?? -1;
  }

  /**
   * Map infantry type name to InfantryType enum index (for produce command).
   * Based on defines.h InfantryType enum order.
   */
  private infantryNameToTypeId(name: string): number {
    const INFANTRY_MAP: Record<string, number> = {
      'E1':   0,  // INFANTRY_E1 (mini-gun)
      'E2':   1,  // INFANTRY_E2 (grenade)
      'E3':   2,  // INFANTRY_E3 (rocket)
      'E4':   3,  // INFANTRY_E4 (flamethrower)
      'E6':   4,  // INFANTRY_RENOVATOR (engineer)
      'E7':   5,  // INFANTRY_TANYA
      'SPY':  6,  // INFANTRY_SPY
      'THF':  7,  // INFANTRY_THIEF
      'MEDI': 8,  // INFANTRY_MEDIC
      'GNRL': 9,  // INFANTRY_GENERAL
      'DOG':  10, // INFANTRY_DOG
    };
    return INFANTRY_MAP[name] ?? -1;
  }

  // ── Tactical micro-management ──────────────────────────────────────────────

  /**
   * Micro-manage combat units with weapon-type matching and focus fire.
   * Returns commands + reasons to append to the caller's decision.
   */
  private microManage(
    combatUnits: RAEntity[],
    enemies: RAEntity[],
    rallyPoint: Point,
  ): { commands: Array<Record<string, unknown>>; reasons: string[] } {
    const commands: Array<Record<string, unknown>> = [];
    const reasons: string[] = [];

    if (enemies.length === 0 || combatUnits.length === 0) {
      return { commands, reasons };
    }

    // 1. Pullback — units below RETREAT_HP_FRACTION get move to rally
    const retreating: RAEntity[] = [];
    const healthy: RAEntity[] = [];
    for (const u of combatUnits) {
      if (u.hp > 0 && u.hp / u.mhp < RETREAT_HP_FRACTION) {
        retreating.push(u);
      } else {
        healthy.push(u);
      }
    }

    if (retreating.length > 0) {
      commands.push({
        cmd: 'move',
        ids: retreating.map((u) => u.id),
        cx: rallyPoint.cx,
        cy: rallyPoint.cy,
      });
      reasons.push(`micro:retreat ${retreating.length}`);
    }

    if (healthy.length === 0) {
      return { commands, reasons };
    }

    // 2. Infantry scatter — move idle infantry away from enemy tanks
    const enemyTanks = enemies.filter((e) => e.t.includes('TNK'));
    const scatteredIds = new Set<number>();
    if (enemyTanks.length > 0) {
      const scatterCandidates = healthy.filter(
        (u) => isInfantryByType(u.t) && this.isIdle(u) &&
          enemyTanks.some((t) => this.distanceSq(u, t) <= 36), // 6 cells
      );
      for (const inf of scatterCandidates) {
        const nearestTank = this.nearestEnemy(inf, enemyTanks);
        let dx = inf.cx - nearestTank.cx;
        let dy = inf.cy - nearestTank.cy;
        // Fallback direction when infantry is on the same cell as tank
        if (dx === 0 && dy === 0) {
          dx = inf.id % 2 === 0 ? 1 : -1;
          dy = inf.id % 3 === 0 ? 1 : -1;
        }
        // Perpendicular scatter — alternate direction by unit ID
        const perpX = inf.id % 2 === 0 ? -dy : dy;
        const perpY = inf.id % 2 === 0 ? dx : -dx;
        const len = Math.sqrt(perpX * perpX + perpY * perpY) || 1;
        commands.push({
          cmd: 'move',
          ids: [inf.id],
          cx: Math.round(inf.cx + (perpX / len) * 4),
          cy: Math.round(inf.cy + (perpY / len) * 4),
        });
        scatteredIds.add(inf.id);
      }
      if (scatteredIds.size > 0) {
        reasons.push(`micro:scatter ${scatteredIds.size} inf`);
      }
    }

    // 3. Idle-aware filter — only re-command units that need new orders
    const commandable = healthy.filter(
      (u) => !scatteredIds.has(u.id) && this.shouldRecommand(u, enemies),
    );

    if (commandable.length === 0) {
      return { commands, reasons };
    }

    // 4. Classify commandable units by role
    const antiInfantry: RAEntity[] = [];
    const antiArmor: RAEntity[] = [];
    const general: RAEntity[] = [];

    for (const u of commandable) {
      const role = UNIT_ROLES[u.t] ?? 'general';
      if (role === 'anti_infantry') antiInfantry.push(u);
      else if (role === 'anti_armor') antiArmor.push(u);
      else if (role !== 'non_combat') general.push(u);
    }

    // 5. Classify enemies as infantry vs vehicles
    const infantryTargets = enemies.filter((e) => isInfantryByType(e.t));
    const vehicleTargets = enemies.filter((e) => !isInfantryByType(e.t));

    const fromPoint = this.centroid(commandable);

    // 6. Weapon-type matching + focus fire
    // Anti-infantry → priority infantry target (fallback to vehicles)
    if (antiInfantry.length > 0) {
      const targets = infantryTargets.length > 0 ? infantryTargets : vehicleTargets;
      if (targets.length > 0) {
        const target = this.pickPriorityTarget(targets, fromPoint);
        commands.push({
          cmd: 'attack',
          ids: antiInfantry.map((u) => u.id),
          target: target.id,
        });
        reasons.push(`micro:ai ${antiInfantry.length}→${target.t}#${target.id}`);
        for (const u of antiInfantry) {
          this.lastUnitTargets.set(u.id, { targetId: target.id, cx: target.cx, cy: target.cy, tick: this.currentTick });
        }
      }
    }

    // Anti-armor → priority vehicle target (fallback to infantry)
    if (antiArmor.length > 0) {
      const targets = vehicleTargets.length > 0 ? vehicleTargets : infantryTargets;
      if (targets.length > 0) {
        const target = this.pickPriorityTarget(targets, fromPoint);
        commands.push({
          cmd: 'attack',
          ids: antiArmor.map((u) => u.id),
          target: target.id,
        });
        reasons.push(`micro:aa ${antiArmor.length}→${target.t}#${target.id}`);
        for (const u of antiArmor) {
          this.lastUnitTargets.set(u.id, { targetId: target.id, cx: target.cx, cy: target.cy, tick: this.currentTick });
        }
      }
    }

    // General/unassigned → biggest remaining threat (prefer vehicles)
    if (general.length > 0) {
      const targets = vehicleTargets.length > 0 ? vehicleTargets : infantryTargets;
      if (targets.length > 0) {
        const target = this.pickPriorityTarget(targets, fromPoint);
        commands.push({
          cmd: 'attack',
          ids: general.map((u) => u.id),
          target: target.id,
        });
        reasons.push(`micro:gen ${general.length}→${target.t}#${target.id}`);
        for (const u of general) {
          this.lastUnitTargets.set(u.id, { targetId: target.id, cx: target.cx, cy: target.cy, tick: this.currentTick });
        }
      }
    }

    return { commands, reasons };
  }

  /**
   * Pick the highest-priority target from a list: damaged first (HP bucket),
   * then nearest to `fromPoint`.
   */
  private pickPriorityTarget(targets: RAEntity[], fromPoint: Point): RAEntity {
    return targets.slice().sort((a, b) => {
      // HP bucket: < 50% = 0 (highest priority), >= 50% = 1
      const aBucket = a.hp / a.mhp < 0.5 ? 0 : 1;
      const bBucket = b.hp / b.mhp < 0.5 ? 0 : 1;
      if (aBucket !== bBucket) return aBucket - bBucket;
      // Then nearest
      return this.distanceSq(a, fromPoint) - this.distanceSq(b, fromPoint);
    })[0];
  }

  /** Average cx/cy of a group of entities. */
  private centroid(entities: RAEntity[]): Point {
    if (entities.length === 0) return { cx: 0, cy: 0 };
    let sx = 0, sy = 0;
    for (const e of entities) { sx += e.cx; sy += e.cy; }
    return { cx: Math.round(sx / entities.length), cy: Math.round(sy / entities.length) };
  }

  private countTypes(entities: RAEntity[]): string {
    const counts: Record<string, number> = {};
    for (const e of entities) {
      counts[e.t] = (counts[e.t] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([t, n]) => `${n}${t}`)
      .join(',') || 'none';
  }
}
