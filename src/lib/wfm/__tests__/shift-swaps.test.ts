import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createSwapRequest,
  acceptSwapRequest,
  approveSwapRequest,
  rejectSwapRequest,
  cancelSwapRequest,
  getSwapRequests,
  _resetSwapStore,
} from '../shift-swaps';
import type { AgentSchedule, ShiftSwapRequest } from '../types';

// --- Mocks ---

// Mock JSONL persistence (no filesystem in tests)
vi.mock('@/lib/jsonl-store', () => ({
  readJsonlFile: () => [],
  writeJsonlFile: () => {},
  appendJsonlLine: () => {},
}));

// In-memory schedule store for testing
let mockSchedules: AgentSchedule[] = [];
let mockSkills: Array<{ userId: string; skillName: string }> = [];

vi.mock('../store', () => ({
  genId: (prefix = 'wfm') => `${prefix}-test-${Math.random().toString(36).slice(2, 8)}`,
  getSchedulesStore: (userId?: string) =>
    userId ? mockSchedules.filter(s => s.userId === userId) : [...mockSchedules],
  updateScheduleStore: (id: string, updates: Partial<AgentSchedule>) => {
    const idx = mockSchedules.findIndex(s => s.id === id);
    if (idx < 0) return null;
    mockSchedules[idx] = { ...mockSchedules[idx], ...updates, updatedAt: new Date().toISOString() };
    return mockSchedules[idx];
  },
}));

vi.mock('@/lib/routing/store', () => ({
  getAgentSkills: (userId?: string) => {
    const skills = userId ? mockSkills.filter(s => s.userId === userId) : [...mockSkills];
    return skills.map(s => ({ id: `sk-${s.userId}-${s.skillName}`, userId: s.userId, skillName: s.skillName, proficiency: 1 }));
  },
}));

// --- Helpers ---

