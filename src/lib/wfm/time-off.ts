/**
 * Time-off request management.
 * Emits events via the shared eventBus.
 */

import { eventBus } from '@/lib/realtime/events';
import type { TimeOffRequest } from './types';
import {
  getTimeOffRequests as storeGetRequests,
  addTimeOffRequest,
  updateTimeOffRequest,
  genId,
} from './store';

/**
 * Get time-off requests, optionally filtered by userId and/or status.
 */
export function getTimeOffRequests(
  userId?: string,
  status?: 'pending' | 'approved' | 'denied',
): TimeOffRequest[] {
  return storeGetRequests(userId, status);
}

/**
 * Submit a new time-off request. Status starts as 'pending'.
 * Emits wfm:time_off_requested.
 */
export function requestTimeOff(input: {
  userId: string;
  userName: string;
  startDate: string;
  endDate: string;
  reason?: string;
}): TimeOffRequest {
  const now = new Date().toISOString();
  const request: TimeOffRequest = {
    id: genId('pto'),
    userId: input.userId,
    userName: input.userName,
    startDate: input.startDate,
    endDate: input.endDate,
    reason: input.reason,
    status: 'pending',
    createdAt: now,
  };
  addTimeOffRequest(request);

  eventBus.emit({
    type: 'wfm:time_off_requested' as Parameters<typeof eventBus.emit>[0]['type'],
    data: {
      requestId: request.id,
      userId: input.userId,
      userName: input.userName,
      startDate: input.startDate,
      endDate: input.endDate,
    },
    timestamp: Date.now(),
  });

  return request;
}

/**
 * Approve or deny a time-off request.
 * Emits wfm:time_off_decided.
 */
export function decideTimeOff(
  id: string,
  decision: 'approved' | 'denied',
  approvedBy: string,
): TimeOffRequest | null {
  const now = new Date().toISOString();
  const updated = updateTimeOffRequest(id, {
    status: decision,
    approvedBy,
    decidedAt: now,
  });

  if (updated) {
    eventBus.emit({
      type: 'wfm:time_off_decided' as Parameters<typeof eventBus.emit>[0]['type'],
      data: {
        requestId: id,
        decision,
        approvedBy,
        userId: updated.userId,
      },
      timestamp: Date.now(),
    });
  }

  return updated;
}
