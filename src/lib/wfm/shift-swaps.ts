/**
 * Shift swap/trade functionality for WFM.
 * JSONL-backed CRUD following the store.ts pattern.
 */

import { readJsonlFile, writeJsonlFile } from '@/lib/jsonl-store';
import { getAgentSkills } from '@/lib/routing/store';
import type { ShiftSwapRequest, AgentSchedule, ShiftBlock } from './types';
import { getSchedulesStore, updateScheduleStore, genId } from './store';

const SWAP_FILE = 'wfm-shift-swaps.jsonl';

let loaded = false;
const swapRequests: ShiftSwapRequest[] = [];

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  const stored = readJsonlFile<ShiftSwapRequest>(SWAP_FILE);
  if (stored.length > 0) swapRequests.push(...stored);
}

function persist(): void {
  writeJsonlFile(SWAP_FILE, swapRequests);
}

function findSwap(id: string): ShiftSwapRequest | undefined {
  ensureLoaded();
  return swapRequests.find(s => s.id === id);
}

// --- Helpers ---

/**
 * Verify that a user has a shift on a given date with the given start/end times.
 * Returns the matching schedule or null.
 */
function findMatchingShift(
  userId: string,
  shiftDate: string,
  shiftStart: string,
  shiftEnd: string,
): { schedule: AgentSchedule; shift: ShiftBlock } | null {
  const schedules = getSchedulesStore(userId);
  const date = new Date(shiftDate);
  const dayOfWeek = date.getUTCDay();

  for (const sched of schedules) {
    // Check schedule is effective for this date
    if (shiftDate < sched.effectiveFrom) continue;
    if (sched.effectiveTo && shiftDate > sched.effectiveTo) continue;

    for (const shift of sched.shifts) {
      if (shift.dayOfWeek === dayOfWeek && shift.startTime === shiftStart && shift.endTime === shiftEnd) {
        return { schedule: sched, shift };
      }
    }
  }
  return null;
}

/**
 * Check whether an agent has skills compatible with a given shift.
 * If the shift has an activity label that looks like a skill requirement, validate it.
 * For simplicity, we check if the agent has all skill names that exist in the
 * other agent's skill set. This is a reasonable enterprise default.
 */
function checkSkillEligibility(userId: string, otherUserId: string): { eligible: boolean; reason?: string } {
  const agentSkills = getAgentSkills(userId);
  const otherSkills = getAgentSkills(otherUserId);

  // If the other agent has skills assigned, ensure this agent has them too
  const otherSkillNames = otherSkills.map(s => s.skillName);
  const agentSkillNames = new Set(agentSkills.map(s => s.skillName));

  const missing = otherSkillNames.filter(name => !agentSkillNames.has(name));
  if (missing.length > 0) {
    return {
      eligible: false,
      reason: `Agent ${userId} is missing required skills: ${missing.join(', ')}`,
    };
  }

  return { eligible: true };
}

/**
 * Check if an agent would have a schedule conflict on a given date/time
 * after the swap (i.e., they'd be double-booked).
 * excludeShift allows excluding the specific shift being swapped away
 * (but still checks other shifts in the same schedule).
 */
function checkScheduleConflict(
  userId: string,
  shiftDate: string,
  shiftStart: string,
  shiftEnd: string,
  excludeShift?: { scheduleId: string; dayOfWeek: number; startTime: string; endTime: string },
): { conflict: boolean; detail?: string } {
  const schedules = getSchedulesStore(userId);
  const date = new Date(shiftDate);
  const dayOfWeek = date.getUTCDay();

  for (const sched of schedules) {
    if (shiftDate < sched.effectiveFrom) continue;
    if (sched.effectiveTo && shiftDate > sched.effectiveTo) continue;

    for (const shift of sched.shifts) {
      // Skip the specific shift being swapped away
      if (
        excludeShift &&
        sched.id === excludeShift.scheduleId &&
        shift.dayOfWeek === excludeShift.dayOfWeek &&
        shift.startTime === excludeShift.startTime &&
        shift.endTime === excludeShift.endTime
      ) {
        continue;
      }

      if (shift.dayOfWeek === dayOfWeek && shiftStart < shift.endTime && shiftEnd > shift.startTime) {
        return {
          conflict: true,
          detail: `Conflict with ${sched.id}: ${shift.startTime}-${shift.endTime} on day ${dayOfWeek}`,
        };
      }
    }
  }
  return { conflict: false };
}