function makeSchedule(overrides: Partial<AgentSchedule>): AgentSchedule {
  return {
    id: `sched-${overrides.userId ?? 'test'}`,
    userId: overrides.userId ?? 'user-1',
    userName: overrides.userName ?? 'Test Agent',
    effectiveFrom: '2026-01-01',
    timezone: 'UTC',
    shifts: [
      // Monday 09:00-17:00 work shift
      { dayOfWeek: 1, startTime: '09:00', endTime: '17:00', activity: 'work' },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// A Monday date for test shifts (2026-03-02 is a Monday, dayOfWeek=1)
const MONDAY = '2026-03-02';

describe('Shift Swap Requests', () => {
  beforeEach(() => {
    _resetSwapStore();
    mockSchedules = [];
    mockSkills = [];
  });

  describe('createSwapRequest', () => {
    it('creates a swap request when requester has the shift', () => {
      mockSchedules = [makeSchedule({ userId: 'user-1', userName: 'Alice' })];

      const swap = createSwapRequest({
        requesterId: 'user-1',
        requesterName: 'Alice',
        requesterShiftDate: MONDAY,
        requesterShiftStart: '09:00',
        requesterShiftEnd: '17:00',
        reason: 'Doctor appointment',
      });

      expect(swap.id).toMatch(/^swap-/);
      expect(swap.status).toBe('pending');
      expect(swap.requesterId).toBe('user-1');
      expect(swap.requesterShiftDate).toBe(MONDAY);
      expect(swap.reason).toBe('Doctor appointment');
    });

    it('rejects creation when requester does not have the shift', () => {
      mockSchedules = [makeSchedule({ userId: 'user-1', userName: 'Alice' })];

      expect(() =>
        createSwapRequest({
          requesterId: 'user-1',
          requesterName: 'Alice',
          requesterShiftDate: MONDAY,
          requesterShiftStart: '18:00', // No such shift
          requesterShiftEnd: '22:00',
        }),
      ).toThrow(/does not have a shift/);
    });

    it('rejects creation when requester has no schedule', () => {
      // No schedules in store
      expect(() =>
        createSwapRequest({
          requesterId: 'user-999',
          requesterName: 'Nobody',
          requesterShiftDate: MONDAY,
          requesterShiftStart: '09:00',
          requesterShiftEnd: '17:00',
        }),
      ).toThrow(/does not have a shift/);
    });
  });

  describe('acceptSwapRequest', () => {
    it('transitions status from pending to accepted', () => {
      mockSchedules = [
        makeSchedule({ userId: 'user-1', userName: 'Alice' }),
        makeSchedule({
          userId: 'user-2', userName: 'Bob', id: 'sched-user-2',
          shifts: [{ dayOfWeek: 2, startTime: '10:00', endTime: '18:00', activity: 'work' }],
        }),
      ];

      const swap = createSwapRequest({
        requesterId: 'user-1',
        requesterName: 'Alice',
        requesterShiftDate: MONDAY,
        requesterShiftStart: '09:00',
        requesterShiftEnd: '17:00',
      });

      // Tuesday 2026-03-03 is dayOfWeek=2
      const accepted = acceptSwapRequest(swap.id, 'user-2', 'Bob', '2026-03-03', '10:00', '18:00');
      expect(accepted.status).toBe('accepted');
      expect(accepted.targetId).toBe('user-2');
      expect(accepted.targetName).toBe('Bob');
    });

    it('allows open swap to be accepted by any agent', () => {
      mockSchedules = [
        makeSchedule({ userId: 'user-1', userName: 'Alice' }),
        makeSchedule({
          userId: 'user-3', userName: 'Charlie', id: 'sched-user-3',
          shifts: [{ dayOfWeek: 3, startTime: '08:00', endTime: '16:00', activity: 'work' }],
        }),
      ];

      const swap = createSwapRequest({
        requesterId: 'user-1',
        requesterName: 'Alice',
        requesterShiftDate: MONDAY,
        requesterShiftStart: '09:00',
        requesterShiftEnd: '17:00',
        // No targetId — open swap
      });

      // Wednesday 2026-03-04 is dayOfWeek=3
      const accepted = acceptSwapRequest(swap.id, 'user-3', 'Charlie', '2026-03-04', '08:00', '16:00');
      expect(accepted.status).toBe('accepted');
      expect(accepted.targetId).toBe('user-3');
    });

    it('rejects accept when swap is not pending', () => {
      mockSchedules = [makeSchedule({ userId: 'user-1', userName: 'Alice' })];

      const swap = createSwapRequest({
        requesterId: 'user-1',
        requesterName: 'Alice',
        requesterShiftDate: MONDAY,
        requesterShiftStart: '09:00',
        requesterShiftEnd: '17:00',
      });

      cancelSwapRequest(swap.id, 'user-1');

      expect(() => acceptSwapRequest(swap.id, 'user-2')).toThrow(/not pending/);
    });

    it('rejects accept from wrong target', () => {
      mockSchedules = [makeSchedule({ userId: 'user-1', userName: 'Alice' })];

      const swap = createSwapRequest({
        requesterId: 'user-1',
        requesterName: 'Alice',
        targetId: 'user-2',
        targetName: 'Bob',
        requesterShiftDate: MONDAY,
        requesterShiftStart: '09:00',
        requesterShiftEnd: '17:00',
      });

      expect(() => acceptSwapRequest(swap.id, 'user-3')).toThrow(/targeted at user-2/);
    });
  });

  describe('approveSwapRequest', () => {
    it('approves and updates schedules for a full trade', () => {
      mockSchedules = [
        makeSchedule({
          userId: 'user-1', userName: 'Alice', id: 'sched-alice',
          shifts: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', activity: 'work' }],
        }),
        makeSchedule({
          userId: 'user-2', userName: 'Bob', id: 'sched-bob',
          shifts: [{ dayOfWeek: 2, startTime: '10:00', endTime: '18:00', activity: 'work' }],
        }),
      ];

      const swap = createSwapRequest({
        requesterId: 'user-1',
        requesterName: 'Alice',
        requesterShiftDate: MONDAY,
        requesterShiftStart: '09:00',
        requesterShiftEnd: '17:00',
      });

      // Tuesday 2026-03-03 is dayOfWeek=2
      acceptSwapRequest(swap.id, 'user-2', 'Bob', '2026-03-03', '10:00', '18:00');
      const approved = approveSwapRequest(swap.id, 'Manager approved');

      expect(approved.status).toBe('approved');
      expect(approved.managerNotes).toBe('Manager approved');

      // Verify schedules were actually updated
      const aliceSched = mockSchedules.find(s => s.id === 'sched-alice')!;
      const bobSched = mockSchedules.find(s => s.id === 'sched-bob')!;

      // Alice should no longer have Monday 09-17, but should have Tuesday 10-18
      expect(aliceSched.shifts.some(s => s.dayOfWeek === 1 && s.startTime === '09:00')).toBe(false);
      expect(aliceSched.shifts.some(s => s.dayOfWeek === 2 && s.startTime === '10:00' && s.endTime === '18:00')).toBe(true);

      // Bob should no longer have Tuesday 10-18, but should have Monday 09-17
      expect(bobSched.shifts.some(s => s.dayOfWeek === 2 && s.startTime === '10:00')).toBe(false);
      expect(bobSched.shifts.some(s => s.dayOfWeek === 1 && s.startTime === '09:00' && s.endTime === '17:00')).toBe(true);
    });

    it('rejects approval when not in accepted status', () => {
      mockSchedules = [makeSchedule({ userId: 'user-1', userName: 'Alice' })];

      const swap = createSwapRequest({
        requesterId: 'user-1',
        requesterName: 'Alice',
        requesterShiftDate: MONDAY,
        requesterShiftStart: '09:00',
        requesterShiftEnd: '17:00',
      });

      // Still pending, not accepted
      expect(() => approveSwapRequest(swap.id)).toThrow(/not accepted/);
    });

    it('rejects approval when skill eligibility fails', () => {
      mockSchedules = [
        makeSchedule({
          userId: 'user-1', userName: 'Alice', id: 'sched-alice',
          shifts: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', activity: 'work' }],
        }),
        makeSchedule({
          userId: 'user-2', userName: 'Bob', id: 'sched-bob',
          shifts: [{ dayOfWeek: 2, startTime: '10:00', endTime: '18:00', activity: 'work' }],
        }),
      ];

      // Alice has 'billing' skill, Bob doesn't
      mockSkills = [
        { userId: 'user-1', skillName: 'billing' },
        { userId: 'user-1', skillName: 'email' },
        { userId: 'user-2', skillName: 'email' },
        // Bob is missing 'billing'
      ];

      const swap = createSwapRequest({
        requesterId: 'user-1',
        requesterName: 'Alice',
        requesterShiftDate: MONDAY,
        requesterShiftStart: '09:00',
        requesterShiftEnd: '17:00',
      });

      acceptSwapRequest(swap.id, 'user-2', 'Bob', '2026-03-03', '10:00', '18:00');

      expect(() => approveSwapRequest(swap.id)).toThrow(/missing required skills.*billing/);
    });

    it('rejects approval when schedule conflict exists', () => {
      mockSchedules = [
        makeSchedule({
          userId: 'user-1', userName: 'Alice', id: 'sched-alice',
          shifts: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', activity: 'work' }],
        }),
        makeSchedule({
          userId: 'user-2', userName: 'Bob', id: 'sched-bob',
          shifts: [
            { dayOfWeek: 2, startTime: '10:00', endTime: '18:00', activity: 'work' },
            // Bob already has a Monday shift that overlaps with Alice's
            { dayOfWeek: 1, startTime: '08:00', endTime: '12:00', activity: 'work' },
          ],
        }),
      ];

      const swap = createSwapRequest({
        requesterId: 'user-1',
        requesterName: 'Alice',
        requesterShiftDate: MONDAY,
        requesterShiftStart: '09:00',
        requesterShiftEnd: '17:00',
      });

      acceptSwapRequest(swap.id, 'user-2', 'Bob', '2026-03-03', '10:00', '18:00');

      // Bob taking Alice's Monday 09-17 would conflict with his existing Monday 08-12
      expect(() => approveSwapRequest(swap.id)).toThrow(/Schedule conflict for target/);
    });
  });

  describe('rejectSwapRequest', () => {
    it('sets status to rejected with manager notes', () => {
      mockSchedules = [makeSchedule({ userId: 'user-1', userName: 'Alice' })];

      const swap = createSwapRequest({
        requesterId: 'user-1',
        requesterName: 'Alice',
        requesterShiftDate: MONDAY,
        requesterShiftStart: '09:00',
        requesterShiftEnd: '17:00',
      });

      const rejected = rejectSwapRequest(swap.id, 'Understaffed on Monday');
      expect(rejected.status).toBe('rejected');
      expect(rejected.managerNotes).toBe('Understaffed on Monday');
    });

    it('can reject a pending request', () => {
      mockSchedules = [makeSchedule({ userId: 'user-1', userName: 'Alice' })];

      const swap = createSwapRequest({
        requesterId: 'user-1',
        requesterName: 'Alice',
        requesterShiftDate: MONDAY,
        requesterShiftStart: '09:00',
        requesterShiftEnd: '17:00',
      });

      const rejected = rejectSwapRequest(swap.id);
      expect(rejected.status).toBe('rejected');
    });

    it('cannot reject an already approved request', () => {
      mockSchedules = [
        makeSchedule({
          userId: 'user-1', userName: 'Alice', id: 'sched-alice',
          shifts: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', activity: 'work' }],
        }),
        makeSchedule({
          userId: 'user-2', userName: 'Bob', id: 'sched-bob',
          shifts: [{ dayOfWeek: 2, startTime: '10:00', endTime: '18:00', activity: 'work' }],
        }),
      ];

      const swap = createSwapRequest({
        requesterId: 'user-1',
        requesterName: 'Alice',
        requesterShiftDate: MONDAY,
        requesterShiftStart: '09:00',
        requesterShiftEnd: '17:00',
      });

      acceptSwapRequest(swap.id, 'user-2', 'Bob', '2026-03-03', '10:00', '18:00');
      approveSwapRequest(swap.id);

      expect(() => rejectSwapRequest(swap.id)).toThrow(/cannot be rejected/);
    });
  });

  describe('cancelSwapRequest', () => {
    it('allows requester to cancel a pending request', () => {
      mockSchedules = [makeSchedule({ userId: 'user-1', userName: 'Alice' })];

      const swap = createSwapRequest({
        requesterId: 'user-1',
        requesterName: 'Alice',
        requesterShiftDate: MONDAY,
        requesterShiftStart: '09:00',
        requesterShiftEnd: '17:00',
      });

      const cancelled = cancelSwapRequest(swap.id, 'user-1');
      expect(cancelled.status).toBe('cancelled');
    });

    it('allows requester to cancel an accepted request', () => {
      mockSchedules = [
        makeSchedule({ userId: 'user-1', userName: 'Alice' }),
        makeSchedule({
          userId: 'user-2', userName: 'Bob', id: 'sched-user-2',
          shifts: [{ dayOfWeek: 2, startTime: '10:00', endTime: '18:00', activity: 'work' }],
        }),
      ];

      const swap = createSwapRequest({
        requesterId: 'user-1',
        requesterName: 'Alice',
        requesterShiftDate: MONDAY,
        requesterShiftStart: '09:00',
        requesterShiftEnd: '17:00',
      });

      acceptSwapRequest(swap.id, 'user-2', 'Bob', '2026-03-03', '10:00', '18:00');
      const cancelled = cancelSwapRequest(swap.id, 'user-1');
      expect(cancelled.status).toBe('cancelled');
    });

    it('rejects cancel by non-requester', () => {
      mockSchedules = [makeSchedule({ userId: 'user-1', userName: 'Alice' })];

      const swap = createSwapRequest({
        requesterId: 'user-1',
        requesterName: 'Alice',
        requesterShiftDate: MONDAY,
        requesterShiftStart: '09:00',
        requesterShiftEnd: '17:00',
      });

      expect(() => cancelSwapRequest(swap.id, 'user-2')).toThrow(/Only the requester/);
    });

    it('rejects cancel of approved request', () => {
      mockSchedules = [
        makeSchedule({
          userId: 'user-1', userName: 'Alice', id: 'sched-alice',
          shifts: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', activity: 'work' }],
        }),
        makeSchedule({
          userId: 'user-2', userName: 'Bob', id: 'sched-bob',
          shifts: [{ dayOfWeek: 2, startTime: '10:00', endTime: '18:00', activity: 'work' }],
        }),
      ];

      const swap = createSwapRequest({
        requesterId: 'user-1',
        requesterName: 'Alice',
        requesterShiftDate: MONDAY,
        requesterShiftStart: '09:00',
        requesterShiftEnd: '17:00',
      });

      acceptSwapRequest(swap.id, 'user-2', 'Bob', '2026-03-03', '10:00', '18:00');
      approveSwapRequest(swap.id);

      expect(() => cancelSwapRequest(swap.id, 'user-1')).toThrow(/Cannot cancel an already approved/);
    });
  });

  describe('getSwapRequests', () => {
    it('returns all requests without filters', () => {
      mockSchedules = [makeSchedule({ userId: 'user-1', userName: 'Alice' })];

      createSwapRequest({
        requesterId: 'user-1',
        requesterName: 'Alice',
        requesterShiftDate: MONDAY,
        requesterShiftStart: '09:00',
        requesterShiftEnd: '17:00',
      });

      const results = getSwapRequests();
      expect(results).toHaveLength(1);
    });

    it('filters by status', () => {
      mockSchedules = [makeSchedule({ userId: 'user-1', userName: 'Alice' })];

      const swap1 = createSwapRequest({
        requesterId: 'user-1',
        requesterName: 'Alice',
        requesterShiftDate: MONDAY,
        requesterShiftStart: '09:00',
        requesterShiftEnd: '17:00',
      });

      cancelSwapRequest(swap1.id, 'user-1');

      // Create another one (still pending)
      createSwapRequest({
        requesterId: 'user-1',
        requesterName: 'Alice',
        requesterShiftDate: MONDAY,
        requesterShiftStart: '09:00',
        requesterShiftEnd: '17:00',
      });

      expect(getSwapRequests({ status: 'pending' })).toHaveLength(1);
      expect(getSwapRequests({ status: 'cancelled' })).toHaveLength(1);
    });

    it('filters by requesterId', () => {
      mockSchedules = [
        makeSchedule({ userId: 'user-1', userName: 'Alice' }),
        makeSchedule({
          userId: 'user-2', userName: 'Bob', id: 'sched-user-2',
          shifts: [{ dayOfWeek: 1, startTime: '09:00', endTime: '17:00', activity: 'work' }],
        }),
      ];

      createSwapRequest({
        requesterId: 'user-1',
        requesterName: 'Alice',
        requesterShiftDate: MONDAY,
        requesterShiftStart: '09:00',
        requesterShiftEnd: '17:00',
      });

      createSwapRequest({
        requesterId: 'user-2',
        requesterName: 'Bob',
        requesterShiftDate: MONDAY,
        requesterShiftStart: '09:00',
        requesterShiftEnd: '17:00',
      });

      expect(getSwapRequests({ requesterId: 'user-1' })).toHaveLength(1);
      expect(getSwapRequests({ requesterId: 'user-2' })).toHaveLength(1);
    });

    it('filters by targetId', () => {
      mockSchedules = [makeSchedule({ userId: 'user-1', userName: 'Alice' })];

      createSwapRequest({
        requesterId: 'user-1',
        requesterName: 'Alice',
        targetId: 'user-2',
        targetName: 'Bob',
        requesterShiftDate: MONDAY,
        requesterShiftStart: '09:00',
        requesterShiftEnd: '17:00',
      });

      createSwapRequest({
        requesterId: 'user-1',
        requesterName: 'Alice',
        targetId: 'user-3',
        targetName: 'Charlie',
        requesterShiftDate: MONDAY,
        requesterShiftStart: '09:00',
        requesterShiftEnd: '17:00',
      });

      expect(getSwapRequests({ targetId: 'user-2' })).toHaveLength(1);
      expect(getSwapRequests({ targetId: 'user-3' })).toHaveLength(1);
    });
  });
});
