/**
 * OracleStrategy: rule-based strategy for Red Alert missions driven by the
 * original WASM agent harness.
 *
 * The original harness currently supports unit motion and targeting, but not
 * sidebar production, so this strategy focuses on tactical control only.
 */

import type { RAGameState, RAEntity, RAStructure, RABuildable } from './WasmAdapter.js';

export interface OracleDecision {
  commands: Array<Record<string, unknown>>;
  reason: string;
}

export type OracleResult = 'playing' | 'victory' | 'defeat' | 'timeout';

type Point = { cx: number; cy: number };

// Mission enum values from C++ (MISSION_*)
const MISSION_SLEEP = 0;
const MISSION_GUARD = 5;
const MISSION_GUARD_AREA = 18;

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
  names: string[];     // acceptable type names (e.g. TENT or BARR)
  type_ids: number[];  // matching StructType enum values
}

const BUILD_ORDER: BuildOrderEntry[] = [
  { names: ['POWR'],         type_ids: [17] },   // STRUCT_POWER
  { names: ['PROC'],         type_ids: [12] },   // STRUCT_REFINERY — income first
  { names: ['TENT', 'BARR'], type_ids: [22, 21] }, // STRUCT_TENT or STRUCT_BARRACKS
  { names: ['WEAP'],         type_ids: [2] },    // STRUCT_WEAP
];

// Tank preference order (best to worst)
const TANK_PREFERENCE = ['3TNK', '2TNK', '1TNK', '4TNK'];

