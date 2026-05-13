/**
 * Find_Docking_Bay — port of C++ TechnoClass::Find_Docking_Bay (techno.cpp:5809-5853).
 *
 * Generic search for the best docking bay (helipad / airstrip / refinery / repair
 * facility) for a seeker. Used by aircraft seeking helipads/airstrips/repair bays
 * and by harvesters/repair-units seeking refineries.
 *
 * The C++ algorithm:
 *   1. Fast-path: if `House->Get_Quantity(b) == 0`, return NULL.
 *   2. Loop all Buildings:
 *        - ownership: friendly ? building->House->Is_Ally(this) : building->House == House
 *        - !building->IsInLimbo
 *        - *building == b               (correct type)
 *        - aircraft bypass | same MZone (terrain reachability via Map[].Zones[MZone])
 *        - Receive_Message(RADIO_CAN_LOAD, building) == RADIO_ROGER (building accepts)
 *   3. Track best by Distance(building); IsLeader candidates override distance.
 *
 * IsLeader: TechnoClass::IsLeader (techno.h:89) is the "primary factory" flag toggled
 * by BuildingClass::Toggle_Primary (building.cpp:2918-2950). It is mutually exclusive
 * among same-category buildings, so usually at most one IsLeader exists per category.
 */

import { type MapStructure, structureCenterLeptons } from './scenario';
import { House } from './types';

/** Minimum seeker description needed for Find_Docking_Bay. */
export interface DockingSeeker {
  /** Owning house — drives friendly/ownership filtering. */
  house: House;
  /** Seeker cell — origin for the MZone check and distance fallback. */
  cell: { cx: number; cy: number };
  /** Seeker integer lepton coordinates — drives Distance() ranking. When omitted
   *  the helper falls back to cell-center leptons (cx*256+128, cy*256+128). */
  leptonX?: number;
  leptonY?: number;
  /** True for AIRCRAFT — bypasses the MZone (ground reachability) check.
   *  C++ techno.cpp:5837: `What_Am_I() == RTTI_AIRCRAFT || same-MZone`. */
  isAirUnit?: boolean;
  /** Seeker type for default RADIO_CAN_LOAD predicate (e.g., 'HARV' for harvester,
   *  'AIRCRAFT_FIXED', 'AIRCRAFT_HELI', 'UNIT'). Matches the per-building-type rules
   *  in BuildingClass::Receive_Message RADIO_CAN_LOAD (building.cpp:171-208). */
  kind?: 'aircraft-fixed' | 'aircraft-heli' | 'unit-harvester' | 'unit' | 'other';
}

export interface DockingContext {
  structures: MapStructure[];
  isAllied: (a: House, b: House) => boolean;
}

export interface FindDockingBayOptions {
  /** Custom availability predicate. Overrides the default RADIO_CAN_LOAD check.
   *  Returning false skips the building. */
  canDock?: (s: MapStructure) => boolean;
  /** Pre-computed reachable-zone mask for the seeker (Uint8Array indexed cy*MAP_CELLS+cx).
   *  Required for ground units to enforce the C++ MZone equality check
   *  (Map[building->Center_Coord()].Zones[MZone] == Map[Center_Coord()].Zones[MZone]).
   *  Omitted/null disables the check — caller is responsible for supplying this for
   *  ground seekers when zone parity matters. Aircraft seekers always skip MZone. */
  reachableZone?: Uint8Array | null;
  /** Cells-per-row stride matching the map grid (default 128, MAP_CELLS). */
  mapCellsStride?: number;
}

/** C++ coord.cpp:124-136 Distance() — octagonal-approximation lepton distance.
 *  max(|dx|,|dy|) + (min(|dx|,|dy|) >> 1). The arguments here are in cells * 256
 *  (leptons) — building & seeker centers are converted by the caller via the
 *  appropriate helpers; this duplicate is local to avoid circular imports. */
function leptonDistanceLocal(ax: number, ay: number, bx: number, by: number): number {
  let dy = ay - by; if (dy < 0) dy = -dy;
  let dx = ax - bx; if (dx < 0) dx = -dx;
  if (dy > dx) return (dy + ((dx >>> 0) >> 1)) | 0;
  return (dx + ((dy >>> 0) >> 1)) | 0;
}

/** Cell-center leptons for a 1-cell-resolution coord (seeker position). */
function cellCenterLeptons(cx: number, cy: number): { lx: number; ly: number } {
  return { lx: cx * 256 + 128, ly: cy * 256 + 128 };
}

/** Default RADIO_CAN_LOAD predicate matching BuildingClass::Receive_Message
 *  (building.cpp:171-208). Returns true if the building would respond ROGER. */
