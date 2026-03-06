/**
 * Event pipeline barrel export with convenience helpers.
 */

export { dispatch, type CanonicalEvent } from './dispatcher';

import { dispatch } from './dispatcher';

export function ticketCreated(data: Record<string, unknown>): void {
  dispatch('ticket.created', data);
}

export function ticketUpdated(data: Record<string, unknown>): void {
  dispatch('ticket.updated', data);
}

export function ticketResolved(data: Record<string, unknown>): void {
  dispatch('ticket.resolved', data);
}

export function messageCreated(data: Record<string, unknown>): void {
  dispatch('message.created', data);
}

export function slaBreached(data: Record<string, unknown>): void {
  dispatch('sla.breached', data);
}

export function csatSubmitted(data: Record<string, unknown>): void {
  dispatch('csat.submitted', data);
}

export function surveySubmitted(data: Record<string, unknown>): void {
  dispatch('survey.submitted', data);
}

export function surveySent(data: Record<string, unknown>): void {
  dispatch('survey.sent', data);
}

export function ticketMerged(data: Record<string, unknown>): void {
  dispatch('ticket.merged', data);
}

export function ticketSplit(data: Record<string, unknown>): void {
  dispatch('ticket.split', data);
}

export function ticketUnmerged(data: Record<string, unknown>): void {
  dispatch('ticket.unmerged', data);
}

export function sideConversationCreated(data: Record<string, unknown>): void {
  dispatch('side_conversation.created', data);
}

export function sideConversationReplied(data: Record<string, unknown>): void {
  dispatch('side_conversation.replied', data);
}
