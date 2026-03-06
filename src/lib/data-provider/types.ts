/**
 * DataProvider — tier-agnostic data access interface.
 *
 * Every data consumer (MCP tools, CLI commands, Web API routes) goes through
 * a DataProvider. The factory (`getDataProvider()`) returns the right
 * implementation based on the configured mode:
 *   - local  → JsonlProvider (BYOC / demo)
 *   - db     → DbProvider    (Hosted or local Postgres)
 *   - remote → RemoteProvider (Hosted, MCP pointing at CLIaaS API)
 *   - hybrid → HybridProvider (local DB + outbox for push to hosted)
 */

// ---- Canonical read types ----

export type TicketSource = 'zendesk' | 'kayako' | 'kayako-classic' | 'helpcrunch' | 'freshdesk' | 'groove' | 'intercom' | 'helpscout' | 'zoho-desk' | 'hubspot';
export type TicketStatus = 'open' | 'pending' | 'on_hold' | 'solved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Ticket {
  id: string;
  externalId: string;
  source: TicketSource;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority;
  assignee?: string;
  groupId?: string;
  brandId?: string;
  ticketFormId?: string;
  requester: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  customFields?: Record<string, unknown>;
  mergedIntoTicketId?: string;
  splitFromTicketId?: string;
}

export interface Message {
  id: string;
  ticketId: string;
  author: string;
  body: string;
  type: 'reply' | 'note' | 'system';
  visibility?: 'public' | 'internal';
  createdAt: string;
}

export type KBVisibility = 'public' | 'internal' | 'draft';

export interface KBArticle {
  id: string;
  externalId?: string;
  source?: TicketSource;
  title: string;
  body: string;
  categoryPath: string[];
  status?: string;
  updatedAt?: string;
  locale?: string;
  parentArticleId?: string;
  brandId?: string;
  visibility?: KBVisibility;
  slug?: string;
  metaTitle?: string;
  metaDescription?: string;
  seoKeywords?: string[];
  position?: number;
  helpfulCount?: number;
  notHelpfulCount?: number;
  viewCount?: number;
  createdAt?: string;
}

export interface Customer {
  id: string;
  name: string;
  email: string;
  source: string;
  createdAt?: string;
  // Customer 360 enrichment
  phone?: string;
  customAttributes?: Record<string, unknown>;
  avatarUrl?: string;
  locale?: string;
  timezone?: string;
  lastSeenAt?: string;
  browser?: string;
  os?: string;
  ipAddress?: string;
  signupDate?: string;
  plan?: string;
}

export interface Organization {
  id: string;
  name: string;
  source: string;
}

export interface RuleRecord {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  conditions: unknown;
  actions: unknown;
  source?: string;
}

export interface CSATRating {
  ticketId: string;
  rating: number;
  createdAt: string;
}

// ---- Survey types ----

export type SurveyType = 'csat' | 'nps' | 'ces';
export type SurveyTrigger = 'ticket_solved' | 'ticket_closed' | 'manual';

export interface SurveyResponse {
  id: string;
  ticketId?: string;
  customerId?: string;
  surveyType: SurveyType;
  rating: number | null;
  comment?: string;
  token?: string;
  createdAt: string;
}

export interface SurveyConfig {
  id: string;
  workspaceId: string;
  surveyType: SurveyType;
  enabled: boolean;
  trigger: SurveyTrigger;
  delayMinutes: number;
  question?: string;
}

export interface SurveyResponseCreateParams {
  ticketId?: string;
  customerId?: string;
  surveyType: SurveyType;
  rating?: number;
  comment?: string;
  token?: string;
}

export interface SurveyConfigUpdateParams {
  surveyType: SurveyType;
  enabled?: boolean;
  trigger?: SurveyTrigger;
  delayMinutes?: number;
  question?: string;
}

// ---- Write parameter types ----

export interface TicketCreateParams {
  subject: string;
  description?: string;
  priority?: string;
  requester?: string;
  tags?: string[];
  source?: string;
}

export interface TicketUpdateParams {
  status?: string;
  priority?: string;
  subject?: string;
  assignee?: string;
  addTags?: string[];
  removeTags?: string[];
}

