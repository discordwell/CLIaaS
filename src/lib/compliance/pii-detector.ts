/**
 * Comprehensive PII detection engine for the compliance module.
 * Supports 10 PII types with regex detection, confidence scoring, and text masking.
 */

export type PiiType =
  | 'ssn'
  | 'credit_card'
  | 'phone'
  | 'email'
  | 'address'
  | 'dob'
  | 'medical_id'
  | 'passport'
  | 'drivers_license'
  | 'custom';

export type MaskingStyle = 'full' | 'partial' | 'hash';

export interface PiiMatch {
  piiType: PiiType;
  text: string;
  start: number;
  end: number;
  confidence: number;
  method: 'regex' | 'ai' | 'manual';
}

export interface PiiSensitivityRule {
  piiType: PiiType;
  enabled: boolean;
  autoRedact: boolean;
  customPattern?: string;
  maskingStyle: MaskingStyle;
}

// SSN: xxx-xx-xxxx (exclude 000/666/9xx area numbers)
const SSN_PATTERN = /\b(?!000|666|9\d{2})\d{3}-\d{2}-\d{4}\b/g;

// Credit card: 13-19 digits optionally grouped
const CC_PATTERN = /\b(?:\d{4}[-\s]?){3,4}\d{1,4}\b/g;

// Phone (US): various formats
const PHONE_PATTERN = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;

// Email: RFC 5322 simplified
const EMAIL_PATTERN = /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;

// US address: number + street name + suffix
const ADDRESS_PATTERN = /\b\d{1,5}\s+\w+(?:\s+\w+)?\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Lane|Ln|Court|Ct|Place|Pl|Way|Circle|Cir|Terrace|Ter)\b/gi;

// Date of birth: MM/DD/YYYY
const DOB_PATTERN = /\b(?:0[1-9]|1[0-2])\/(?:0[1-9]|[12]\d|3[01])\/(?:19|20)\d{2}\b/g;

// Passport (US): letter + 8 digits
const PASSPORT_PATTERN = /\b[A-Z]\d{8}\b/g;

// Driver's license: common state formats
const DRIVERS_LICENSE_PATTERN = /\b[A-Z]\d{7,8}\b/g;

// Medical ID: common health plan formats (letter prefix + digits)
const MEDICAL_ID_PATTERN = /\b(?:MRN|MED|HIC|HICN|MBI)[-\s]?[A-Z0-9]{6,12}\b/gi;

// API keys / tokens
const API_KEY_PATTERN = /\b(?:sk|pk|api|key|token|secret|bearer)[-_]?[a-zA-Z0-9_-]{20,}\b/gi;

const PATTERNS: Record<Exclude<PiiType, 'custom'>, RegExp> = {
  ssn: SSN_PATTERN,
  credit_card: CC_PATTERN,
  phone: PHONE_PATTERN,
  email: EMAIL_PATTERN,
  address: ADDRESS_PATTERN,
  dob: DOB_PATTERN,
  medical_id: MEDICAL_ID_PATTERN,
  passport: PASSPORT_PATTERN,
  drivers_license: DRIVERS_LICENSE_PATTERN,
};

const CONFIDENCE: Record<Exclude<PiiType, 'custom'>, number> = {
  ssn: 0.95,
  credit_card: 0.98,
  phone: 0.80,
  email: 0.99,
  address: 0.70,
  dob: 0.85,
  medical_id: 0.85,
  passport: 0.75,
  drivers_license: 0.70,
};

