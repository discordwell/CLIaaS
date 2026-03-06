/**
 * Time-off request management.
 */

import type { TimeOffRequest } from './types';
import {
  getTimeOffRequests as storeGetRequests,
  addTimeOffRequest,
  updateTimeOffRequest,
  removeTimeOffRequest,
} from './store';
import { genId } from './store';

export function getTimeOffRequests(
  userId?: string,
  status?: 'pending' | 'approved' | 'denied',
): TimeOffRequest[] {
  let requests = storeGetRequests();
  if (userId) requests = requests.filter(r => r.userId === userId);
  if (status) requests = requests.filter(r => r.status === status);
  return requests;
}

export function requestTimeOff(params: {
  userId: string;
  userName?: string;
  startDate: string;
  endDate: string;
  reason?: string;
}): TimeOffRequest {
  const request: TimeOffRequest = {
    id: genId(),
    userId: params.userId,
    userName: params.userName ?? params.userId,
    startDate: params.startDate,
    endDate: params.endDate,
    reason: params.reason,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  addTimeOffRequest(request);
  return request;
}

export function decideTimeOff(
  requestId: string,
  decision: 'approved' | 'denied',
  decidedBy: string,
): TimeOffRequest | null {
  return updateTimeOffRequest(requestId, {
    status: decision,
    decidedBy,
    decidedAt: new Date().toISOString(),
  });
}