// --- Public API ---

export interface CreateSwapInput {
  requesterId: string;
  requesterName: string;
  targetId?: string;
  targetName?: string;
  requesterShiftDate: string;
  requesterShiftStart: string;
  requesterShiftEnd: string;
  targetShiftDate?: string;
  targetShiftStart?: string;
  targetShiftEnd?: string;
  reason?: string;
}

/**
 * Create a swap request. Validates that the requester actually has the specified shift.
 */
export function createSwapRequest(input: CreateSwapInput): ShiftSwapRequest {
  ensureLoaded();

  // Validate requester has the shift
  const match = findMatchingShift(
    input.requesterId,
    input.requesterShiftDate,
    input.requesterShiftStart,
    input.requesterShiftEnd,
  );
  if (!match) {
    throw new Error(
      `Requester ${input.requesterId} does not have a shift on ${input.requesterShiftDate} ` +
      `from ${input.requesterShiftStart} to ${input.requesterShiftEnd}`,
    );
  }

  const now = new Date().toISOString();
  const swap: ShiftSwapRequest = {
    id: genId('swap'),
    requesterId: input.requesterId,
    requesterName: input.requesterName,
    targetId: input.targetId,
    targetName: input.targetName,
    requesterShiftDate: input.requesterShiftDate,
    requesterShiftStart: input.requesterShiftStart,
    requesterShiftEnd: input.requesterShiftEnd,
    targetShiftDate: input.targetShiftDate,
    targetShiftStart: input.targetShiftStart,
    targetShiftEnd: input.targetShiftEnd,
    status: 'pending',
    reason: input.reason,
    createdAt: now,
    updatedAt: now,
  };

  swapRequests.push(swap);
  persist();
  return swap;
}

/**
 * Target agent accepts the swap request. Status transitions from pending -> accepted.
 * For open swaps (no targetId), the accepting agent becomes the target.
 * The target must provide their shift details if not already specified.
 */
export function acceptSwapRequest(
  id: string,
  targetId: string,
  targetName?: string,
  targetShiftDate?: string,
  targetShiftStart?: string,
  targetShiftEnd?: string,
): ShiftSwapRequest {
  ensureLoaded();

  const swap = findSwap(id);
  if (!swap) throw new Error(`Swap request ${id} not found`);
  if (swap.status !== 'pending') throw new Error(`Swap request ${id} is not pending (current: ${swap.status})`);
  if (swap.targetId && swap.targetId !== targetId) {
    throw new Error(`Swap request ${id} is targeted at ${swap.targetId}, not ${targetId}`);
  }

  // Use provided shift details or existing ones on the swap
  const finalTargetShiftDate = targetShiftDate ?? swap.targetShiftDate;
  const finalTargetShiftStart = targetShiftStart ?? swap.targetShiftStart;
  const finalTargetShiftEnd = targetShiftEnd ?? swap.targetShiftEnd;

  // Validate the target has the shift they're offering
  if (finalTargetShiftDate && finalTargetShiftStart && finalTargetShiftEnd) {
    const match = findMatchingShift(targetId, finalTargetShiftDate, finalTargetShiftStart, finalTargetShiftEnd);
    if (!match) {
      throw new Error(
        `Target ${targetId} does not have a shift on ${finalTargetShiftDate} ` +
        `from ${finalTargetShiftStart} to ${finalTargetShiftEnd}`,
      );
    }
  }

  swap.targetId = targetId;
  swap.targetName = targetName ?? swap.targetName;
  swap.targetShiftDate = finalTargetShiftDate;
  swap.targetShiftStart = finalTargetShiftStart;
  swap.targetShiftEnd = finalTargetShiftEnd;
  swap.status = 'accepted';
  swap.updatedAt = new Date().toISOString();

  persist();
  return swap;
}

