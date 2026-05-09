/**
 * Harvester economy subsystem — ore seeking, harvesting, refinery return, and unloading.
 * Extracted from Game class (engine/index.ts) into pure + context-based functions.
 */

import {
  CELL_SIZE, MAP_CELLS, LEPTON_SIZE,
  type House, Mission, AnimState, UnitType, Dir, cellTargetToLepton,
} from './types';
import { Entity } from './entity';
import { type MapStructure, STRUCTURE_SIZE } from './scenario';
import { GameMap, MoveResult } from './map';
import { findPath } from './pathfinding';

// ---------------------------------------------------------------------------
// Context interface — minimal fields needed by harvester functions
// ---------------------------------------------------------------------------

export interface HarvesterContext {
  entities: Entity[];
  structures: MapStructure[];
  houseCredits: Map<House, number>;
  map: GameMap;

  // Callbacks
  isAllied(a: House, b: House): boolean;
  isPlayerControlled(e: Entity): boolean;
  playSound(name: string): void;
  addCredits(amount: number): void;
  /** C++ DriveClass::Assign_Destination immediately calls Start_Of_Move.
   *  Unit tests can omit this and use the pure path fallback below. */
  startDriveClassMove?: (entity: Entity) => void;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Check if a mission can start autonomous harvester work. */
function isIdleMission(mission: Mission): boolean {
  return mission === Mission.GUARD || mission === Mission.AREA_GUARD || mission === Mission.HARVEST;
}

/** Check if movement has handed the harvester back to an idle arrival mission. */
function isArrivalMission(mission: Mission): boolean {
  return mission === Mission.GUARD || mission === Mission.AREA_GUARD;
}

// C++ Mission_Harvest gates each ore bail on the HARV load animation:
// UnitTypeClass::Harvester_Load_List has 9 visible stages. StageClass then
// reaches stage 9, and the following Mission_Harvest dispatch calls Harvesting().
// The first pass is started by LOOKING at rate 2; successful bails restart with
// Rule.OreDumpRate=1 (unit.cpp:2798-2802, 2313-2314, 2840-2846).
const HARVESTER_LOAD_STAGE_COUNT = 9;

function setHarvesterLoadRate(entity: Entity, rate: number): void {
  entity.harvesterAnimStage = 0;
  entity.harvestTick = 0;
  entity.harvesterAnimRate = rate;
  entity.harvesterAnimTimer = rate;
}

function advanceHarvesterLoadStage(entity: Entity): void {
  if (entity.harvesterAnimRate <= 0) return;
  entity.harvesterAnimTimer--;
  if (entity.harvesterAnimTimer <= 0) {
    entity.harvesterAnimStage++;
    entity.harvestTick = entity.harvesterAnimStage;
    entity.harvesterAnimTimer = entity.harvesterAnimRate;
  }
}

function assignHarvesterDestination(ctx: HarvesterContext, entity: Entity, target: { cx: number; cy: number }): void {
  entity.moveTarget = cellTargetToLepton(target.cx, target.cy);
  if (ctx.startDriveClassMove) {
    ctx.startDriveClassMove(entity);
    return;
  }
  // C++ DriveClass::Assign_Destination only assigns NavCom and invalidates
  // Path[0]. The actual route comes from DriveClass::Start_Of_Move →
  // FootClass::Basic_Path, using Can_Enter_Cell and PathThreshhold. Do not use
  // the old harvester-only ignore-occupancy path shortcut here; it chooses a
  // different route around tree/ore terrain than C++ (SCG06EA HARV t277).
  entity.path = findPath(
    ctx.map,
    entity.cell,
    target,
    false,
    entity.isNavalUnit,
    entity.stats.speedClass,
    undefined,
    undefined,
    undefined,
    entity.stats.isInfantry,
    entity.pathThreshold as MoveResult,
  );
  entity.pathIndex = 0;
}

function nearestRefinery(ctx: HarvesterContext, entity: Entity): MapStructure | null {
  const ec = entity.cell;
  let bestProc: MapStructure | null = null;
  let bestDist = Infinity;
  for (const s of ctx.structures) {
    if (!s.alive || s.type !== 'PROC') continue;
    if (!ctx.isAllied(s.house, entity.house)) continue;
    const dx = s.cx - ec.cx;
    const dy = s.cy - ec.cy;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestProc = s;
    }
  }
  return bestProc;
}

