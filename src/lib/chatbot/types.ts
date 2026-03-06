/**
 * Core types for the no-code chatbot builder.
 *
 * A chatbot flow is a tree of nodes. Each node has a type that determines
 * its behavior (send a message, show buttons, branch on conditions, etc.).
 * The runtime walks the tree from the root, evaluating one node at a time.
 */

// ---- Node types ----

export type ChatbotNodeType =
  | 'message'
  | 'buttons'
  | 'branch'
  | 'action'
  | 'handoff'
  | 'ai_response'
  | 'article_suggest'
  | 'collect_input'
  | 'webhook'
  | 'delay';

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
  field: 'message' | 'email' | 'name' | string;
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

export interface AiResponseNodeData {
  systemPrompt: string;
  useRag?: boolean;
  ragCollections?: string[];
  maxTokens?: number;
  fallbackNodeId?: string;
}

export interface ArticleSuggestNodeData {
  query?: string;
  maxArticles?: number;
  noResultsNodeId?: string;
}

export interface CollectInputNodeData {
  prompt: string;
  variable: string;
  validation?: 'email' | 'phone' | 'number' | 'none';
  errorMessage?: string;
}

export interface WebhookNodeData {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  bodyTemplate?: string;
  responseVariable?: string;
  failureNodeId?: string;
}

export interface DelayNodeData {
  seconds: number;
}

export type ChatbotNodeData =
  | MessageNodeData
  | ButtonsNodeData
  | BranchNodeData
  | ActionNodeData
  | HandoffNodeData
  | AiResponseNodeData
  | ArticleSuggestNodeData
  | CollectInputNodeData
  | WebhookNodeData
  | DelayNodeData;

export interface ChatbotNode {
  id: string;
  type: ChatbotNodeType;
  data: ChatbotNodeData;
  /** For message/action nodes: the next node to advance to. */
  children?: string[];
  /** Visual position in the flow canvas. */
  position?: { x: number; y: number };
}

// ---- Flow ----

export type ChatbotStatus = 'draft' | 'published' | 'archived';
export type ChatbotChannel = 'web' | 'email' | 'api' | 'sdk';

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
  version?: number;
  status?: ChatbotStatus;
  channels?: ChatbotChannel[];
  description?: string;
}

export interface ChatbotVersion {
  id: string;
  chatbotId: string;
  version: number;
  flow: { nodes: ChatbotFlow['nodes']; rootNodeId: string };
  summary?: string;
  createdBy?: string;
  createdAt: string;
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

export interface AiResponseRequest {
  systemPrompt: string;
  useRag?: boolean;
  ragCollections?: string[];
  maxTokens?: number;
  fallbackNodeId?: string;
}

export interface ArticleSuggestRequest {
  query: string;
  maxArticles: number;
  noResultsNodeId?: string;
}

export interface WebhookRequest {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  bodyTemplate?: string;
  responseVariable?: string;
  failureNodeId?: string;
}

export interface CollectInputRequest {
  prompt: string;
  variable: string;
  validation?: 'email' | 'phone' | 'number' | 'none';
  errorMessage?: string;
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
  /** Delay in seconds before auto-advancing. */
  delay?: number;
  /** AI response request (fulfilled by API route). */
  aiRequest?: AiResponseRequest;
  /** Article suggestion request (fulfilled by API route). */
  articleRequest?: ArticleSuggestRequest;
  /** Webhook request (fulfilled by API route). */
  webhookRequest?: WebhookRequest;
  /** Collect input request (waiting for validated user input). */
  collectInput?: CollectInputRequest;
}
