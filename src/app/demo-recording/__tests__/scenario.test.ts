import { describe, it, expect } from 'vitest';
import { scenario, estimateDuration } from '../scenario';

describe('scenario', () => {
  it('all steps have valid types', () => {
    const validTypes = ['user-input', 'response', 'pause'];
    for (const step of scenario) {
      expect(validTypes).toContain(step.type);
    }
  });

  it('user inputs have non-empty text', () => {
    const userInputs = scenario.filter((s) => s.type === 'user-input');
    expect(userInputs.length).toBeGreaterThan(0);
    for (const step of userInputs) {
      if (step.type === 'user-input') {
        expect(step.text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('response steps have at least one line', () => {
    const responses = scenario.filter((s) => s.type === 'response');
    expect(responses.length).toBeGreaterThan(0);
    for (const step of responses) {
      if (step.type === 'response') {
        expect(step.lines.length).toBeGreaterThan(0);
      }
    }
  });

  it('estimated total duration is 25-35 seconds at 1× speed', () => {
    const duration = estimateDuration(scenario, 1);
    const seconds = duration / 1000;
    expect(seconds).toBeGreaterThanOrEqual(25);
    expect(seconds).toBeLessThanOrEqual(35);
  });

  it('has 5 turns (3 original + 2 new)', () => {
    const userInputs = scenario.filter((s) => s.type === 'user-input');
    // Turn 5 is a continuation (no user input), so we expect 4 user inputs
    expect(userInputs.length).toBe(4);
  });

  it('speed parameter scales duration', () => {
    const normal = estimateDuration(scenario, 1);
    const double = estimateDuration(scenario, 2);
    // At 2× speed, duration should be roughly half
    expect(double).toBeCloseTo(normal / 2, -2);
  });
});
