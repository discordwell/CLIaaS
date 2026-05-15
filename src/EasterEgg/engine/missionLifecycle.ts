/**
 * Mission lifecycle helpers — C++ parity with mission.cpp and infantry.cpp.
 *
 * Unified entry points for mission transitions so every call site queues via
 * `missionQueue` (never direct-writes `mission`). Keeps Phase 2 of the joint
 * divergence refactor small and focused:
 *
 *   - `assignMission`   — C++ MissionClass::Assign_Mission (mission.cpp:379-390)
 *   - `commence`        — C++ MissionClass::Commence       (mission.cpp:343-359)
 *   - `enterIdleMode`   — C++ FootClass::Enter_Idle_Mode   (infantry.cpp:1663-1721)
 *
 * No debug infrastructure yet — these are pure one-liner wrappers designed to
 * land safely and enable subsequent phases (Phase 2 step 2.5 flag flip is a
 * separate concern handled by a sibling agent).
 */

import type { Entity } from './entity';
import { Mission } from './types';

/**
 * Queue a mission for the entity via `missionQueue`.
 *
 * C++ mission.cpp:379-390 Assign_Mission:
 *   - If the entity is already in that mission, do nothing.
 *   - Otherwise write to MissionQueue so the next Commence() pop promotes it.
 *
 * The "already in that mission" branch is a true no-op: it preserves any
 * existing MissionQueue. This matters when team code reissues MOVE while an
 * earlier Enter_Idle_Mode has already queued GUARD; C++ keeps the GUARD queue.
 *
 * Callers must NOT direct-write `entity.mission = X`. Use this helper so the
 * Commence gate (STAGE A/E) owns the transition timing.
 */
export function assignMission(entity: Entity, mission: Mission): void {
  if (mission === Mission.NONE) {
    return;
  }
  if (entity.mission === mission) {
    return;
  }
  entity.missionQueue = mission;
}

/**
 * Commit the queued mission — C++ mission.cpp:343-359 Commence:
 *   - Returns false (no-op) when MissionQueue is empty.
 *   - Otherwise: Mission ← MissionQueue, clear queue, Timer ← 0.
 *
 * NOTE: C++ Commence does NOT reset the infantry `Doing` field. That happens
 * on entry to the new mission's handler (e.g. Mission_Guard sets Doing=0).
 * We mirror that by leaving `doing` alone here.
 *
 * `reason` is accepted for future debug tracing (Phase 2.x instrumentation)
 * but is currently unused.
 */
export function commence(entity: Entity, reason: string): boolean {
  void reason; // reserved for future DEBUG_COMMENCE_TRACE
  if (entity.missionQueue === null) return false;
  entity.mission = entity.missionQueue;
  entity.missionQueue = null;
  entity.missionTimer = 0;
  if (entity.mission === Mission.RETREAT) entity.retreatStatus = 0;
  return true;
}

/**
 * Transition an entity to idle — C++ infantry.cpp:1663-1721 Enter_Idle_Mode.
 *
 * Picks AREA_GUARD when the entity has a `guardOrigin` (spawned with area-guard
 * intent), otherwise GUARD. Routes through `assignMission` so the transition
 * honors the standard queue → Commence lifecycle (never a direct mission write).
 */
export function enterIdleMode(entity: Entity): void {
  const target = entity.guardOrigin != null ? Mission.AREA_GUARD : Mission.GUARD;
  assignMission(entity, target);
}
