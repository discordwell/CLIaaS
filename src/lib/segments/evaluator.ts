/**
 * Segment evaluation engine — evaluates segmentQuery JSONB against customer data.
 * Supports in-memory (JSONL) mode. DB mode deferred to future iteration.
 */

// ---- Types ----

export type SegmentOperator =
  | 'eq' | 'neq'
  | 'gt' | 'gte' | 'lt' | 'lte'
  | 'contains' | 'not_contains'
  | 'in' | 'not_in'
  | 'exists' | 'not_exists';

export interface SegmentCondition {
  field: string;
  operator: SegmentOperator;
  value?: unknown;
}

export interface SegmentQuery {
  combinator?: 'and' | 'or';
  conditions?: SegmentCondition[];
  groups?: SegmentQuery[];
}

export interface EvaluableCustomer {
  id: string;
  email?: string;
  name?: string;
  plan?: string;
  locale?: string;
  timezone?: string;
  signupDate?: string;
  lastSeenAt?: string;
  tags?: string[];
  customAttributes?: Record<string, unknown>;
  ticketCount?: number;
  lastTicketAt?: string;
  totalSpend?: number;
  [key: string]: unknown;
}

// ---- Evaluation ----

function getFieldValue(customer: EvaluableCustomer, field: string): unknown {
  if (field.startsWith('customAttributes.')) {
    const attrKey = field.slice('customAttributes.'.length);
    return customer.customAttributes?.[attrKey];
  }
  return customer[field];
}

function evaluateCondition(customer: EvaluableCustomer, condition: SegmentCondition): boolean {
  const { field, operator, value } = condition;
  const fieldValue = getFieldValue(customer, field);

  switch (operator) {
    case 'eq':
      return fieldValue === value;
    case 'neq':
      return fieldValue !== value;
    case 'gt':
      return typeof fieldValue === 'number' && typeof value === 'number'
        ? fieldValue > value
        : String(fieldValue) > String(value);
    case 'gte':
      return typeof fieldValue === 'number' && typeof value === 'number'
        ? fieldValue >= value
        : String(fieldValue) >= String(value);
    case 'lt':
      return typeof fieldValue === 'number' && typeof value === 'number'
        ? fieldValue < value
        : String(fieldValue) < String(value);
    case 'lte':
      return typeof fieldValue === 'number' && typeof value === 'number'
        ? fieldValue <= value
        : String(fieldValue) <= String(value);
    case 'contains': {
      if (Array.isArray(fieldValue)) {
        return fieldValue.includes(value);
      }
      if (typeof fieldValue === 'string' && typeof value === 'string') {
        return fieldValue.includes(value);
      }
      return false;
    }
    case 'not_contains': {
      if (Array.isArray(fieldValue)) {
        return !fieldValue.includes(value);
      }
      if (typeof fieldValue === 'string' && typeof value === 'string') {
        return !fieldValue.includes(value);
      }
      return true;
    }
    case 'in':
      return Array.isArray(value) && value.includes(fieldValue);
    case 'not_in':
      return Array.isArray(value) && !value.includes(fieldValue);
    case 'exists':
      return fieldValue !== undefined && fieldValue !== null;
    case 'not_exists':
      return fieldValue === undefined || fieldValue === null;
    default:
      return false;
  }
}

/**
 * Evaluate a SegmentQuery against a single customer.
 * Returns true if the customer matches the query.
 */
export function evaluateCustomer(customer: EvaluableCustomer, query: SegmentQuery): boolean {
  if (!query) return true;

  const combinator = query.combinator ?? 'and';
  const results: boolean[] = [];

  if (query.conditions) {
    for (const condition of query.conditions) {
      results.push(evaluateCondition(customer, condition));
    }
  }

  if (query.groups) {
    for (const group of query.groups) {
      results.push(evaluateCustomer(customer, group));
    }
  }

  if (results.length === 0) return true;

  return combinator === 'and'
    ? results.every(Boolean)
    : results.some(Boolean);
}

/**
 * Evaluate a segment query against a list of customers.
 * Returns matching customers.
 */
export function evaluateSegment(
  customers: EvaluableCustomer[],
  query: SegmentQuery,
): EvaluableCustomer[] {
  if (!query || (!query.conditions?.length && !query.groups?.length)) {
    return customers;
  }
  return customers.filter(c => evaluateCustomer(c, query));
}

/**
 * Evaluate and return count + sample of matching customers.
 */
export function evaluateSegmentWithStats(
  customers: EvaluableCustomer[],
  query: SegmentQuery,
  sampleSize = 5,
): { count: number; total: number; sample: EvaluableCustomer[] } {
  const matching = evaluateSegment(customers, query);
  return {
    count: matching.length,
    total: customers.length,
    sample: matching.slice(0, sampleSize),
  };
}
