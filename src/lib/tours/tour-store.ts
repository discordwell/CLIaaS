/**
 * Product tour store — JSONL-backed in-memory storage for product tours and progress.
 */

import { readJsonlFile, writeJsonlFile } from '../jsonl-store';

// ---- Types ----

export type TourStepPlacement = 'top' | 'bottom' | 'left' | 'right' | 'center';

export interface ProductTour {
  id: string;
  workspaceId?: string;
  name: string;
  description?: string;
  targetUrlPattern: string;
  segmentQuery: Record<string, unknown>;
  isActive: boolean;
  priority: number;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProductTourStep {
  id: string;
  tourId: string;
  workspaceId?: string;
  position: number;
  targetSelector: string;
  title: string;
  body: string;
  placement: TourStepPlacement;
  highlightTarget: boolean;
  actionLabel: string;
  createdAt: string;
}

export interface ProductTourProgress {
  id: string;
  tourId: string;
  workspaceId?: string;
  customerId: string;
  currentStep: number;
  status: 'in_progress' | 'completed' | 'dismissed';
  startedAt: string;
  completedAt?: string;
}

// ---- JSONL persistence ----

const TOURS_FILE = 'product-tours.jsonl';
const TOUR_STEPS_FILE = 'product-tour-steps.jsonl';
const TOUR_PROGRESS_FILE = 'product-tour-progress.jsonl';

const tours: ProductTour[] = [];
const tourSteps: ProductTourStep[] = [];
const tourProgress: ProductTourProgress[] = [];

function persistTours(): void { writeJsonlFile(TOURS_FILE, tours); }
function persistTourSteps(): void { writeJsonlFile(TOUR_STEPS_FILE, tourSteps); }
function persistTourProgress(): void { writeJsonlFile(TOUR_PROGRESS_FILE, tourProgress); }

let loaded = false;
function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  tours.push(...readJsonlFile<ProductTour>(TOURS_FILE));
  tourSteps.push(...readJsonlFile<ProductTourStep>(TOUR_STEPS_FILE));
  tourProgress.push(...readJsonlFile<ProductTourProgress>(TOUR_PROGRESS_FILE));

  if (tours.length === 0) {
    const now = new Date().toISOString();
    const demoTour: ProductTour = {
      id: 'tour-demo-1',
      name: 'Getting Started with CLIaaS',
      description: 'A quick tour of the main features',
      targetUrlPattern: '/dashboard*',
      segmentQuery: {},
      isActive: true,
      priority: 10,
      createdAt: now,
      updatedAt: now,
    };
    tours.push(demoTour);
    tourSteps.push(
      { id: 'ts-demo-1', tourId: 'tour-demo-1', position: 0, targetSelector: '[data-tour="tickets"]', title: 'Your Tickets', body: 'View and manage all customer tickets here.', placement: 'bottom', highlightTarget: true, actionLabel: 'Next', createdAt: now },
      { id: 'ts-demo-2', tourId: 'tour-demo-1', position: 1, targetSelector: '[data-tour="analytics"]', title: 'Analytics', body: 'Track team performance and customer satisfaction.', placement: 'bottom', highlightTarget: true, actionLabel: 'Got it', createdAt: now },
    );
    persistTours();
    persistTourSteps();
  }
}

// ---- Tour CRUD ----

export function getTours(workspaceId?: string): ProductTour[] {
  ensureLoaded();
  return tours
    .filter(t => !workspaceId || !t.workspaceId || t.workspaceId === workspaceId)
    .sort((a, b) => b.priority - a.priority);
}

export function getTour(id: string, workspaceId?: string): ProductTour | undefined {
  ensureLoaded();
  const tour = tours.find(t => t.id === id);
  if (!tour) return undefined;
  if (workspaceId && tour.workspaceId && tour.workspaceId !== workspaceId) return undefined;
  return tour;
}

