/**
 * Community Forums JSONL store.
 *
 * In-memory arrays backed by JSONL files using the shared jsonl-store helpers.
 * Demo data is seeded on first load when no persisted data exists.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';

// ---- Types ----

export interface ForumCategory {
  id: string;
  workspaceId?: string;
  name: string;
  description?: string;
  slug: string;
  position: number;
  createdAt: string;
}

export interface ForumThread {
  id: string;
  workspaceId?: string;
  categoryId: string;
  customerId?: string;
  title: string;
  body: string;
  status: 'open' | 'closed' | 'pinned';
  isPinned: boolean;
  viewCount: number;
  replyCount: number;
  lastActivityAt: string;
  convertedTicketId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ForumReply {
  id: string;
  workspaceId?: string;
  threadId: string;
  customerId?: string;
  body: string;
  isBestAnswer: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---- JSONL persistence ----

const CATEGORIES_FILE = 'forums-categories.jsonl';
const THREADS_FILE = 'forums-threads.jsonl';
const REPLIES_FILE = 'forums-replies.jsonl';

const categories: ForumCategory[] = [];
const threads: ForumThread[] = [];
const replies: ForumReply[] = [];

function persistCategories(): void {
  writeJsonlFile(CATEGORIES_FILE, categories);
}

function persistThreads(): void {
  writeJsonlFile(THREADS_FILE, threads);
}

function persistReplies(): void {
  writeJsonlFile(REPLIES_FILE, replies);
}

// ---- Demo defaults ----

let defaultsLoaded = false;

function ensureDefaults(): void {
  if (defaultsLoaded) return;
  defaultsLoaded = true;

  const savedCategories = readJsonlFile<ForumCategory>(CATEGORIES_FILE);
  const savedThreads = readJsonlFile<ForumThread>(THREADS_FILE);
  const savedReplies = readJsonlFile<ForumReply>(REPLIES_FILE);

  if (savedCategories.length > 0) {
    categories.push(...savedCategories);
    threads.push(...savedThreads);
    replies.push(...savedReplies);
    return;
  }

  // Seed demo data
  const now = new Date();

  categories.push(
    {
      id: 'fcat-1',
      name: 'General Discussion',
      description: 'Open discussion about anything related to our platform.',
      slug: 'general-discussion',
      position: 0,
      createdAt: new Date(now.getTime() - 14 * 86400000).toISOString(),
    },
    {
      id: 'fcat-2',
      name: 'Feature Requests',
      description: 'Suggest and vote on new features.',
      slug: 'feature-requests',
      position: 1,
      createdAt: new Date(now.getTime() - 14 * 86400000).toISOString(),
    },
  );

  threads.push(
    {
      id: 'ft-1',
      categoryId: 'fcat-1',
      customerId: 'customer-1',
      title: 'Welcome to the community forums!',
      body: 'This is the official community forum. Feel free to introduce yourself and share your experience with our platform.',
      status: 'pinned',
      isPinned: true,
      viewCount: 42,
      replyCount: 2,
      lastActivityAt: new Date(now.getTime() - 86400000).toISOString(),
      createdAt: new Date(now.getTime() - 10 * 86400000).toISOString(),
      updatedAt: new Date(now.getTime() - 86400000).toISOString(),
    },
    {
      id: 'ft-2',
      categoryId: 'fcat-1',
      customerId: 'customer-2',
      title: 'Best practices for ticket management?',
      body: 'I am looking for tips on how to organize and manage tickets efficiently. What workflows do you use?',
      status: 'open',
      isPinned: false,
      viewCount: 18,
      replyCount: 2,
      lastActivityAt: new Date(now.getTime() - 2 * 86400000).toISOString(),
      createdAt: new Date(now.getTime() - 5 * 86400000).toISOString(),
      updatedAt: new Date(now.getTime() - 2 * 86400000).toISOString(),
    },
    {
      id: 'ft-3',
      categoryId: 'fcat-2',
      customerId: 'customer-3',
      title: 'Request: dark mode for the dashboard',
      body: 'It would be great to have a dark mode option for the admin dashboard. Anyone else interested?',
      status: 'open',
      isPinned: false,
      viewCount: 31,
      replyCount: 1,
      lastActivityAt: new Date(now.getTime() - 3 * 86400000).toISOString(),
      createdAt: new Date(now.getTime() - 7 * 86400000).toISOString(),
      updatedAt: new Date(now.getTime() - 3 * 86400000).toISOString(),
    },
  );

  replies.push(
    {
      id: 'fr-1',
      threadId: 'ft-1',
      customerId: 'customer-2',
      body: 'Thanks for setting this up! Looking forward to engaging with the community.',
      isBestAnswer: false,
      createdAt: new Date(now.getTime() - 8 * 86400000).toISOString(),
      updatedAt: new Date(now.getTime() - 8 * 86400000).toISOString(),
    },
    {
      id: 'fr-2',
      threadId: 'ft-1',
      customerId: 'customer-3',
      body: 'Great initiative! Happy to be here.',
      isBestAnswer: false,
      createdAt: new Date(now.getTime() - 86400000).toISOString(),
      updatedAt: new Date(now.getTime() - 86400000).toISOString(),
    },
    {
      id: 'fr-3',
      threadId: 'ft-2',
      customerId: 'customer-1',
      body: 'We use tags and automation rules to route tickets automatically. Works really well for categorization.',
      isBestAnswer: true,
      createdAt: new Date(now.getTime() - 3 * 86400000).toISOString(),
      updatedAt: new Date(now.getTime() - 3 * 86400000).toISOString(),
    },
    {
      id: 'fr-4',
      threadId: 'ft-2',
      customerId: 'customer-3',
      body: 'SLA policies help too. Set deadlines based on priority and let the system alert you.',
      isBestAnswer: false,
      createdAt: new Date(now.getTime() - 2 * 86400000).toISOString(),
      updatedAt: new Date(now.getTime() - 2 * 86400000).toISOString(),
    },
    {
      id: 'fr-5',
      threadId: 'ft-3',
      customerId: 'customer-1',
      body: 'Definitely interested! Would love a dark mode option.',
      isBestAnswer: false,
      createdAt: new Date(now.getTime() - 3 * 86400000).toISOString(),
      updatedAt: new Date(now.getTime() - 3 * 86400000).toISOString(),
    },
  );
}

// ---- Category CRUD ----

export function getCategories(): ForumCategory[] {
  ensureDefaults();
  return [...categories].sort((a, b) => a.position - b.position);
}

export function createCategory(
  input: Omit<ForumCategory, 'id' | 'createdAt'>,
): ForumCategory {
  ensureDefaults();
  const category: ForumCategory = {
    ...input,
    id: `fcat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  categories.push(category);
  persistCategories();
  return category;
}

export function updateCategory(
  id: string,
  input: Partial<Omit<ForumCategory, 'id' | 'createdAt'>>,
): ForumCategory | null {
  ensureDefaults();
  const idx = categories.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  categories[idx] = { ...categories[idx], ...input };
  persistCategories();
  return categories[idx];
}

export function deleteCategory(id: string): boolean {
  ensureDefaults();
  const idx = categories.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  // Remove orphaned threads and their replies
  const threadIds = threads.filter(t => t.categoryId === id).map(t => t.id);
  for (let i = replies.length - 1; i >= 0; i--) {
    if (threadIds.includes(replies[i].threadId)) replies.splice(i, 1);
  }
  for (let i = threads.length - 1; i >= 0; i--) {
    if (threads[i].categoryId === id) threads.splice(i, 1);
  }
  categories.splice(idx, 1);
  persistCategories();
  if (threadIds.length > 0) {
    persistThreads();
    persistReplies();
  }
  return true;
}

// ---- Thread CRUD ----

export function getThreads(categoryId?: string): ForumThread[] {
  ensureDefaults();
  let result = [...threads];
  if (categoryId) {
    result = result.filter((t) => t.categoryId === categoryId);
  }
  // Pinned first, then by lastActivityAt desc
  return result.sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
  });
}

export function getThread(id: string): ForumThread | null {
  ensureDefaults();
  return threads.find((t) => t.id === id) ?? null;
}

export function createThread(
  input: Omit<ForumThread, 'id' | 'viewCount' | 'replyCount' | 'lastActivityAt' | 'createdAt' | 'updatedAt'>,
): ForumThread {
  ensureDefaults();
  const now = new Date().toISOString();
  const thread: ForumThread = {
    ...input,
    id: `ft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    viewCount: 0,
    replyCount: 0,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
  };
  threads.push(thread);
  persistThreads();
  return thread;
}

export function moderateThread(
  id: string,
  action: 'close' | 'pin' | 'unpin',
): ForumThread | null {
  ensureDefaults();
  const idx = threads.findIndex((t) => t.id === id);
  if (idx === -1) return null;

  const now = new Date().toISOString();
  switch (action) {
    case 'close':
      threads[idx] = { ...threads[idx], status: 'closed', updatedAt: now };
      break;
    case 'pin':
      threads[idx] = { ...threads[idx], status: 'pinned', isPinned: true, updatedAt: now };
      break;
    case 'unpin':
      threads[idx] = { ...threads[idx], status: 'open', isPinned: false, updatedAt: now };
      break;
  }

  persistThreads();
  return threads[idx];
}

export function convertToTicket(
  threadId: string,
  ticketId: string,
): ForumThread | null {
  ensureDefaults();
  const idx = threads.findIndex((t) => t.id === threadId);
  if (idx === -1) return null;

  threads[idx] = {
    ...threads[idx],
    convertedTicketId: ticketId,
    updatedAt: new Date().toISOString(),
  };

  persistThreads();
  return threads[idx];
}

// ---- Reply CRUD ----

export function getReplies(threadId: string): ForumReply[] {
  ensureDefaults();
  return replies
    .filter((r) => r.threadId === threadId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export function createReply(
  input: Omit<ForumReply, 'id' | 'isBestAnswer' | 'createdAt' | 'updatedAt'>,
): ForumReply {
  ensureDefaults();
  const now = new Date().toISOString();
  const reply: ForumReply = {
    ...input,
    id: `fr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    isBestAnswer: false,
    createdAt: now,
    updatedAt: now,
  };
  replies.push(reply);

  // Update thread reply count and last activity
  const threadIdx = threads.findIndex((t) => t.id === input.threadId);
  if (threadIdx !== -1) {
    threads[threadIdx] = {
      ...threads[threadIdx],
      replyCount: threads[threadIdx].replyCount + 1,
      lastActivityAt: now,
      updatedAt: now,
    };
    persistThreads();
  }

  persistReplies();
  return reply;
}

export function markBestAnswer(replyId: string): ForumReply | null {
  ensureDefaults();
  const idx = replies.findIndex((r) => r.id === replyId);
  if (idx === -1) return null;

  // Unmark any existing best answer in the same thread
  const threadId = replies[idx].threadId;
  for (let i = 0; i < replies.length; i++) {
    if (replies[i].threadId === threadId && replies[i].isBestAnswer) {
      replies[i] = { ...replies[i], isBestAnswer: false };
    }
  }

  replies[idx] = {
    ...replies[idx],
    isBestAnswer: true,
    updatedAt: new Date().toISOString(),
  };

  persistReplies();
  return replies[idx];
}
