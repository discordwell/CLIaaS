/**
 * Core types for the no-code chatbot builder.
 *
 * A chatbot flow is a tree of nodes. Each node has a type that determines
 * its behavior (send a message, show buttons, branch on conditions, etc.).
 * The runtime walks the tree from the root, evaluating one node at a time.
 */

// ---- Node types ----

export type ChatbotNodeType = 'message' | 'buttons' | 'branch' | 'action' | 'handoff';

export interface MessageNodeData {
  text: string;
}

export interface ButtonOption {
  label: string;
  nextNodeId: string;
}

export interface ButtonsNodeData {
  text: string;
  options: ButtonOption[];
}

export interface BranchCondition {
  op: 'contains' | 'equals' | 'starts_with' | 'ends_with' | 'matches';
  value: string;
  nextNodeId: string;
}

export interface BranchNodeData {
  field: 'message' | 'email' | 'name';
  conditions: BranchCondition[];
  fallbackNodeId?: string;
}

export type ActionType = 'set_tag' | 'create_ticket' | 'assign' | 'close';

export interface ActionNodeData {
  actionType: ActionType;
  value?: string;
}

export interface HandoffNodeData {
  message: string;
}

export type ChatbotNodeData =
  | MessageNodeData
  | ButtonsNodeData
  | BranchNodeData
  | ActionNodeData
  | HandoffNodeData;

export interface ChatbotNode {
  id: string;
  type: ChatbotNodeType;
  data: ChatbotNodeData;
  /** For message/action nodes: the next node to advance to. */
  children?: string[];
}

// ---- Flow ----

export interface ChatbotFlow {
  id: string;
  name: string;
  /** Map of nodeId → ChatbotNode. */
  nodes: Record<string, ChatbotNode>;
  rootNodeId: string;
  enabled: boolean;
  greeting?: string;
  createdAt: string;
  updatedAt: string;
}

// ---- Runtime state (stored on ChatSession) ----

export interface ChatbotSessionState {
  flowId: string;
  currentNodeId: string;
  /** Track visited nodes to detect loops. */
  visitedNodes: string[];
  /** Variables collected during the flow (e.g. from branch evaluations). */
  variables: Record<string, string>;
}

// ---- Runtime response ----

export interface BotAction {
  actionType: ActionType;
  value?: string;
}

export interface BotResponse {
  /** Text message to send to the customer. */
  text?: string;
  /** Button options to display (for buttons nodes). */
  buttons?: ButtonOption[];
  /** Whether to hand off to a human agent. */
  handoff: boolean;
  /** Actions to execute (set tag, create ticket, etc.). */
  actions: BotAction[];
  /** Updated session state. */
  newState: ChatbotSessionState;
}