export function createTour(
  input: Pick<ProductTour, 'name'> & Partial<Pick<ProductTour, 'description' | 'targetUrlPattern' | 'segmentQuery' | 'priority' | 'createdBy'>>,
  workspaceId?: string,
): ProductTour {
  ensureLoaded();
  const now = new Date().toISOString();
  const tour: ProductTour = {
    id: `tour-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId,
    name: input.name,
    description: input.description,
    targetUrlPattern: input.targetUrlPattern ?? '*',
    segmentQuery: input.segmentQuery ?? {},
    isActive: false,
    priority: input.priority ?? 0,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };
  tours.push(tour);
  persistTours();
  return tour;
}

export function updateTour(id: string, updates: Partial<Omit<ProductTour, 'id' | 'createdAt'>>, workspaceId?: string): ProductTour | null {
  ensureLoaded();
  const idx = tours.findIndex(t => t.id === id && (!workspaceId || !t.workspaceId || t.workspaceId === workspaceId));
  if (idx === -1) return null;
  tours[idx] = { ...tours[idx], ...updates, updatedAt: new Date().toISOString() };
  persistTours();
  return tours[idx];
}

export function deleteTour(id: string, workspaceId?: string): boolean {
  ensureLoaded();
  const idx = tours.findIndex(t => t.id === id && (!workspaceId || !t.workspaceId || t.workspaceId === workspaceId));
  if (idx === -1) return false;
  tours.splice(idx, 1);
  // Remove associated steps and progress
  for (let i = tourSteps.length - 1; i >= 0; i--) {
    if (tourSteps[i].tourId === id) tourSteps.splice(i, 1);
  }
  for (let i = tourProgress.length - 1; i >= 0; i--) {
    if (tourProgress[i].tourId === id) tourProgress.splice(i, 1);
  }
  persistTours();
  persistTourSteps();
  persistTourProgress();
  return true;
}

export function toggleTour(id: string, workspaceId?: string): ProductTour | null {
  ensureLoaded();
  const tour = getTour(id, workspaceId);
  if (!tour) return null;
  return updateTour(id, { isActive: !tour.isActive }, workspaceId);
}

// ---- Tour Steps CRUD ----

export function getTourSteps(tourId: string): ProductTourStep[] {
  ensureLoaded();
  return tourSteps.filter(s => s.tourId === tourId).sort((a, b) => a.position - b.position);
}

export function addTourStep(
  input: Pick<ProductTourStep, 'tourId' | 'targetSelector' | 'title'> & Partial<Pick<ProductTourStep, 'body' | 'placement' | 'highlightTarget' | 'actionLabel'>>,
  workspaceId?: string,
): ProductTourStep {
  ensureLoaded();
  const existing = getTourSteps(input.tourId);
  const step: ProductTourStep = {
    id: `ts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tourId: input.tourId,
    workspaceId,
    position: existing.length,
    targetSelector: input.targetSelector,
    title: input.title,
    body: input.body ?? '',
    placement: input.placement ?? 'bottom',
    highlightTarget: input.highlightTarget ?? true,
    actionLabel: input.actionLabel ?? 'Next',
    createdAt: new Date().toISOString(),
  };
  tourSteps.push(step);
  persistTourSteps();
  return step;
}

export function updateTourStep(stepId: string, updates: Partial<Omit<ProductTourStep, 'id' | 'tourId' | 'createdAt'>>): ProductTourStep | null {
  ensureLoaded();
  const idx = tourSteps.findIndex(s => s.id === stepId);
  if (idx === -1) return null;
  tourSteps[idx] = { ...tourSteps[idx], ...updates };
  persistTourSteps();
  return tourSteps[idx];
}

export function deleteTourStep(stepId: string): boolean {
  ensureLoaded();
  const idx = tourSteps.findIndex(s => s.id === stepId);
  if (idx === -1) return false;
  tourSteps.splice(idx, 1);
  persistTourSteps();
  return true;
}

export function reorderTourSteps(tourId: string, stepIds: string[]): ProductTourStep[] {
  ensureLoaded();
  for (let i = 0; i < stepIds.length; i++) {
    const idx = tourSteps.findIndex(s => s.id === stepIds[i] && s.tourId === tourId);
    if (idx !== -1) tourSteps[idx] = { ...tourSteps[idx], position: i };
  }
  persistTourSteps();
  return getTourSteps(tourId);
}

// ---- Tour Progress ----

export function getTourProgress(tourId: string, customerId: string): ProductTourProgress | undefined {
  ensureLoaded();
  return tourProgress.find(p => p.tourId === tourId && p.customerId === customerId);
}

export function upsertTourProgress(
  tourId: string,
  customerId: string,
  updates: Partial<Pick<ProductTourProgress, 'currentStep' | 'status' | 'completedAt'>>,
  workspaceId?: string,
): ProductTourProgress {
  ensureLoaded();
  const idx = tourProgress.findIndex(p => p.tourId === tourId && p.customerId === customerId);
  if (idx !== -1) {
    tourProgress[idx] = { ...tourProgress[idx], ...updates };
    persistTourProgress();
    return tourProgress[idx];
  }
  const progress: ProductTourProgress = {
    id: `tp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tourId,
    workspaceId,
    customerId,
    currentStep: updates.currentStep ?? 0,
    status: updates.status ?? 'in_progress',
    startedAt: new Date().toISOString(),
    completedAt: updates.completedAt,
  };
  tourProgress.push(progress);
  persistTourProgress();
  return progress;
}
