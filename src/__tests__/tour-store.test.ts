import { describe, it, expect, beforeEach } from 'vitest';

describe('Tour Store', () => {
  let store: typeof import('../lib/tours/tour-store');

  beforeEach(async () => {
    store = await import('../lib/tours/tour-store');
  });

  it('getTours returns demo tours', async () => {
    const tours = await store.getTours();
    expect(tours.length).toBeGreaterThanOrEqual(1);
    expect(tours[0].name).toBeTruthy();
  });

  it('createTour creates a new tour', () => {
    const tour = store.createTour({ name: 'Test Tour', targetUrlPattern: '/test*' });
    expect(tour.id).toBeTruthy();
    expect(tour.name).toBe('Test Tour');
    expect(tour.isActive).toBe(false);
    expect(tour.targetUrlPattern).toBe('/test*');
  });

  it('getTour returns tour by id', async () => {
    const created = store.createTour({ name: 'Find Me' });
    const found = await store.getTour(created.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Find Me');
  });

  it('updateTour updates fields', () => {
    const tour = store.createTour({ name: 'Update Me' });
    const updated = store.updateTour(tour.id, { name: 'Updated Name', priority: 99 });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('Updated Name');
    expect(updated!.priority).toBe(99);
  });

  it('toggleTour flips isActive', async () => {
    const tour = store.createTour({ name: 'Toggle Me' });
    expect(tour.isActive).toBe(false);
    const toggled = await store.toggleTour(tour.id);
    expect(toggled!.isActive).toBe(true);
    const toggledBack = await store.toggleTour(tour.id);
    expect(toggledBack!.isActive).toBe(false);
  });

  it('deleteTour removes tour and associated steps', async () => {
    const tour = store.createTour({ name: 'Delete Me' });
    await store.addTourStep({ tourId: tour.id, targetSelector: '.test', title: 'Step 1' });
    expect((await store.getTourSteps(tour.id)).length).toBe(1);
    const deleted = store.deleteTour(tour.id);
    expect(deleted).toBe(true);
    expect(await store.getTour(tour.id)).toBeUndefined();
    expect((await store.getTourSteps(tour.id)).length).toBe(0);
  });

  it('addTourStep adds steps with auto-incrementing position', async () => {
    const tour = store.createTour({ name: 'Steps Tour' });
    const s1 = await store.addTourStep({ tourId: tour.id, targetSelector: '.a', title: 'A' });
    const s2 = await store.addTourStep({ tourId: tour.id, targetSelector: '.b', title: 'B' });
    expect(s1.position).toBe(0);
    expect(s2.position).toBe(1);
  });

  it('updateTourStep updates step fields', async () => {
    const tour = store.createTour({ name: 'Step Update Tour' });
    const step = await store.addTourStep({ tourId: tour.id, targetSelector: '.old', title: 'Old' });
    const updated = store.updateTourStep(step.id, { title: 'New', targetSelector: '.new' });
    expect(updated!.title).toBe('New');
    expect(updated!.targetSelector).toBe('.new');
  });

  it('deleteTourStep removes a step', async () => {
    const tour = store.createTour({ name: 'Del Step Tour' });
    const step = await store.addTourStep({ tourId: tour.id, targetSelector: '.x', title: 'X' });
    expect(store.deleteTourStep(step.id)).toBe(true);
    expect((await store.getTourSteps(tour.id)).length).toBe(0);
  });

  it('reorderTourSteps reorders steps', async () => {
    const tour = store.createTour({ name: 'Reorder Tour' });
    const s1 = await store.addTourStep({ tourId: tour.id, targetSelector: '.a', title: 'A' });
    const s2 = await store.addTourStep({ tourId: tour.id, targetSelector: '.b', title: 'B' });
    const reordered = await store.reorderTourSteps(tour.id, [s2.id, s1.id]);
    expect(reordered[0].id).toBe(s2.id);
    expect(reordered[0].position).toBe(0);
    expect(reordered[1].id).toBe(s1.id);
    expect(reordered[1].position).toBe(1);
  });

  it('upsertTourProgress creates and updates progress', () => {
    const tour = store.createTour({ name: 'Progress Tour' });
    const p1 = store.upsertTourProgress(tour.id, 'cust-1', { currentStep: 0, status: 'in_progress' });
    expect(p1.customerId).toBe('cust-1');
    expect(p1.currentStep).toBe(0);

    const p2 = store.upsertTourProgress(tour.id, 'cust-1', { currentStep: 1 });
    expect(p2.id).toBe(p1.id); // Same record updated
    expect(p2.currentStep).toBe(1);
  });

  it('getTourProgress returns progress for customer', async () => {
    const tour = store.createTour({ name: 'Get Progress Tour' });
    store.upsertTourProgress(tour.id, 'cust-2', { currentStep: 2, status: 'completed' });
    const progress = await store.getTourProgress(tour.id, 'cust-2');
    expect(progress).toBeDefined();
    expect(progress!.currentStep).toBe(2);
    expect(progress!.status).toBe('completed');
  });
});