function defaultCanDock(seeker: DockingSeeker, s: MapStructure): boolean {
  // Under construction / deconstruction → NEGATIVE (building.cpp:174).
  if (s.buildProgress !== undefined && s.buildProgress < 1) return false;
  if (s.sellProgress !== undefined) return false;
  switch (s.type) {
    case 'AFLD':
      // Only fixed-wing aircraft (building.cpp:176-180). Also requires the pad
      // to be free of a docked aircraft.
      if (seeker.kind !== 'aircraft-fixed') return false;
      if (s.dockedAircraft !== undefined && s.dockedAircraft > 0) return false;
      return true;
    case 'HPAD':
      // Only helicopters (building.cpp:182-186). Pad must be free.
      if (seeker.kind !== 'aircraft-heli') return false;
      if (s.dockedAircraft !== undefined && s.dockedAircraft > 0) return false;
      return true;
    case 'FIX':
      // Units or aircraft only (building.cpp:188-194). Must not be currently
      // occupied (C++ checks Transmit_Message(RADIO_ON_DEPOT, from) — a unit
      // sitting on the pad). TS approximates via dockedAircraft and the building's
      // REPAIR mission state.
      if (seeker.kind !== 'unit' && seeker.kind !== 'unit-harvester'
          && seeker.kind !== 'aircraft-fixed' && seeker.kind !== 'aircraft-heli') return false;
      if (s.dockedAircraft !== undefined && s.dockedAircraft > 0) return false;
      return true;
    case 'PROC':
      // Only harvesters; ScenarioInit OR !Is_Something_Attached (building.cpp:196-203).
      // TS does not currently track an attached harvester id on the structure, so
      // the default cannot enforce !Is_Something_Attached — callers needing that
      // can pass options.canDock to add the check.
      if (seeker.kind !== 'unit-harvester') return false;
      return true;
    default:
      return false;
  }
}

/**
 * Find the best docking bay for `seeker`. Mirrors C++ TechnoClass::Find_Docking_Bay
 * (techno.cpp:5809-5853) exactly:
 *  - same-house OR allied (per `friendly`)
 *  - not in limbo (TS: alive=true)
 *  - type matches `buildingType`
 *  - aircraft bypass MZone check; ground units require same zone
 *  - RADIO_CAN_LOAD answer is ROGER
 *  - closest by Distance() wins, IsLeader candidates override distance
 *
 * Returns the chosen MapStructure or null.
 */
export function findDockingBay(
  ctx: DockingContext,
  seeker: DockingSeeker,
  buildingType: string,
  friendly: boolean,
  options: FindDockingBayOptions = {},
): MapStructure | null {
  const canDock = options.canDock ?? ((s: MapStructure) => defaultCanDock(seeker, s));
  const stride = options.mapCellsStride ?? 128;
  const reachable = options.reachableZone ?? null;

  // Fast-path C++ techno.cpp:5820 — if there are zero buildings of the requested
  // type owned by this house, abort. TS approximates with a single pass-through
  // (no per-house Quantity cache); the loop below produces the same result.

  const src = (seeker.leptonX !== undefined && seeker.leptonY !== undefined)
    ? { lx: seeker.leptonX, ly: seeker.leptonY }
    : cellCenterLeptons(seeker.cell.cx, seeker.cell.cy);
  let best: MapStructure | null = null;
  let bestVal = -1;

  for (const building of ctx.structures) {
    if (!building) continue;
    // C++ techno.cpp:5834 — ownership
    if (friendly) {
      if (!ctx.isAllied(building.house, seeker.house)) continue;
    } else {
      if (building.house !== seeker.house) continue;
    }
    // C++ techno.cpp:5835 — IsInLimbo: TS uses alive=false as the limbo marker.
    if (!building.alive) continue;
    // C++ techno.cpp:5836 — type filter
    if (building.type !== buildingType) continue;
    // C++ techno.cpp:5837 — MZone equality for non-aircraft seekers
    if (!seeker.isAirUnit && reachable) {
      // Building's "center" in TS uses its top-left cell — but for zone parity
      // the C++ reads Map[building->Center_Coord()].Zones[MZone] which is the
      // building's center cell. Walls/refineries with multi-cell footprints
      // expose the south face for docking, so we check the cell directly south
      // of the top-left as a representative reachable cell. The simpler and
      // more faithful approximation: any of the building's footprint cells in
      // the reachable mask makes the building reachable. The seeker's BFS mask
      // already excludes the building footprint via structureZonePassableCells
      // (missionAI.ts:1761), but the docking cell is adjacent. We check the
      // top-left cell first, then fall through to the south-adjacent cell.
      const idxCenter = building.cy * stride + building.cx;
      const idxSouth = (building.cy + 1) * stride + building.cx;
      if (!reachable[idxCenter] && !reachable[idxSouth]) continue;
    }
    // C++ techno.cpp:5838 — RADIO_CAN_LOAD predicate (per-building-type rule)
    if (!canDock(building)) continue;

    // C++ techno.cpp:5845 — distance ranking with IsLeader override.
    // Buildings use BuildingClass::Center_Coord() which is the footprint center
    // (per C++ Center_Coord = Coord + CenterOffset[BSIZE]). scenario.ts
    // structureCenterLeptons mirrors this offset table exactly.
    const bc = structureCenterLeptons(building);
    const d = leptonDistanceLocal(src.lx, src.ly, bc.lx, bc.ly);
    if (bestVal === -1 || d < bestVal || building.isLeader) {
      best = building;
      bestVal = d;
    }
  }

  return best;
}