/** Luhn algorithm for credit card validation. */
export function validateLuhn(cardNumber: string): boolean {
  const nums = cardNumber.replace(/\D/g, '');
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

/** Detect PII in text using regex patterns, respecting workspace sensitivity rules. */
export function detectPiiRegex(text: string, rules?: PiiSensitivityRule[]): PiiMatch[] {
  const matches: PiiMatch[] = [];
  const enabledTypes = new Set<PiiType>();

  if (rules && rules.length > 0) {
    for (const rule of rules) {
      if (rule.enabled) enabledTypes.add(rule.piiType);
    }
  } else {
    // Default: all built-in types enabled
    for (const t of Object.keys(PATTERNS) as PiiType[]) {
      enabledTypes.add(t);
    }
  }

  // Built-in patterns
  for (const [type, pattern] of Object.entries(PATTERNS) as [Exclude<PiiType, 'custom'>, RegExp][]) {
    if (!enabledTypes.has(type)) continue;
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const matchText = match[0];
      const start = match.index!;

      // Credit card: validate with Luhn
      if (type === 'credit_card') {
        const digits = matchText.replace(/\D/g, '');
        if (digits.length < 13 || digits.length > 19 || !validateLuhn(digits)) continue;
      }

      // SSN: exclude obvious non-SSNs
      if (type === 'ssn') {
        const cleaned = matchText.replace(/\D/g, '');
        if (cleaned === '000000000') continue;
      }

      matches.push({
        piiType: type,
        text: matchText,
        start,
        end: start + matchText.length,
        confidence: CONFIDENCE[type],
        method: 'regex',
      });
    }
  }

  // API keys (mapped to 'custom' type)
  if (enabledTypes.has('custom')) {
    API_KEY_PATTERN.lastIndex = 0;
    for (const match of text.matchAll(API_KEY_PATTERN)) {
      matches.push({
        piiType: 'custom',
        text: match[0],
        start: match.index!,
        end: match.index! + match[0].length,
        confidence: 0.90,
        method: 'regex',
      });
    }
  }

  // Custom patterns from rules
  if (rules) {
    for (const rule of rules) {
      if (!rule.enabled || !rule.customPattern) continue;
      // Reject patterns that are too long (ReDoS mitigation)
      if (rule.customPattern.length > 200) continue;
      try {
        const custom = new RegExp(rule.customPattern, 'g');
        for (const match of text.matchAll(custom)) {
          matches.push({
            piiType: rule.piiType,
            text: match[0],
            start: match.index!,
            end: match.index! + match[0].length,
            confidence: 0.80,
            method: 'regex',
          });
        }
      } catch {
        // Invalid custom regex — skip
      }
    }
  }

  return matches;
}

/** Full PII detection pipeline (regex, optionally AI in future). */
export async function detectPii(
  text: string,
  rules?: PiiSensitivityRule[],
): Promise<PiiMatch[]> {
  return detectPiiRegex(text, rules);
}

/** Mask a single match according to the masking style. */
function maskMatch(matchText: string, piiType: PiiType, style: MaskingStyle): string {
  const label = piiType.toUpperCase().replace('_', '-');
  switch (style) {
    case 'full':
      return `[REDACTED-${label}]`;
    case 'partial': {
      const keepLast = piiType === 'credit_card' ? 4 : piiType === 'ssn' ? 4 : 2;
      if (matchText.length <= keepLast) return `[REDACTED-${label}]`;
      return '***' + matchText.slice(-keepLast);
    }
    case 'hash':
      return `[HASH-${label}]`;
    default:
      return `[REDACTED-${label}]`;
  }
}

/** Apply masking to text, replacing all matches with masked values. */
export function maskText(text: string, matches: PiiMatch[], style: MaskingStyle = 'full'): string {
  if (matches.length === 0) return text;

  // Sort by start position descending so we can replace from end to start
  const sorted = [...matches].sort((a, b) => b.start - a.start);
  let result = text;
  for (const m of sorted) {
    const masked = maskMatch(m.text, m.piiType, style);
    result = result.slice(0, m.start) + masked + result.slice(m.end);
  }
  return result;
}

/** Get the default set of sensitivity rules (all enabled, no auto-redact). */
export function getDefaultRules(): PiiSensitivityRule[] {
  const types: PiiType[] = ['ssn', 'credit_card', 'phone', 'email', 'address', 'dob', 'medical_id', 'passport', 'drivers_license', 'custom'];
  return types.map(piiType => ({
    piiType,
    enabled: true,
    autoRedact: false,
    maskingStyle: 'full' as MaskingStyle,
  }));
}
