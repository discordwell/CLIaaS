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

  return resolveOverlappingMatches(matches);
}

/**
 * Collapse redundant overlapping matches.
 *
 * Different patterns frequently match the same span — e.g. "A12345678" matches
 * both the passport (`[A-Z]\d{8}`) and driver's-license (`[A-Z]\d{7,8}`) rules.
 * Reporting both produces duplicate detection rows and, once masked, garbled
 * output. We keep only matches that are not fully contained within another
 * (larger / higher-confidence) match. Partially-overlapping and disjoint
 * matches are preserved so masking never leaves part of a span exposed.
 */
function resolveOverlappingMatches(matches: PiiMatch[]): PiiMatch[] {
  if (matches.length <= 1) return matches;

  // Dominant matches first: widest span, then highest confidence.
  const ranked = [...matches].sort((a, b) => {
    const lenA = a.end - a.start;
    const lenB = b.end - b.start;
    if (lenB !== lenA) return lenB - lenA;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.start - b.start;
  });

  const kept: PiiMatch[] = [];
  for (const m of ranked) {
    const contained = kept.some(k => m.start >= k.start && m.end <= k.end);
    if (!contained) kept.push(m);
  }

  // Restore positional ordering for a stable, predictable result.
  return kept.sort((a, b) => a.start - b.start || a.end - b.end);
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

/**
 * Apply masking to text, replacing all matches with masked values.
 *
 * Overlapping or duplicate matches are merged into a single coverage region
 * before replacement, so redaction never leaves a fragment of one match exposed
 * (a PII leak) or produces garbled output from compounding offset shifts. The
 * highest-confidence match in a region supplies the redaction label.
 *
 * Pass `styleFor` to choose a masking style per match (e.g. from per-type
 * sensitivity rules); otherwise the single `style` argument applies to all.
 */
export function maskText(
  text: string,
  matches: PiiMatch[],
  style: MaskingStyle = 'full',
  styleFor?: (match: PiiMatch) => MaskingStyle,
): string {
  if (matches.length === 0) return text;

  // Merge overlapping/duplicate spans into contiguous coverage regions.
  const sorted = [...matches].sort((a, b) => a.start - b.start || a.end - b.end);
  const regions: Array<{ start: number; end: number; rep: PiiMatch }> = [];
  for (const m of sorted) {
    const last = regions[regions.length - 1];
    if (last && m.start < last.end) {
      if (m.end > last.end) last.end = m.end;
      if (m.confidence > last.rep.confidence) last.rep = m;
    } else {
      regions.push({ start: m.start, end: m.end, rep: m });
    }
  }

  // Replace from end to start so earlier offsets stay valid.
  let result = text;
  for (let i = regions.length - 1; i >= 0; i--) {
    const r = regions[i];
    const st = styleFor ? styleFor(r.rep) : style;
    const masked = maskMatch(text.slice(r.start, r.end), r.rep.piiType, st);
    result = result.slice(0, r.start) + masked + result.slice(r.end);
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