/**
 * Manager approves the swap. Validates skill eligibility and schedule conflicts,
 * then executes the actual schedule swap.
 */
export function approveSwapRequest(id: string, managerNotes?: string): ShiftSwapRequest {
  ensureLoaded();

  const swap = findSwap(id);
  if (!swap) throw new Error(`Swap request ${id} not found`);
  if (swap.status !== 'accepted') throw new Error(`Swap request ${id} is not accepted (current: ${swap.status})`);
  if (!swap.targetId) throw new Error(`Swap request ${id} has no target agent`);

  // Validate skill eligibility in both directions
  const requesterEligibility = checkSkillEligibility(swap.requesterId, swap.targetId);
  if (!requesterEligibility.eligible) {
    throw new Error(`Skill eligibility check failed: ${requesterEligibility.reason}`);
  }
  const targetEligibility = checkSkillEligibility(swap.targetId, swap.requesterId);
  if (!targetEligibility.eligible) {
    throw new Error(`Skill eligibility check failed: ${targetEligibility.reason}`);
  }

  // Find the actual schedules/shifts to swap
  const requesterMatch = findMatchingShift(
    swap.requesterId,
    swap.requesterShiftDate,
    swap.requesterShiftStart,
    swap.requesterShiftEnd,
  );
  if (!requesterMatch) {
    throw new Error(`Requester's shift no longer exists`);
  }

  // Check if this is a trade (both sides have shifts) or a simple give-away
  let targetMatch: { schedule: AgentSchedule; shift: ShiftBlock } | null = null;
  if (swap.targetShiftDate && swap.targetShiftStart && swap.targetShiftEnd) {
    targetMatch = findMatchingShift(
      swap.targetId,
      swap.targetShiftDate,
      swap.targetShiftStart,
      swap.targetShiftEnd,
    );
    if (!targetMatch) {
      throw new Error(`Target's shift no longer exists`);
    }
  }

  // Check for conflicts after swap
  const requesterShiftDate = new Date(swap.requesterShiftDate);
  const requesterDow = requesterShiftDate.getUTCDay();

  // Requester taking target's shift: check conflicts excluding the requester's shift being given away
  if (targetMatch) {
    const targetShiftDate = new Date(swap.targetShiftDate!);
    const targetDow = targetShiftDate.getUTCDay();
    const requesterConflict = checkScheduleConflict(
      swap.requesterId,
      swap.targetShiftDate!,
      swap.targetShiftStart!,
      swap.targetShiftEnd!,
      { scheduleId: requesterMatch.schedule.id, dayOfWeek: requesterDow, startTime: swap.requesterShiftStart, endTime: swap.requesterShiftEnd },
    );
    if (requesterConflict.conflict) {
      throw new Error(`Schedule conflict for requester: ${requesterConflict.detail}`);
    }
  }

  // Target taking requester's shift: check conflicts excluding the target's shift being given away
  const targetConflict = checkScheduleConflict(
    swap.targetId,
    swap.requesterShiftDate,
    swap.requesterShiftStart,
    swap.requesterShiftEnd,
    targetMatch
      ? { scheduleId: targetMatch.schedule.id, dayOfWeek: new Date(swap.targetShiftDate!).getUTCDay(), startTime: swap.targetShiftStart!, endTime: swap.targetShiftEnd! }
      : undefined,
  );
  if (targetConflict.conflict) {
    throw new Error(`Schedule conflict for target: ${targetConflict.detail}`);
  }

  // Execute the swap: update actual schedules
  // Remove requester's shift from their schedule, add target's shift
  const requesterNewShifts = requesterMatch.schedule.shifts.filter(
    s => !(s.dayOfWeek === requesterDow && s.startTime === swap.requesterShiftStart && s.endTime === swap.requesterShiftEnd),
  );
  if (targetMatch) {
    const targetShiftDate = new Date(swap.targetShiftDate!);
    const targetDow = targetShiftDate.getUTCDay();
    // Add target's shift to requester
    requesterNewShifts.push({
      dayOfWeek: targetDow,
      startTime: swap.targetShiftStart!,
      endTime: swap.targetShiftEnd!,
      activity: targetMatch.shift.activity,
      label: targetMatch.shift.label,
    });
    // Remove target's shift from their schedule, add requester's shift
    const targetNewShifts = targetMatch.schedule.shifts.filter(
      s => !(s.dayOfWeek === targetDow && s.startTime === swap.targetShiftStart && s.endTime === swap.targetShiftEnd),
    );
    targetNewShifts.push({
      dayOfWeek: requesterDow,
      startTime: swap.requesterShiftStart,
      endTime: swap.requesterShiftEnd,
      activity: requesterMatch.shift.activity,
      label: requesterMatch.shift.label,
    });
    updateScheduleStore(targetMatch.schedule.id, { shifts: targetNewShifts });
  } else {
    // Simple give-away: add requester's shift to target's schedule
    const targetSchedules = getSchedulesStore(swap.targetId);
    if (targetSchedules.length > 0) {
      const targetSched = targetSchedules[0];
      const targetNewShifts = [...targetSched.shifts, {
        dayOfWeek: requesterDow,
        startTime: swap.requesterShiftStart,
        endTime: swap.requesterShiftEnd,
        activity: requesterMatch.shift.activity,
        label: requesterMatch.shift.label,
      }];
      updateScheduleStore(targetSched.id, { shifts: targetNewShifts });
    }
  }
  updateScheduleStore(requesterMatch.schedule.id, { shifts: requesterNewShifts });

  swap.status = 'approved';
  swap.managerNotes = managerNotes;
  swap.updatedAt = new Date().toISOString();
  persist();
  return swap;
}