function refineryDockCell(proc: MapStructure): { cx: number; cy: number } {
  const [, procH] = STRUCTURE_SIZE[proc.type] ?? [3, 2];
  // C++ building.cpp:306 Adjacent_Cell(Center, DIR_S). For RA refineries,
  // this is the south-center footprint cell used by the docking radio reply.
  return { cx: proc.cx + 1, cy: proc.cy + procH - 1 };
}

function isAdjacentToStructure(entity: Entity, structure: MapStructure): boolean {
  const ec = entity.cell;
  const [procW, procH] = STRUCTURE_SIZE[structure.type] ?? [3, 2];
  const nearX = Math.max(structure.cx, Math.min(ec.cx, structure.cx + procW - 1));
  const nearY = Math.max(structure.cy, Math.min(ec.cy, structure.cy + procH - 1));
  const edgeDist = Math.abs(nearX - ec.cx) + Math.abs(nearY - ec.cy);
  return edgeDist <= 1;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/** Find nearest ore for a harvester, with spread logic for AI harvesters.
 *  C++ parity: AI harvesters avoid ore cells that another friendly harvester is already targeting,
 *  preventing all AI harvesters from clustering on the same ore patch. */
export function findHarvesterOre(
  ctx: HarvesterContext, entity: Entity, cx: number, cy: number, maxRange: number,
): { cx: number; cy: number } | null {
  void entity;
  // C++ UnitClass::Goto_Tiberium has no AI-only anti-clustering heuristic.
  // It delegates to Tiberium_Check and returns the first legal cell in the
  // ring order implemented by GameMap.findNearestOre (unit.cpp:2206-2245).
  return ctx.map.findNearestOre(cx, cy, maxRange);
}

/** Harvester AI — seek ore, harvest, return to refinery, unload */
export function updateHarvester(ctx: HarvesterContext, entity: Entity, missionTimerFired = true): void {
  switch (entity.harvesterState) {
    case 'idle': {
      // Only start auto-harvest from idle mission (GUARD/AREA_GUARD), not during manual MOVE
      if (!isIdleMission(entity.mission)) break;
      const ec = entity.cell;

      // C++ unit.cpp:2785-2788 LOOKING: full harvesters skip directly to
      // FINDHOME and return 1 before scanning for ore.
      if (entity.oreLoad >= Entity.BAIL_COUNT) {
        entity.harvesterState = 'returning';
        break;
      }

      // C++ unit.cpp:2794-2796: if (Target_Legal(ArchiveTarget)) → head to last known ore first
      if (entity.archiveTarget) {
        const at = entity.archiveTarget;
        entity.archiveTarget = null; // C++ clears ArchiveTarget after using it
        entity.harvesterState = 'seeking';
        // C++ UnitClass::Mission_Harvest keeps Mission=HARVEST while
        // Assign_Destination(NavCom) makes DriveClass::AI move the unit.
        entity.mission = Mission.HARVEST;
        assignHarvesterDestination(ctx, entity, at);
        break;
      }

      // Find nearest ore cell — AI harvesters spread to avoid clustering
      // C++ unit.cpp:2799: Goto_Tiberium(Rule.TiberiumLongScan / CELL_LEPTON_W)
      // rules.ini OreFarScan=48
      const oreCell = findHarvesterOre(ctx, entity, ec.cx, ec.cy, 48);
      if (oreCell) {
        entity.mission = Mission.HARVEST;
        if (oreCell.cx === ec.cx && oreCell.cy === ec.cy) {
          // C++ UnitClass::Goto_Tiberium returns true when already on an ore
          // cell; Mission_Harvest immediately enters HARVESTING and starts the
          // initial rate-2 load animation instead of assigning NavCom.
          entity.harvesterState = 'harvesting';
          entity.animState = AnimState.IDLE;
          entity.isHarvesterMining = true;
          setHarvesterLoadRate(entity, 2);
        } else {
          entity.harvesterState = 'seeking';
          // C++ Goto_Tiberium assigns NavCom but does not switch to MISSION_MOVE.
          assignHarvesterDestination(ctx, entity, oreCell);
        }
      }
      break;
    }
    case 'seeking': {
      // Check if we've arrived at ore.
      //
      // C++ UnitClass::Harvesting (unit.cpp:2268-2271) keeps waiting while
      // NavCom is legal: `if (Target_Legal(NavCom)) return(true);`.
      // A harvester can enter the ore cell before it reaches the cell center;
      // do not start the scoop animation until DriveClass has cleared NavCom.
      const ec = entity.cell;
      const ovl = ctx.map.overlay[ec.cy * MAP_CELLS + ec.cx];
      if (GameMap.isOreOverlayId(ovl) && !entity.moveTarget && !entity.isDriving) {
        entity.harvesterState = 'harvesting';
        entity.harvestTick = 0;
        entity.harvesterAnimRate = 0;
        entity.harvesterAnimTimer = 0;
        // C++ Status=HARVESTING remains under MISSION_HARVEST. Switching to
        // GUARD here makes TS consume Mission_Guard jitter RNG that C++ never
        // fires while the harvester is scooping ore.
        entity.mission = Mission.HARVEST;
        entity.animState = AnimState.IDLE;
        // C++ unit.cpp:2800 — IsHarvesting = true when scoop anim begins
        entity.isHarvesterMining = true;
        entity.harvesterAnimStage = 0;
      } else if (!entity.moveTarget && !entity.isDriving && entity.path.length === 0) {
        // NavCom cleared but no ore here — re-seek. Do not treat
        // Mission.HARVEST itself as arrival while NavCom is still legal; C++
        // keeps MISSION_HARVEST active throughout the drive to the ore cell.
        entity.harvesterState = 'idle';
      } else if (entity.mission === Mission.MOVE && entity.path.length === 0 && entity.pathIndex >= 0) {
        // Path exhausted or failed but still in MOVE — stuck seeking.
        // Use harvestTick as a timeout counter (30 ticks = 2s grace).
        entity.harvestTick++;
        if (entity.harvestTick > 30) {
          entity.harvesterState = entity.oreLoad > 0 ? 'returning' : 'idle';
          entity.mission = Mission.GUARD;
          entity.harvestTick = 0;
        }
      }
      break;
    }
    case 'harvesting': {
      entity.isHarvesterMining = true;

      // C++ MissionClass::AI only runs Mission_Harvest when the mission CDTimer
      // fires. While the timer is counting down after arrival, StageClass has not
      // been started yet, so the scoop animation must not advance. SCG04EA HARV:
      // C++ reaches the ore center at tick 81, mt counts down through tick 92,
      // LOOKING starts Set_Rate(2) at tick 93, then the first bail lifts at 112.
      if (!missionTimerFired) break;

      let rateStartedThisTick = false;
      if (entity.harvesterAnimRate <= 0) {
        // LOOKING -> HARVESTING starts with Set_Rate(2). Subsequent short-scan
        // cells restart from the HARVESTING branch's Fetch_Rate()==0 path, which
        // uses Rule.OreDumpRate (1). oreLoad==0 identifies a fresh empty harvester
        // beginning a patch; once it has a bail, subsequent passes use rate 1.
        setHarvesterLoadRate(entity, entity.oreLoad === 0 ? 2 : 1);
        rateStartedThisTick = true;
      }

      // Wait for the StageClass load animation to complete before trying to lift
      // the next bail. Graphic_Logic advances after Mission_Harvest, so a newly
      // set rate does not consume a timer tick until the next object AI tick.
      if (entity.harvesterAnimStage < HARVESTER_LOAD_STAGE_COUNT) {
        if (!rateStartedThisTick) advanceHarvesterLoadStage(entity);
        break;
      }

      // C++ UnitClass::Harvesting starts with:
      //   if (Target_Legal(NavCom)) return(true);
      //
      // Important: Mission_Harvest still runs its Fetch_Rate()==0 and
      // Fetch_Stage()<Harvester_Load_List gates before calling Harvesting().
      // So the load StageClass keeps advancing while a short-scan NavCom is
      // legal and the harvester is driving to the next ore cell. Once NavCom
      // clears at arrival, the already-advanced stage can immediately lift the
      // next bail. Do not reset or freeze the load animation while moving.
      if (entity.moveTarget || entity.isDriving) {
        if (!rateStartedThisTick) advanceHarvesterLoadStage(entity);
        break;
      }

      {
        const ec = entity.cell;
        const idx = ec.cy * MAP_CELLS + ec.cx;
        const wasOreOverlay = GameMap.isOreOverlayId(ctx.map.overlay[idx]);

        // C++ UnitClass::Harvesting checks capacity only after the load stage
        // completes. A harvester that just lifted its final bail stays in
        // HARVESTING for one more load animation cycle; the next Harvesting()
        // call fails because Tiberium_Load()==1, then Mission_Harvest switches
        // to FINDHOME. Do not flip to returning immediately on the tick bail 28
        // is lifted, or Mission_Harvest falls through to its jitter path early.
        const canLiftBail = entity.oreLoad < Entity.BAIL_COUNT && wasOreOverlay;
        if (canLiftBail) {
          const bailCredits = ctx.map.depleteOre(ec.cx, ec.cy);
          if (bailCredits > 0) {
            // EC3: bail-based capacity — track bail count, not credit amount
            entity.oreLoad += 1;
            entity.oreCreditValue += bailCredits;
            // EC4: gem bonus bails — C++ unit.cpp:2306-2308, up to 3 extra bails per gem harvest
            // C++ guards each bonus bail with (BailCount > Tiberium) to prevent exceeding capacity
            if (bailCredits >= 50) {
              const gemValue = 50; // rules.ini GemValue
              for (let bonus = 0; bonus < 3; bonus++) {
                if (entity.oreLoad >= Entity.BAIL_COUNT) break;
                entity.oreLoad += 1;
                entity.oreCreditValue += gemValue;
              }
            }
          }

          // Harvesting() returns true whenever the current land type was Tiberium,
          // even if Reduce_Tiberium(1) only removed a zero-density overlay and
          // returned 0 credits.
          setHarvesterLoadRate(entity, 1);
        } else {
          // Harvesting() failure path: full or not on ore. Mission_Harvest then
          // either goes home if full or performs the short ore scan.
          setHarvesterLoadRate(entity, 0);
          if (entity.oreLoad >= Entity.BAIL_COUNT) {
            // C++ unit.cpp:2851: ArchiveTarget = ::As_Target(Coord_Cell(Coord));
            entity.archiveTarget = { cx: ec.cx, cy: ec.cy };
            entity.isHarvesterMining = false;
            entity.harvesterState = 'returning';
          } else {
            // No more ore at this cell — look for adjacent ore
            const newOre = ctx.map.findNearestOre(ec.cx, ec.cy, 6);
            if (newOre) {
              entity.isHarvesterMining = false;
              // C++ Mission_Harvest keeps Status=HARVESTING when short-scan
              // Goto_Tiberium finds another ore cell; while NavCom is legal,
              // Harvesting() returns true and Mission_Harvest returns 1.
              entity.harvesterState = 'harvesting';
              entity.harvestTick = 0;
              entity.harvesterAnimRate = 0;
              entity.harvesterAnimTimer = 0;
              entity.isHarvesterMining = true;
              entity.mission = Mission.HARVEST;
              assignHarvesterDestination(ctx, entity, newOre);
            } else {
              // No more ore nearby — return with whatever we have
              entity.isHarvesterMining = false;
              if (entity.oreLoad > 0) {
                entity.archiveTarget = { cx: ec.cx, cy: ec.cy };
                entity.harvesterState = 'returning';
              } else {
                entity.harvesterState = 'idle';
              }
            }
          }
        }
      }
      break;
    }
    case 'returning': {
      // C++ UnitClass::Mission_Harvest FINDHOME (unit.cpp:2868-2894).
      // A successful refinery radio hello does not assign NavCom yet; it only
      // advances to HEADINGHOME and falls through to Normal_Delay+Random_Pick.
      // The later HEADINGHOME dispatch switches to MISSION_ENTER, whose
      // FootClass::Mission_Enter docking radio reply provides the destination.
      if (entity.mission === Mission.HARVEST) {
        if (!missionTimerFired) break;
        if (nearestRefinery(ctx, entity)) {
          entity.harvesterState = 'headinghome';
        } else {
          entity.harvesterState = 'idle';
        }
        break;
      }

      // Pathfinding timeout: if stuck in MOVE with empty path, fall back to idle after 45 ticks (3s)
      if (entity.mission === Mission.MOVE && entity.path.length === 0 && entity.pathIndex >= 0) {
        entity.harvestTick++;
        if (entity.harvestTick > 45) {
          entity.harvesterState = 'idle';
          entity.mission = Mission.GUARD;
          entity.harvestTick = 0;
        }
        break;
      }
      // When move completes (mission returns to GUARD/AREA_GUARD), transition to unloading or re-seek
      if (!isArrivalMission(entity.mission)) break; // still moving, wait
      // Check if we're near a refinery
      const bestProc = nearestRefinery(ctx, entity);
      if (!bestProc) {
        // No refinery — idle with ore
        entity.harvesterState = 'idle';
        break;
      }
      // Check if we're adjacent to refinery footprint (distance to nearest edge ≤ 1)
      if (isAdjacentToStructure(entity, bestProc)) {
        // Arrived at refinery — start unloading
        entity.harvesterState = 'unloading';
        entity.mission = Mission.UNLOAD;
        entity.missionTimer = 0;
        entity.harvestTick = 0;
        entity.harvesterAnimStage = 0;
        entity.isHarvesterDumping = false; // set true once rotated to DIR_W
        // C++ unit.cpp:2365-2369 — rotate to DIR_W before dump animation begins
        entity.desiredFacing = Dir.W;
      } else {
        // Not there yet — move to dock cell (C++ building.cpp:306 Adjacent_Cell(Center, DIR_S)).
        // PROC is 3x3 at (cx..cx+2, cy..cy+2). Center cell = (cx+1, cy+1).
        // DIR_S of center = (cx+1, cy+2) — the south-center cell of the footprint.
        // Harvester drives into this cell from below to dock.
        const target = refineryDockCell(bestProc);
        entity.mission = Mission.MOVE;
        assignHarvesterDestination(ctx, entity, target);
        entity.harvestTick = 0;
      }
      break;
    }
    case 'headinghome': {
      const bestProc = nearestRefinery(ctx, entity);
      if (!bestProc) {
        entity.harvesterState = 'idle';
        break;
      }

      // C++ UnitClass::Mission_Harvest HEADINGHOME assigns MISSION_ENTER and
      // returns 1. Mission_Enter runs on the following object-AI tick.
      if (entity.mission === Mission.HARVEST) {
        if (!missionTimerFired) break;
        entity.mission = Mission.ENTER;
        break;
      }

      if (entity.mission !== Mission.ENTER && !isArrivalMission(entity.mission)) {
        break;
      }

      if (entity.mission === Mission.ENTER && !missionTimerFired) {
        break;
      }

      if (isAdjacentToStructure(entity, bestProc) && !entity.moveTarget && !entity.isDriving) {
        // C++ FootClass::Mission_Enter -> BuildingClass::RADIO_DOCKING ->
        // UnitClass::RADIO_BACKUP_NOW. The first dock maintenance dispatch
        // only starts a west-facing Do_Turn() if the harvester is not already
        // facing DIR_W; it stays in MISSION_ENTER and keeps the Mission_Enter
        // delay. The refinery queues UNLOAD only on a later dispatch after the
        // harvester is already facing west (RADIO_IM_IN).
        const west256 = (Dir.W * 32) & 0xff;
        const body256 = entity.bodyFacing256 >= 0
          ? (entity.bodyFacing256 & 0xff)
          : ((entity.facing * 32) & 0xff);
        if (body256 !== west256 || entity.rotTickedThisFrame) {
          entity.desiredFacing = Dir.W;
          entity.desiredFacing256 = west256;
          break;
        }

        entity.harvesterState = 'unloading';
        entity.mission = Mission.UNLOAD;
        entity.missionTimer = 0;
        entity.harvestTick = 0;
        entity.harvesterAnimStage = 0;
        entity.isHarvesterDumping = false;
        entity.desiredFacing = Dir.W;
        break;
      }

      if (!entity.moveTarget && !entity.isDriving) {
        assignHarvesterDestination(ctx, entity, refineryDockCell(bestProc));
      }
      break;
    }
    case 'unloading': {
      // C++ unit.cpp:2348-2390 Mission_Unload for UNIT_HARVESTER:
      //   1. If PrimaryFacing != DIR_W, call Do_Turn(DIR_W) and return 5 (5-tick rotate delay)
      //   2. Once facing W, IsDumping=true, Set_Stage(0), Set_Rate(OreDumpRate=1)
      //   3. Play 22-stage Harvester_Dump_List animation (1 stage per tick)
      //   4. At stage 22: lump-sum deposit House->Harvested(Credit_Load()), Tiberium=0
      //
      // C++ unit.cpp:2383 — lump-sum credit deposit at END of dump animation, NOT drip-feed.
      // (The refinery's Mission_Harvest drip-feeds via Offload_Tiberium_Bail, but that is
      //  #ifdef TOFIX'd out and returns 0 credits — so lump-sum is the real credit source.)

      // Phase 1: rotate to DIR_W — wait until facing matches.
      // tickRotation() is called here because harvesters in GUARD mission without a target
      // don't rotate via the missionAI scanning loop. C++ Mission_Unload drives rotation
      // directly via Do_Turn(DIR_W) in unit.cpp:2367.
      if (entity.facing !== Dir.W) {
        entity.desiredFacing = Dir.W;
        entity.isHarvesterDumping = false;
        entity.harvesterAnimRate = 0;
        entity.harvesterAnimTimer = 0;
        entity.tickRotation();
        break;
      }

      // Phase 2: play 22-stage dump animation.
      entity.isHarvesterDumping = true;
      entity.harvestTick++;
      entity.harvesterAnimStage = entity.harvestTick - 1; // 0..21

      // Per-tick chime during dump (first 22 ticks)
      if (entity.harvestTick % 5 === 0 && entity.harvestTick <= 22 && ctx.isPlayerControlled(entity)) {
        ctx.playSound('heal');
      }

      // Phase 3: when the dump animation has reached its terminal stage AND
      // Mission_Unload dispatches, lump-sum deposit + state reset.
      //
      // C++ StageClass advances independently, but unit.cpp:2377 only checks
      // Fetch_Stage() from inside UnitClass::Mission_Unload. If the stage
      // completes between mission timer fires, the harvester keeps waiting until
      // the next Mission_Unload call.
      if (missionTimerFired && entity.harvestTick >= 22) {
        const credits = entity.oreCreditValue;
        if (credits > 0) {
          if (ctx.isPlayerControlled(entity)) {
            ctx.addCredits(credits);
          } else {
            const cur = ctx.houseCredits.get(entity.house) ?? 0;
            ctx.houseCredits.set(entity.house, cur + credits);
          }
        }
        entity.oreLoad = 0;
        entity.oreCreditValue = 0;
        entity.isHarvesterDumping = false;
        entity.harvesterAnimStage = 0;
        entity.harvesterState = 'idle';
        entity.harvestTick = 0;
        // C++ unit.cpp:2386-2389 — after the dump completes, the harvester
        // transmits RADIO_OVER_OUT and Assign_Mission(MISSION_HARVEST). The
        // Mission_Unload handler still consumed its normal delay+jitter before
        // this post-dispatch bookkeeping, so reset the newly assigned mission's
        // timer for the next object AI tick.
        entity.mission = Mission.HARVEST;
        entity.missionTimer = 0;
      }
      break;
    }
  }
}
