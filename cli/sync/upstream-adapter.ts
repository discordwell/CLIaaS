/**
 * ConnectorWriteAdapter — unified interface for pushing changes to source platforms.
 *
 * Each connector adapter normalizes its platform-specific write functions
 * (create ticket, update ticket, post reply, add note) behind this interface.
 */

/** Normalized ticket update payload. */
export interface UpstreamTicketUpdate {
  status?: string;
  priority?: string;
  assignee?: string;
  tags?: string[];
}

/** Normalized new ticket payload. */
export interface UpstreamTicketCreate {
  subject: string;
  description: string;
  priority?: string;
  requester?: string;
  tags?: string[];
}

/** Normalized reply payload. */
export interface UpstreamReply {
  body: string;
}

/** Normalized note payload. */
export interface UpstreamNote {
  body: string;
}

/** Result from creating a ticket on the external platform. */
export interface UpstreamCreateResult {
  externalId: string;
}

/**
 * Unified write adapter interface.
 *
 * Connectors that don't support certain operations set the corresponding
 * `supports*` flag to false. Calling an unsupported method throws.
 */
export interface ConnectorWriteAdapter {
  /** Connector name (e.g. 'zendesk', 'freshdesk'). */
  name: string;

  /** Whether this connector supports updateTicket. */
  supportsUpdate: boolean;

  /** Whether this connector supports postReply. */
  supportsReply: boolean;

  /** Update a ticket's status, priority, assignee, or tags on the platform. */
  updateTicket(externalId: string, updates: UpstreamTicketUpdate): Promise<void>;

  /** Post a public reply to a ticket/conversation. */
  postReply(externalId: string, reply: UpstreamReply): Promise<void>;

  /** Add an internal note to a ticket/conversation. */
  postNote(externalId: string, note: UpstreamNote): Promise<void>;

  /** Create a new ticket on the platform. */
  createTicket(ticket: UpstreamTicketCreate): Promise<UpstreamCreateResult>;
}
