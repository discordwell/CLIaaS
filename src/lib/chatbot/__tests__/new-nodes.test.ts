import { describe, it, expect } from 'vitest';
import { evaluateBotResponse, initBotSession } from '../runtime';
import type { ChatbotFlow, ChatbotNode, ChatbotSessionState } from '../types';

function makeFlow(nodes: Record<string, ChatbotNode>, rootNodeId: string): ChatbotFlow {
  return {
    id: 'test-flow',
    name: 'Test',
    nodes,
    rootNodeId,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('collect_input node', () => {
  const nodes: Record<string, ChatbotNode> = {
    root: {
      id: 'root',
      type: 'collect_input',
      data: { prompt: 'Enter your email:', variable: 'email', validation: 'email', errorMessage: 'Invalid email.' },
      children: ['done'],
    },
    done: {
      id: 'done',
      type: 'message',
      data: { text: 'Thanks!' },
    },
  };

  it('shows prompt on first visit (reached via parent)', () => {
    // When collect_input is reached via a parent node, it shows the prompt
    const withParent: Record<string, ChatbotNode> = {
      msg: { id: 'msg', type: 'message', data: { text: 'Welcome' }, children: ['root'] },
      ...nodes,
    };
    const flow = makeFlow(withParent, 'msg');
    const state = initBotSession(flow);
    const resp = evaluateBotResponse(flow, state, '');
    expect(resp.text).toContain('Enter your email:');
    expect(resp.collectInput).toBeDefined();
    expect(resp.collectInput!.variable).toBe('email');
    expect(resp.newState.currentNodeId).toBe('root');
  });

  it('rejects invalid email', () => {
    const flow = makeFlow(nodes, 'root');
    const state: ChatbotSessionState = {
      flowId: 'test-flow',
      currentNodeId: 'root',
      visitedNodes: ['root'],
      variables: {},
    };
    const resp = evaluateBotResponse(flow, state, 'not-an-email');
    expect(resp.text).toBe('Invalid email.');
    expect(resp.newState.currentNodeId).toBe('root');
  });

  it('accepts valid email and advances', () => {
    const flow = makeFlow(nodes, 'root');
    const state: ChatbotSessionState = {
      flowId: 'test-flow',
      currentNodeId: 'root',
      visitedNodes: ['root'],
      variables: {},
    };
    const resp = evaluateBotResponse(flow, state, 'user@example.com');
    expect(resp.newState.variables['email']).toBe('user@example.com');
    expect(resp.text).toBe('Thanks!');
  });

  it('works with no validation', () => {
    const noValNodes: Record<string, ChatbotNode> = {
      root: {
        id: 'root',
        type: 'collect_input',
        data: { prompt: 'What is your name?', variable: 'name', validation: 'none' },
        children: ['done'],
      },
      done: { id: 'done', type: 'message', data: { text: 'Hello!' } },
    };
    const flow = makeFlow(noValNodes, 'root');
    const state: ChatbotSessionState = {
      flowId: 'test-flow',
      currentNodeId: 'root',
      visitedNodes: ['root'],
      variables: {},
    };
    const resp = evaluateBotResponse(flow, state, 'Alice');
    expect(resp.newState.variables['name']).toBe('Alice');
    expect(resp.text).toBe('Hello!');
  });

  it('validates phone numbers', () => {
    const phoneNodes: Record<string, ChatbotNode> = {
      root: {
        id: 'root',
        type: 'collect_input',
        data: { prompt: 'Phone?', variable: 'phone', validation: 'phone' },
        children: ['done'],
      },
      done: { id: 'done', type: 'message', data: { text: 'Got it.' } },
    };
    const flow = makeFlow(phoneNodes, 'root');
    const state: ChatbotSessionState = {
      flowId: 'test-flow',
      currentNodeId: 'root',
      visitedNodes: ['root'],
      variables: {},
    };

    // Invalid
    let resp = evaluateBotResponse(flow, state, 'abc');
    expect(resp.newState.currentNodeId).toBe('root');

    // Valid
    resp = evaluateBotResponse(flow, state, '+1 (555) 123-4567');
    expect(resp.newState.variables['phone']).toBe('+1 (555) 123-4567');
  });
});

describe('delay node', () => {
  it('returns delay seconds and advances', () => {
    const nodes: Record<string, ChatbotNode> = {
      root: {
        id: 'root',
        type: 'delay',
        data: { seconds: 5 },
        children: ['msg'],
      },
      msg: { id: 'msg', type: 'message', data: { text: 'After delay' } },
    };
    const flow = makeFlow(nodes, 'root');
    const state = initBotSession(flow);
    const resp = evaluateBotResponse(flow, state, '');
    expect(resp.delay).toBe(5);
    expect(resp.newState.currentNodeId).toBe('msg');
  });

  it('handles delay with no children', () => {
    const nodes: Record<string, ChatbotNode> = {
      root: { id: 'root', type: 'delay', data: { seconds: 3 } },
    };
    const flow = makeFlow(nodes, 'root');
    const state = initBotSession(flow);
    const resp = evaluateBotResponse(flow, state, '');
    expect(resp.delay).toBe(3);
    expect(resp.newState.currentNodeId).toBe('');
  });
});

describe('ai_response node', () => {
  it('returns aiRequest spec', () => {
    const nodes: Record<string, ChatbotNode> = {
      root: {
        id: 'root',
        type: 'ai_response',
        data: {
          systemPrompt: 'You are a helpful agent.',
          useRag: true,
          maxTokens: 200,
          fallbackNodeId: 'fallback',
        },
        children: ['next'],
      },
      next: { id: 'next', type: 'message', data: { text: 'Done' } },
      fallback: { id: 'fallback', type: 'handoff', data: { message: 'Connecting...' } },
    };
    const flow = makeFlow(nodes, 'root');
    const state = initBotSession(flow);
    const resp = evaluateBotResponse(flow, state, 'Help me');
    expect(resp.aiRequest).toBeDefined();
    expect(resp.aiRequest!.systemPrompt).toBe('You are a helpful agent.');
    expect(resp.aiRequest!.useRag).toBe(true);
    expect(resp.aiRequest!.maxTokens).toBe(200);
    expect(resp.aiRequest!.fallbackNodeId).toBe('fallback');
    expect(resp.newState.currentNodeId).toBe('next');
  });
});

describe('article_suggest node', () => {
  it('returns articleRequest spec', () => {
    const nodes: Record<string, ChatbotNode> = {
      root: {
        id: 'root',
        type: 'article_suggest',
        data: { query: 'password reset', maxArticles: 5, noResultsNodeId: 'noarticles' },
        children: ['next'],
      },
      next: { id: 'next', type: 'message', data: { text: 'Hope that helps!' } },
      noarticles: { id: 'noarticles', type: 'handoff', data: { message: 'No articles found.' } },
    };
    const flow = makeFlow(nodes, 'root');
    const state = initBotSession(flow);
    const resp = evaluateBotResponse(flow, state, '');
    expect(resp.articleRequest).toBeDefined();
    expect(resp.articleRequest!.query).toBe('password reset');
    expect(resp.articleRequest!.maxArticles).toBe(5);
    expect(resp.articleRequest!.noResultsNodeId).toBe('noarticles');
  });

  it('uses customer message as query when not set', () => {
    const nodes: Record<string, ChatbotNode> = {
      root: {
        id: 'root',
        type: 'article_suggest',
        data: { maxArticles: 3 },
        children: [],
      },
    };
    const flow = makeFlow(nodes, 'root');
    const state = initBotSession(flow);
    const resp = evaluateBotResponse(flow, state, 'how to reset password');
    expect(resp.articleRequest!.query).toBe('how to reset password');
  });
});

describe('webhook node', () => {
  it('returns webhookRequest spec', () => {
    const nodes: Record<string, ChatbotNode> = {
      root: {
        id: 'root',
        type: 'webhook',
        data: {
          url: 'https://api.example.com/enrich',
          method: 'POST',
          bodyTemplate: '{"email":"{{email}}"}',
          responseVariable: 'enrichment',
          failureNodeId: 'fail',
        },
        children: ['next'],
      },
      next: { id: 'next', type: 'message', data: { text: 'Enrichment complete' } },
      fail: { id: 'fail', type: 'handoff', data: { message: 'Enrichment failed' } },
    };
    const flow = makeFlow(nodes, 'root');
    const state = initBotSession(flow);
    const resp = evaluateBotResponse(flow, state, '');
    expect(resp.webhookRequest).toBeDefined();
    expect(resp.webhookRequest!.url).toBe('https://api.example.com/enrich');
    expect(resp.webhookRequest!.method).toBe('POST');
    expect(resp.webhookRequest!.responseVariable).toBe('enrichment');
    expect(resp.webhookRequest!.failureNodeId).toBe('fail');
  });
});

describe('mixed flow with new nodes', () => {
  it('collect_input → branch → handoff', () => {
    const nodes: Record<string, ChatbotNode> = {
      greeting: {
        id: 'greeting',
        type: 'message',
        data: { text: 'Welcome!' },
        children: ['collect_email'],
      },
      collect_email: {
        id: 'collect_email',
        type: 'collect_input',
        data: { prompt: 'What is your email?', variable: 'email', validation: 'email' },
        children: ['branch'],
      },
      branch: {
        id: 'branch',
        type: 'branch',
        data: {
          field: 'email',
          conditions: [
            { op: 'ends_with', value: '@bigcorp.com', nextNodeId: 'vip' },
          ],
          fallbackNodeId: 'standard',
        },
      },
      vip: { id: 'vip', type: 'handoff', data: { message: 'VIP customer! Connecting to senior agent.' } },
      standard: { id: 'standard', type: 'handoff', data: { message: 'Connecting to support.' } },
    };
    const flow = makeFlow(nodes, 'greeting');

    // Step 1: greeting + collect email prompt
    const state1 = initBotSession(flow);
    const resp1 = evaluateBotResponse(flow, state1, '');
    expect(resp1.text).toContain('Welcome!');
    expect(resp1.text).toContain('What is your email?');
    expect(resp1.collectInput).toBeDefined();

    // Step 2: submit VIP email
    const resp2 = evaluateBotResponse(flow, resp1.newState, 'ceo@bigcorp.com');
    expect(resp2.newState.variables['email']).toBe('ceo@bigcorp.com');
    expect(resp2.handoff).toBe(true);
    expect(resp2.text).toContain('VIP customer');

    // Step 2 alt: submit standard email
    const resp3 = evaluateBotResponse(flow, resp1.newState, 'user@gmail.com');
    expect(resp3.newState.variables['email']).toBe('user@gmail.com');
    expect(resp3.handoff).toBe(true);
    expect(resp3.text).toContain('Connecting to support');
  });

  it('message → delay → message chain', () => {
    const nodes: Record<string, ChatbotNode> = {
      msg1: {
        id: 'msg1',
        type: 'message',
        data: { text: 'Please wait...' },
        children: ['wait'],
      },
      wait: {
        id: 'wait',
        type: 'delay',
        data: { seconds: 2 },
        children: ['msg2'],
      },
      msg2: {
        id: 'msg2',
        type: 'message',
        data: { text: 'All done!' },
      },
    };
    const flow = makeFlow(nodes, 'msg1');
    const state = initBotSession(flow);
    const resp = evaluateBotResponse(flow, state, '');
    expect(resp.text).toBe('Please wait...');
    expect(resp.delay).toBe(2);
    expect(resp.newState.currentNodeId).toBe('msg2');
  });
});
