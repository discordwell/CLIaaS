/**
 * Role-based PII masking middleware.
 * Determines what data is visible based on the requesting user's role.
 */

type UserRole = 'owner' | 'admin' | 'agent' | 'light_agent' | 'collaborator' | 'viewer' | 'system' | 'unknown';

/** Roles that should see masked PII by default. */
const MASKED_ROLES: Set<UserRole> = new Set(['light_agent', 'viewer', 'collaborator', 'unknown']);

/** Roles that get full access (but access is logged). */
const FULL_ACCESS_ROLES: Set<UserRole> = new Set(['owner', 'admin', 'agent', 'system']);

/** Check whether PII should be masked for a given role. */
export function shouldMaskForRole(role: UserRole): boolean {
  return MASKED_ROLES.has(role);
}

/** Check whether the role has full PII access. */
export function hasFullPiiAccess(role: UserRole): boolean {
  return FULL_ACCESS_ROLES.has(role);
}

/** Apply role-based masking to a message record. */
export function applyMessageMasking(
  message: { body: string; bodyRedacted?: string | null; hasPii?: boolean | null },
  role: UserRole,
): { body: string; hasPii: boolean } {
  const hasPii = message.hasPii ?? false;

  if (!hasPii || !shouldMaskForRole(role)) {
    return { body: message.body, hasPii };
  }

  // Use the pre-computed redacted body if available
  if (message.bodyRedacted) {
    return { body: message.bodyRedacted, hasPii };
  }

  // Fallback: return original (no redacted version available)
  return { body: message.body, hasPii };
}

/** Apply role-based masking to a ticket record. */
export function applyTicketMasking(
  ticket: {
    subject: string;
    description?: string | null;
    customerEmail?: string | null;
    hasPii?: boolean | null;
  },
  role: UserRole,
): {
  subject: string;
  description: string | null;
  customerEmail: string | null;
  hasPii: boolean;
} {
  const hasPii = ticket.hasPii ?? false;

  if (!hasPii || !shouldMaskForRole(role)) {
    return {
      subject: ticket.subject,
      description: ticket.description ?? null,
      customerEmail: ticket.customerEmail ?? null,
      hasPii,
    };
  }

  // For masked roles, hide email
  return {
    subject: ticket.subject,
    description: ticket.description ?? null,
    customerEmail: ticket.customerEmail ? maskEmail(ticket.customerEmail) : null,
    hasPii,
  };
}

/** Apply role-based masking to a customer record. */
export function applyCustomerMasking(
  customer: {
    name: string;
    email?: string | null;
    phone?: string | null;
  },
  role: UserRole,
): {
  name: string;
  email: string | null;
  phone: string | null;
} {
  if (!shouldMaskForRole(role)) {
    return {
      name: customer.name,
      email: customer.email ?? null,
      phone: customer.phone ?? null,
    };
  }

  return {
    name: customer.name,
    email: customer.email ? maskEmail(customer.email) : null,
    phone: customer.phone ? maskPhone(customer.phone) : null,
  };
}

function maskEmail(email: string): string {
  const atIndex = email.indexOf('@');
  if (atIndex <= 0) return '[REDACTED-EMAIL]';
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex);
  if (local.length <= 2) return '**' + domain;
  return local[0] + '***' + local.slice(-1) + domain;
}

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '[REDACTED-PHONE]';
  return '***-***-' + digits.slice(-4);
}
