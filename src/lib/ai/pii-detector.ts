/**
 * PII detector — scans text for personally identifiable information.
 * If PII is found, the AI resolution should be escalated, not sent.
 */

export interface PIIFinding {
  type: 'ssn' | 'credit_card' | 'phone' | 'api_key';
  redacted: string;
}

export interface PIIResult {
  hasPII: boolean;
  findings: PIIFinding[];
}

// SSN: xxx-xx-xxxx or xxxxxxxxx
const SSN_PATTERN = /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g;

// Credit card: 13-19 digits, optionally grouped by 4
const CC_PATTERN = /\b(?:\d{4}[-\s]?){3,4}\d{1,4}\b/g;

// Phone: various US formats (10+ digits with optional country code)
const PHONE_PATTERN = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;

// API keys / tokens: long alphanumeric strings that look like secrets
const API_KEY_PATTERN = /\b(?:sk|pk|api|key|token|secret|bearer)[-_]?[a-zA-Z0-9_-]{20,}\b/gi;

function luhnCheck(digits: string): boolean {
  const nums = digits.replace(/\D/g, '');
  if (nums.length < 13 || nums.length > 19) return false;
  let sum = 0;
  let alternate = false;
  for (let i = nums.length - 1; i >= 0; i--) {
    let n = parseInt(nums[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function redact(value: string, keepLast = 4): string {
  if (value.length <= keepLast) return '***';
  return '***' + value.slice(-keepLast);
}

export function detectPII(text: string): PIIResult {
  const findings: PIIFinding[] = [];

  // SSN detection
  for (const match of text.matchAll(SSN_PATTERN)) {
    const cleaned = match[0].replace(/\D/g, '');
    // Exclude all-zeros or obvious non-SSNs
    if (cleaned === '000000000' || cleaned.startsWith('9')) continue;
    findings.push({ type: 'ssn', redacted: redact(match[0]) });
  }

  // Credit card detection (with Luhn check)
  for (const match of text.matchAll(CC_PATTERN)) {
    const digits = match[0].replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhnCheck(digits)) {
      findings.push({ type: 'credit_card', redacted: redact(match[0]) });
    }
  }

  // Phone number detection
  for (const match of text.matchAll(PHONE_PATTERN)) {
    findings.push({ type: 'phone', redacted: redact(match[0]) });
  }

  // API key / token detection
  for (const match of text.matchAll(API_KEY_PATTERN)) {
    findings.push({ type: 'api_key', redacted: redact(match[0], 6) });
  }

  return { hasPII: findings.length > 0, findings };
}