/**
 * Manager rejects the swap request.
 */
export function rejectSwapRequest(id: string, managerNotes?: string): ShiftSwapRequest {
  ensureLoaded();

  const swap = findSwap(id);
  if (!swap) throw new Error(`Swap request ${id} not found`);
  if (swap.status === 'approved' || swap.status === 'cancelled') {
    throw new Error(`Swap request ${id} cannot be rejected (current: ${swap.status})`);
  }

  swap.status = 'rejected';
  swap.managerNotes = managerNotes;
  swap.updatedAt = new Date().toISOString();
  persist();
  return swap;
}

/**
 * Requester cancels the swap request.
 */
export function cancelSwapRequest(id: string, requesterId: string): ShiftSwapRequest {
  ensureLoaded();

  const swap = findSwap(id);
  if (!swap) throw new Error(`Swap request ${id} not found`);
  if (swap.requesterId !== requesterId) {
    throw new Error(`Only the requester can cancel this swap request`);
  }
  if (swap.status === 'approved') {
    throw new Error(`Cannot cancel an already approved swap request`);
  }

  swap.status = 'cancelled';
  swap.updatedAt = new Date().toISOString();
  persist();
  return swap;
}

/**
 * Query swap requests with optional filters.
 */
export function getSwapRequests(filters?: {
  status?: ShiftSwapRequest['status'];
  requesterId?: string;
  targetId?: string;
}): ShiftSwapRequest[] {
  ensureLoaded();
  let results = [...swapRequests];
  if (filters?.status) results = results.filter(s => s.status === filters.status);
  if (filters?.requesterId) results = results.filter(s => s.requesterId === filters.requesterId);
  if (filters?.targetId) results = results.filter(s => s.targetId === filters.targetId);
  return results;
}

/**
 * Reset module state (for testing).
 */
export function _resetSwapStore(): void {
  loaded = false;
  swapRequests.length = 0;
}