export interface MessageCreateParams {
  ticketId: string;
  body: string;
  authorType?: 'user' | 'customer' | 'system' | 'bot';
  authorId?: string;
  visibility?: 'public' | 'internal';
}

export interface KBArticleCreateParams {
  title: string;
  body: string;
  categoryPath?: string[];
  status?: string;
  locale?: string;
  parentArticleId?: string;
  brandId?: string;
  visibility?: KBVisibility;
  slug?: string;
  metaTitle?: string;
  metaDescription?: string;
}

export interface KBArticleFeedbackParams {
  articleId: string;
  helpful: boolean;
  sessionId?: string;
  customerId?: string;
  comment?: string;
}

export interface KBArticleFeedbackRecord {
  id: string;
  articleId: string;
  helpful: boolean;
  comment?: string;
  sessionId?: string;
  customerId?: string;
  createdAt: string;
}

// ---- Ticket Merge & Split types ----

export interface TicketMergeParams {
  primaryTicketId: string;
  mergedTicketIds: string[];
  mergedBy?: string;
}

export interface TicketMergeResult {
  primaryTicketId: string;
  mergedCount: number;
  movedMessageCount: number;
  mergedTags: string[];
  mergeLogIds: string[];
}

export interface TicketSplitParams {
  ticketId: string;
  messageIds: string[];
  newSubject?: string;
  splitBy?: string;
}

export interface TicketSplitResult {
  sourceTicketId: string;
  newTicketId: string;
  movedMessageCount: number;
  splitLogId: string;
}

export interface TicketUnmergeParams {
  mergeLogId: string;
  unmergedBy?: string;
}

export interface MergeHistoryEntry {
  id: string;
  type: 'merge' | 'split';
  primaryTicketId?: string;
  mergedTicketId?: string;
  sourceTicketId?: string;
  newTicketId?: string;
  movedMessageIds: string[];
  undone: boolean;
  createdAt: string;
}

// ---- Provider mode & capabilities ----

export type DataMode = 'local' | 'db' | 'remote' | 'hybrid';

export interface ProviderCapabilities {
  mode: DataMode;
  supportsWrite: boolean;
  supportsSync: boolean;
  supportsRag: boolean;
}

// ---- DataProvider interface ----

export interface DataProvider {
  readonly capabilities: ProviderCapabilities;

  // Reads
  loadTickets(): Promise<Ticket[]>;
  loadMessages(ticketId?: string): Promise<Message[]>;
  /** Load messages created after `since`. Optional — falls back to loadMessages + filter. */
  loadMessagesSince?(ticketId: string, since: Date): Promise<Message[]>;
  loadKBArticles(): Promise<KBArticle[]>;
  loadCustomers(): Promise<Customer[]>;
  loadOrganizations(): Promise<Organization[]>;
  loadRules(): Promise<RuleRecord[]>;
  loadCSATRatings(): Promise<CSATRating[]>;

  // Surveys
  loadSurveyResponses(type?: SurveyType): Promise<SurveyResponse[]>;
  loadSurveyConfigs(): Promise<SurveyConfig[]>;
  createSurveyResponse(params: SurveyResponseCreateParams): Promise<{ id: string }>;
  updateSurveyConfig(params: SurveyConfigUpdateParams): Promise<void>;

  // Writes (throw if not supported)
  createTicket(params: TicketCreateParams): Promise<{ id: string }>;
  updateTicket(ticketId: string, params: TicketUpdateParams): Promise<void>;
  createMessage(params: MessageCreateParams): Promise<{ id: string }>;
  createKBArticle(params: KBArticleCreateParams): Promise<{ id: string }>;

  // KB i18n & Feedback
  loadKBArticleTranslations?(articleId: string): Promise<KBArticle[]>;
  createKBArticleFeedback?(params: KBArticleFeedbackParams): Promise<{ id: string }>;
  loadKBArticleFeedback?(articleId: string): Promise<KBArticleFeedbackRecord[]>;

  // Merge & Split
  mergeTickets(params: TicketMergeParams): Promise<TicketMergeResult>;
  splitTicket(params: TicketSplitParams): Promise<TicketSplitResult>;
  unmergeTicket(params: TicketUnmergeParams): Promise<void>;
  getMergeHistory(ticketId: string): Promise<MergeHistoryEntry[]>;
}
