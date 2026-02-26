import { describe, it, expect } from 'vitest';
import { evaluateBotResponse, initBotSession, processInitialGreeting } from '../runtime';
import type { ChatbotFlow, ChatbotNode, ChatbotSessionState } from '../types';

// ---- Helpers ----

function makeFlow(nodes: Record<string, ChatbotNode>, rootNodeId: string): ChatbotFlow {
  return {
    id: 'flow-1',
    name: 'Test Flow',
    nodes,
    rootNodeId,
    enabled: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function makeState(flowId: string, currentNodeId: string, visited: string[] = []): ChatbotSessionState {
  return {
    flowId,
    currentNodeId,
    visitedNodes: visited,
    variables: {},
  };
}

// ---- Tests ----

describe('initBotSession', () => {
  it('creates initial state pointing to root node', () => {
    const flow = makeFlow({ root: { id: 'root', type: 'message', data: { text: 'Hi' } } }, 'root');
    const state = initBotSession(flow);

    expect(state.flowId).toBe('flow-1');
    expect(state.currentNodeId).toBe('root');
    expect(state.visitedNodes).toEqual([]);
    expect(state.variables).toEqual({});
  });
});

describe('evaluateBotResponse — message nodes', () => {
  it('returns text from a simple message node', () => {
    const flow = makeFlow({
      root: { id: 'root', type: 'message', data: { text: 'Hello!' } },
    }, 'root');
    const state = makeState('flow-1', 'root');

    const result = evaluateBotResponse(flow, state, '');
    expect(result.text).toBe('Hello!');
    expect(result.handoff).toBe(false);
    expect(result.actions).toEqual([]);
  });

  it('chains through multiple message nodes', () => {
    const flow = makeFlow({
      m1: { id: 'm1', type: 'message', data: { text: 'First' }, children: ['m2'] },
      m2: { id: 'm2', type: 'message', data: { text: 'Second' } },
    }, 'm1');
    const state = makeState('flow-1', 'm1');

    const result = evaluateBotResponse(flow, state, '');
    expect(result.text).toBe('First\n\nSecond');
  });
});

describe('evaluateBotResponse — buttons nodes', () => {
  it('presents buttons on first visit', () => {
    const flow = makeFlow({
      m1: { id: 'm1', type: 'message', data: { text: 'Welcome' }, children: ['b1'] },
      b1: {
        id: 'b1',
        type: 'buttons',
        data: {
          text: 'Choose:',
          options: [
            { label: 'Sales', nextNodeId: 's1' },
            { label: 'Support', nextNodeId: 's2' },
          ],
        },
      },
      s1: { id: 's1', type: 'message', data: { text: 'Sales!' } },
      s2: { id: 's2', type: 'message', data: { text: 'Support!' } },
    }, 'm1');

    const state = makeState('flow-1', 'm1');
    const result = evaluateBotResponse(flow, state, '');

    expect(result.text).toBe('Welcome\n\nChoose:');
    expect(result.buttons).toHaveLength(2);
    expect(result.buttons![0].label).toBe('Sales');
    expect(result.newState.currentNodeId).toBe('b1');
  });

  it('matches button selection and advances', () => {
    const flow = makeFlow({
      b1: {
        id: 'b1',
        type: 'buttons',
        data: {
          text: 'Choose:',
          options: [
            { label: 'Sales', nextNodeId: 's1' },
            { label: 'Support', nextNodeId: 's2' },
          ],
        },
      },
      s1: { id: 's1', type: 'message', data: { text: 'Sales team!' } },
      s2: { id: 's2', type: 'message', data: { text: 'Support team!' } },
    }, 'b1');

    // State is at b1 (waiting for input)
    const state = makeState('flow-1', 'b1');
    const result = evaluateBotResponse(flow, state, 'Sales');

    expect(result.text).toBe('Sales team!');
    expect(result.buttons).toBeUndefined();
  });

  it('re-shows buttons on unrecognized input', () => {
    const flow = makeFlow({
      b1: {
        id: 'b1',
        type: 'buttons',
        data: {
          text: 'Choose:',
          options: [{ label: 'Yes', nextNodeId: 'y' }],
        },
      },
      y: { id: 'y', type: 'message', data: { text: 'Great!' } },
    }, 'b1');

    const state = makeState('flow-1', 'b1');
    const result = evaluateBotResponse(flow, state, 'maybe');

    expect(result.text).toBe('Choose:');
    expect(result.buttons).toHaveLength(1);
    expect(result.newState.currentNodeId).toBe('b1');
  });

  it('matches case-insensitively', () => {
    const flow = makeFlow({
      b1: {
        id: 'b1',
        type: 'buttons',
        data: {
          text: 'Choose:',
          options: [{ label: 'Yes', nextNodeId: 'y' }],
        },
      },
      y: { id: 'y', type: 'message', data: { text: 'Great!' } },
    }, 'b1');

    const state = makeState('flow-1', 'b1');
    const result = evaluateBotResponse(flow, state, 'yes');

    expect(result.text).toBe('Great!');
  });
});

describe('evaluateBotResponse — branch nodes', () => {
  it('matches a branch condition', () => {
    const flow = makeFlow({
      br: {
        id: 'br',
        type: 'branch',
        data: {
          field: 'message',
          conditions: [
            { op: 'contains', value: 'billing', nextNodeId: 'billing' },
            { op: 'contains', value: 'technical', nextNodeId: 'tech' },
          ],
          fallbackNodeId: 'default',
        },
      },
      billing: { id: 'billing', type: 'message', data: { text: 'Billing help' } },
      tech: { id: 'tech', type: 'message', data: { text: 'Tech help' } },
      default: { id: 'default', type: 'message', data: { text: 'General help' } },
    }, 'br');

    const state = makeState('flow-1', 'br');
    const result = evaluateBotResponse(flow, state, 'I have a billing question');

    expect(result.text).toBe('Billing help');
  });

  it('falls through to fallback when no condition matches', () => {
    const flow = makeFlow({
      br: {
        id: 'br',
        type: 'branch',
        data: {
          field: 'message',
          conditions: [
            { op: 'equals', value: 'exact', nextNodeId: 'exact' },
          ],
          fallbackNodeId: 'fallback',
        },
      },
      exact: { id: 'exact', type: 'message', data: { text: 'Exact' } },
      fallback: { id: 'fallback', type: 'message', data: { text: 'Fallback' } },
    }, 'br');

    const state = makeState('flow-1', 'br');
    const result = evaluateBotResponse(flow, state, 'something else');

    expect(result.text).toBe('Fallback');
  });

  it('supports starts_with operator', () => {
    const flow = makeFlow({
      br: {
        id: 'br',
        type: 'branch',
        data: {
          field: 'message',
          conditions: [{ op: 'starts_with', value: 'hi', nextNodeId: 'greet' }],
        },
      },
      greet: { id: 'greet', type: 'message', data: { text: 'Hello!' } },
    }, 'br');

    const state = makeState('flow-1', 'br');
    const result = evaluateBotResponse(flow, state, 'Hi there');

    expect(result.text).toBe('Hello!');
  });
});

describe('evaluateBotResponse — action nodes', () => {
  it('collects actions and advances to child', () => {
    const flow = makeFlow({
      a1: {
        id: 'a1',
        type: 'action',
        data: { actionType: 'set_tag', value: 'vip' },
        children: ['m1'],
      },
      m1: { id: 'm1', type: 'message', data: { text: 'Tagged!' } },
    }, 'a1');

    const state = makeState('flow-1', 'a1');
    const result = evaluateBotResponse(flow, state, '');

    expect(result.actions).toEqual([{ actionType: 'set_tag', value: 'vip' }]);
    expect(result.text).toBe('Tagged!');
  });

  it('chains multiple actions', () => {
    const flow = makeFlow({
      a1: {
        id: 'a1',
        type: 'action',
        data: { actionType: 'set_tag', value: 'urgent' },
        children: ['a2'],
      },
      a2: {
        id: 'a2',
        type: 'action',
        data: { actionType: 'assign', value: 'admin@test.com' },
        children: ['m1'],
      },
      m1: { id: 'm1', type: 'message', data: { text: 'Done' } },
    }, 'a1');

    const state = makeState('flow-1', 'a1');
    const result = evaluateBotResponse(flow, state, '');

    expect(result.actions).toHaveLength(2);
    expect(result.actions[0].actionType).toBe('set_tag');
    expect(result.actions[1].actionType).toBe('assign');
  });
});

describe('evaluateBotResponse — handoff nodes', () => {
  it('returns handoff with message', () => {
    const flow = makeFlow({
      h: {
        id: 'h',
        type: 'handoff',
        data: { message: 'Connecting you now...' },
      },
    }, 'h');

    const state = makeState('flow-1', 'h');
    const result = evaluateBotResponse(flow, state, '');

    expect(result.text).toBe('Connecting you now...');
    expect(result.handoff).toBe(true);
    expect(result.newState.currentNodeId).toBe('');
  });
});

describe('evaluateBotResponse — edge cases', () => {
  it('handles missing node gracefully', () => {
    const flow = makeFlow({}, 'nonexistent');
    const state = makeState('flow-1', 'nonexistent');
    const result = evaluateBotResponse(flow, state, '');

    expect(result.text).toBeUndefined();
    expect(result.handoff).toBe(false);
  });

  it('handles empty currentNodeId', () => {
    const flow = makeFlow({ m: { id: 'm', type: 'message', data: { text: 'Hi' } } }, 'm');
    const state = makeState('flow-1', '');
    const result = evaluateBotResponse(flow, state, '');

    expect(result.text).toBeUndefined();
  });
});

describe('processInitialGreeting', () => {
  it('processes from root and returns greeting', () => {
    const flow = makeFlow({
      root: { id: 'root', type: 'message', data: { text: 'Welcome!' }, children: ['b1'] },
      b1: {
        id: 'b1',
        type: 'buttons',
        data: {
          text: 'How can I help?',
          options: [{ label: 'Sales', nextNodeId: 's1' }],
        },
      },
      s1: { id: 's1', type: 'message', data: { text: 'Sales!' } },
    }, 'root');

    const result = processInitialGreeting(flow);

    expect(result.text).toBe('Welcome!\n\nHow can I help?');
    expect(result.buttons).toHaveLength(1);
    expect(result.newState.currentNodeId).toBe('b1');
  });
});
