/**
 * Canned response store — JSONL-backed in-memory storage.
 * Follows the same pattern as src/lib/campaigns/campaign-store.ts.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';
import { withRls } from '../store-helpers';

export interface CannedResponse {
  id: string;
  workspaceId?: string;
  createdBy?: string;
  title: string;
  body: string;
  category?: string;
  scope: 'personal' | 'shared';
  shortcut?: string;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

const CANNED_FILE = 'canned-responses.jsonl';

function persist(): void {
  writeJsonlFile(CANNED_FILE, responses);
}

const responses: CannedResponse[] = [];
let defaultsLoaded = false;

function ensureDefaults(): void {
  if (defaultsLoaded) return;
  defaultsLoaded = true;

  const saved = readJsonlFile<CannedResponse>(CANNED_FILE);
  if (saved.length > 0) {
    responses.push(...saved);
    return;
  }

  const now = new Date().toISOString();
  const defaults: CannedResponse[] = [
    {
      id: 'canned-demo-1',
      title: 'Greeting',
      body: 'Hi {{customer.name}},\n\nThank you for reaching out! I\'d be happy to help you with this.\n\nBest regards,\n{{agent.name}}',
      category: 'General',
      scope: 'shared',
      shortcut: '/greet',
      usageCount: 42,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'canned-demo-2',
      title: 'Escalation Notice',
      body: 'Hi {{customer.name}},\n\nI\'m escalating your ticket (#{{ticket.id}}) to our senior support team for further investigation. You\'ll hear back within 24 hours.\n\nThank you for your patience.',
      category: 'Escalation',
      scope: 'shared',
      shortcut: '/escalate',
      usageCount: 15,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'canned-demo-3',
      title: 'Billing Inquiry Response',
      body: 'Hi {{customer.name}},\n\nThank you for contacting us about your billing question. I\'ve reviewed your account and here\'s what I found:\n\n[Details here]\n\nPlease let me know if you have any other questions.\n\nBest,\n{{agent.name}}',
      category: 'Billing',
      scope: 'shared',
      usageCount: 28,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'canned-demo-4',
      title: 'Shipping Status',
      body: 'Hi {{customer.name}},\n\nI checked on the shipping status for your order. Here\'s the latest update:\n\n[Tracking info here]\n\nIf you need anything else, feel free to reply to this ticket.',
      category: 'Shipping',
      scope: 'shared',
      usageCount: 19,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'canned-demo-5',
      title: 'Closing — Issue Resolved',
      body: 'Hi {{customer.name}},\n\nI\'m glad we could resolve this for you! I\'m marking this ticket as solved.\n\nIf anything else comes up, don\'t hesitate to reach out. Have a great day!\n\nBest,\n{{agent.name}}',
      category: 'General',
      scope: 'shared',
      shortcut: '/close',
      usageCount: 55,
      createdAt: now,
      updatedAt: now,
    },
  ];

  responses.push(...defaults);
  persist();
}

// ---- Public API ----

export function getCannedResponses(filters?: {
  category?: string;
  scope?: 'personal' | 'shared';
  search?: string;
  createdBy?: string;
}): CannedResponse[] {
  ensureDefaults();
  let result = [...responses];
  if (filters?.category) {
    result = result.filter(r => r.category === filters.category);
  }
  if (filters?.scope) {
    result = result.filter(r => r.scope === filters.scope);
  }
  if (filters?.createdBy) {
    result = result.filter(r => r.scope === 'shared' || r.createdBy === filters.createdBy);
  }
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    result = result.filter(r =>
      r.title.toLowerCase().includes(q) || r.body.toLowerCase().includes(q),
    );
  }
  return result.sort((a, b) => b.usageCount - a.usageCount);
}

export function getCannedResponse(id: string): CannedResponse | undefined {
  ensureDefaults();
  return responses.find(r => r.id === id);
}

export function createCannedResponse(input: {
  title: string;
  body: string;
  category?: string;
  scope?: 'personal' | 'shared';
  shortcut?: string;
  createdBy?: string;
}): CannedResponse {
  ensureDefaults();
  const now = new Date().toISOString();
  const cr: CannedResponse = {
    id: `canned-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: input.title,
    body: input.body,
    category: input.category,
    scope: input.scope ?? 'personal',
    shortcut: input.shortcut,
    createdBy: input.createdBy,
    usageCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  responses.push(cr);
  persist();
  return cr;
}

export function updateCannedResponse(
  id: string,
  updates: Partial<Pick<CannedResponse, 'title' | 'body' | 'category' | 'scope' | 'shortcut'>>,
): CannedResponse | null {
  ensureDefaults();
  const idx = responses.findIndex(r => r.id === id);
  if (idx === -1) return null;
  responses[idx] = {
    ...responses[idx],
    ...updates,
    updatedAt: new Date().toISOString(),
  };
  persist();
  return responses[idx];
}

export function deleteCannedResponse(id: string): boolean {
  ensureDefaults();
  const idx = responses.findIndex(r => r.id === id);
  if (idx === -1) return false;
  responses.splice(idx, 1);
  persist();
  return true;
}

export function incrementCannedUsage(id: string): void {
  ensureDefaults();
  const cr = responses.find(r => r.id === id);
  if (cr) {
    cr.usageCount++;
    cr.updatedAt = new Date().toISOString();
    persist();
  }
}