// Infantry production preference
const INFANTRY_PREFERENCE = ['E3', 'E1', 'E2', 'E4'];

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

  constructor(scenario = '') {
    this.scenario = scenario.replace(/\.[^.]+$/, '').toUpperCase();
  }

  decide(state: RAGameState): OracleDecision {
    this.peakUnits = Math.max(this.peakUnits, state.units.length);
    this.peakStructures = Math.max(this.peakStructures, state.structures.length);

    if (state.enemies.length > 0) {
      this.ticksSinceLastEnemy = 0;
      this.lastEnemyCount = state.enemies.length;
    } else {
      this.ticksSinceLastEnemy += 30;
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

    if (this.scenario === 'SCG01EA') {
      return this.decideScg01ea(state);
    }
    if (this.scenario === 'SCG02EA') {
      return this.decideScg02ea(state);
    }

    return this.decideGeneric(state);
  }

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

    if (this.scenario === 'SCG01EA' && this.sawTanya && state.tick > 240) {
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
      `power=${state.power.produced}/${state.power.consumed}${prodStr}${globals}${missionTimer} ` +
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
      // Only send deploy if MCV is idle — don't re-send if already deploying
      if (this.isIdle(mcv)) {
        commands.push({ cmd: 'deploy', ids: [mcv.id] });
        reasons.push('deploy MCV');
      } else {
        reasons.push('MCV deploying...');
      }
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
      const placeCx = conYard.cx + PLACEMENT_OFFSETS[this.placementAttempts % PLACEMENT_OFFSETS.length].cx;
      const placeCy = conYard.cy + PLACEMENT_OFFSETS[this.placementAttempts % PLACEMENT_OFFSETS.length].cy;
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
      this.placementAttempts = 0; // reset placement cycle for next building

      // Check if we need more power first
      if (state.power.consumed > state.power.produced && buildable.structures.includes('POWR')) {
        commands.push({
          cmd: 'produce',
          rtti: RTTI_BUILDINGTYPE,
          type_id: 17, // STRUCT_POWER
        });
        reasons.push('produce POWR (power deficit)');
      } else {
        // Find next building in build order we don't have yet
        let ordered = false;
        for (let i = this.baseBuildIndex; i < BUILD_ORDER.length; i++) {
          const entry = BUILD_ORDER[i];
          // Check if we already have any of the alternatives
          const alreadyHave = entry.names.some((n) =>
            alliedStructures.some((s) => s.t === n),
          );
          if (alreadyHave) {
            if (i === this.baseBuildIndex) this.baseBuildIndex = i + 1;
            continue;
          }
          // Find the first buildable alternative
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
            // Can't build any alternative yet — prerequisites not met, skip for now
            break;
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

    // Produce tanks from War Factory
    const unitProduction = state.production.find(
      (p) => p.rtti === RTTI_UNITTYPE,
    );
    if (hasWarFactory && !unitProduction && buildable && state.credits > 500) {
      const tank = TANK_PREFERENCE.find((t) => buildable.units.includes(t));
      if (tank) {
        // Look up the type_id from the unit list
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
    // Place/exit completed units
    if (unitProduction?.done) {
      commands.push({
        cmd: 'place',
        rtti: RTTI_UNITTYPE,
      });
      reasons.push(`exit ${unitProduction.t}`);
    }

    // Produce infantry from Barracks
    const infantryProduction = state.production.find(
      (p) => p.rtti === RTTI_INFANTRYTYPE,
    );
    if (hasBarracks && !infantryProduction && buildable && state.credits > 200) {
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

    // --- Phase 4: COMBAT ---
    const combatUnits = playerUnits.filter(
      (u) => this.isCombatUnit(u) && !BASE_NON_COMBAT_TYPES.has(u.t),
    );

    // Estimate combat strength (tanks=3, infantry=1)
    const friendlyStrength = combatUnits.reduce(
      (s, u) => s + (u.t.includes('TNK') ? 3 : 1) * (u.hp / u.mhp), 0,
    );
    const enemyCombatUnits = state.enemies.filter(
      (e) => e.t.includes('TNK') || e.t.includes('E') || e.t.includes('V2') || e.t.includes('ARTY'),
    );
    const enemyStrength = enemyCombatUnits.reduce(
      (s, e) => s + (e.t.includes('TNK') ? 3 : 1) * (e.hp / e.mhp), 0,
    );

    // Base threats — enemies within 15 cells of ConYard
    const baseThreats = state.enemies.filter(
      (e) => this.distanceSq(e, conYard) <= 225,
    );

    // ALL combat units defend base when threatened
    if (baseThreats.length > 0 && combatUnits.length > 0) {
      const threat = this.nearestEnemy(conYard as unknown as RAEntity, baseThreats);
      commands.push({
        cmd: 'attack_move',
        ids: combatUnits.map((u) => u.id),
        cx: threat.cx,
        cy: threat.cy,
      });
      reasons.push(`defend base (${baseThreats.length} threats)`);
    } else if (combatUnits.length > 0) {
      const injured = combatUnits.filter(
        (u) => u.hp / u.mhp < RETREAT_HP_FRACTION && u.hp > 0,
      );
      const healthy = combatUnits.filter(
        (u) => u.hp / u.mhp >= RETREAT_HP_FRACTION,
      );

      // Retreat injured to base
      if (injured.length > 0) {
        commands.push({
          cmd: 'move',
          ids: injured.map((u) => u.id),
          cx: conYard.cx,
          cy: conYard.cy,
        });
        reasons.push(`retreat ${injured.length} injured`);
      }

      // Only attack if we have clear force advantage (1.5x enemy strength)
      // or no visible enemies to worry about
      if (healthy.length > 0 && state.enemies.length > 0 && friendlyStrength > enemyStrength * 1.5) {
        const target = this.nearestEnemy(healthy[0], state.enemies);
        commands.push({
          cmd: 'attack_move',
          ids: healthy.map((u) => u.id),
          cx: target.cx,
          cy: target.cy,
        });
        reasons.push(`attack ${healthy.length} (str ${friendlyStrength.toFixed(0)} vs ${enemyStrength.toFixed(0)}) → (${target.cx},${target.cy})`);
      } else if (healthy.length > 0 && state.enemies.length > 0) {
        // Outnumbered — hold position near base, send one scout
        const idleNearBase = healthy.filter(
          (u) => this.isIdle(u) && this.distanceSq(u, conYard) > 100,
        );
        if (idleNearBase.length > 0) {
          commands.push({
            cmd: 'move',
            ids: idleNearBase.map((u) => u.id),
            cx: conYard.cx + 3,
            cy: conYard.cy + 3,
          });
          reasons.push(`rally ${idleNearBase.length} to base (outgunned ${friendlyStrength.toFixed(0)} vs ${enemyStrength.toFixed(0)})`);
        }
        // Send cheapest unit to scout if we haven't seen enemies near base recently
        if (baseThreats.length === 0 && this.ticksSinceLastEnemy > 150) {
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
      } else if (healthy.length > 0 && state.enemies.length === 0) {
        // No enemies visible — send a scout to find them
        if (this.ticksSinceLastEnemy > 90 || healthy.some((u) => this.isIdle(u))) {
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
        // Strong enough — attack
        const target = this.nearestEnemy(healthy[0], state.enemies);
        commands.push({
          cmd: 'attack_move',
          ids: healthy.map((u) => u.id),
          cx: target.cx,
          cy: target.cy,
        });
        reasons.push(`attack ${healthy.length} (${friendlyStr.toFixed(0)} vs ${enemyStr.toFixed(0)}) → (${target.cx},${target.cy})`);
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

  private playerOwnedUnits(state: RAGameState): RAEntity[] {
    if (!state.playerHouse) {
      return state.units;
    }
    const owned = state.units.filter((u) => u.house === state.playerHouse);
    return owned.length > 0 ? owned : state.units;
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
