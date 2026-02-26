/**
 * Chatbot runtime engine — pure functions that walk a chatbot flow tree.
 *
 * Given a flow, the current session state, and a customer message,
 * evaluateBotResponse() returns the bot's response (text, buttons, actions)
 * and the updated session state.
 */

import type {
  ChatbotFlow,
  ChatbotSessionState,
  ChatbotNode,
  BotResponse,
  BotAction,
  ButtonOption,
  MessageNodeData,
  ButtonsNodeData,
  BranchNodeData,
  ActionNodeData,
  HandoffNodeData,
} from './types';

const MAX_CHAIN_DEPTH = 20;

/**
 * Initialize a new bot session for a flow.
 */
export function initBotSession(flow: ChatbotFlow): ChatbotSessionState {
  return {
    flowId: flow.id,
    currentNodeId: flow.rootNodeId,
    visitedNodes: [],
    variables: {},
  };
}

/**
 * Evaluate the bot's response to a customer message.
 *
 * The engine processes nodes in a chain: message/action nodes auto-advance
 * to their first child. The chain stops when we hit a node that requires
 * customer input (buttons), a terminal node (handoff/no children), or
 * exceed the chain depth limit.
 */
export function evaluateBotResponse(
  flow: ChatbotFlow,
  state: ChatbotSessionState,
  customerMessage: string,
): BotResponse {
  const result: BotResponse = {
    handoff: false,
    actions: [],
    newState: { ...state, visitedNodes: [...state.visitedNodes] },
  };

  let currentNodeId = state.currentNodeId;
  let depth = 0;

  while (currentNodeId && depth < MAX_CHAIN_DEPTH) {
    depth++;
    const node = flow.nodes[currentNodeId];
    if (!node) break;

    // Loop detection
    if (result.newState.visitedNodes.includes(currentNodeId) && node.type !== 'buttons') {
      // Allow revisiting buttons nodes (user might circle back), but not others
      break;
    }
    result.newState.visitedNodes.push(currentNodeId);

    switch (node.type) {
      case 'message': {
        const data = node.data as MessageNodeData;
        result.text = result.text ? `${result.text}\n\n${data.text}` : data.text;
        // Auto-advance to first child
        currentNodeId = node.children?.[0] ?? '';
        if (!currentNodeId) {
          // Terminal message node — no more nodes to process
          result.newState.currentNodeId = '';
        }
        continue;
      }

      case 'buttons': {
        const data = node.data as ButtonsNodeData;

        // If we're arriving at a buttons node for the first time (no prior visit),
        // present the options and wait for input
        const isWaitingForInput = state.currentNodeId === currentNodeId;
        if (!isWaitingForInput) {
          // First arrival: show buttons and stop
          result.text = result.text ? `${result.text}\n\n${data.text}` : data.text;
          result.buttons = data.options;
          result.newState.currentNodeId = currentNodeId;
          return result;
        }

        // We're re-evaluating after customer input — match their message to an option
        const match = data.options.find(
          (opt) => opt.label.toLowerCase() === customerMessage.toLowerCase(),
        );
        if (match) {
          currentNodeId = match.nextNodeId;
          result.newState.variables['lastChoice'] = match.label;
        } else {
          // No match — re-show buttons
          result.text = data.text;
          result.buttons = data.options;
          result.newState.currentNodeId = currentNodeId;
          return result;
        }
        continue;
      }

      case 'branch': {
        const data = node.data as BranchNodeData;
        const fieldValue = getBranchFieldValue(data.field, customerMessage, result.newState);

        let matched = false;
        for (const cond of data.conditions) {
          if (evaluateBranchCondition(cond.op, fieldValue, cond.value)) {
            currentNodeId = cond.nextNodeId;
            matched = true;
            break;
          }
        }

        if (!matched) {
          currentNodeId = data.fallbackNodeId ?? '';
        }

        if (!currentNodeId) {
          result.newState.currentNodeId = '';
        }
        continue;
      }

      case 'action': {
        const data = node.data as ActionNodeData;
        const action: BotAction = { actionType: data.actionType };
        if (data.value) action.value = data.value;
        result.actions.push(action);

        // Auto-advance to first child
        currentNodeId = node.children?.[0] ?? '';
        if (!currentNodeId) {
          result.newState.currentNodeId = '';
        }
        continue;
      }

      case 'handoff': {
        const data = node.data as HandoffNodeData;
        result.text = result.text ? `${result.text}\n\n${data.message}` : data.message;
        result.handoff = true;
        result.newState.currentNodeId = '';
        return result;
      }

      default:
        break;
    }

    break;
  }

  result.newState.currentNodeId = currentNodeId;
  return result;
}

/**
 * Process the initial greeting when a chatbot flow starts.
 * Walks from the root node and collects messages/buttons until
 * user input is needed.
 */
export function processInitialGreeting(flow: ChatbotFlow): BotResponse {
  const state = initBotSession(flow);
  // Use empty string as customer message since there's no input yet
  return evaluateBotResponse(flow, state, '');
}

// ---- Helpers ----

function getBranchFieldValue(
  field: string,
  customerMessage: string,
  state: ChatbotSessionState,
): string {
  switch (field) {
    case 'message':
      return customerMessage;
    case 'email':
      return state.variables['email'] ?? '';
    case 'name':
      return state.variables['name'] ?? '';
    default:
      return state.variables[field] ?? '';
  }
}

function evaluateBranchCondition(op: string, fieldValue: string, condValue: string): boolean {
  const a = fieldValue.toLowerCase();
  const b = condValue.toLowerCase();

  switch (op) {
    case 'contains':
      return a.includes(b);
    case 'equals':
      return a === b;
    case 'starts_with':
      return a.startsWith(b);
    case 'ends_with':
      return a.endsWith(b);
    case 'matches': {
      try {
        return new RegExp(condValue, 'i').test(fieldValue);
      } catch {
        return false;
      }
    }
    default:
      return false;
  }
}
