/**
 * Secret redaction. Runs before any log text is stored, logged or sent to an LLM.
 *
 * Rules are applied in order: structural patterns (key blocks, URLs, assignments)
 * first, then token shapes, then the entropy fallback. Every match is replaced with
 * `[REDACTED:<type>]`, which keeps line structure intact for the analysis steps.
 */

export interface RedactionRule {
  type: string;
  pattern: RegExp;
  /** Replacement; may use capture groups to keep surrounding context. */
  replace: (match: string, ...groups: string[]) => string;
}

const redact = (type: string) => `[REDACTED:${type}]`;

export const REDACTION_RULES: readonly RedactionRule[] = [
  {
    type: 'private_key',
    pattern: /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g,
    replace: () => redact('private_key'),
  },
  {
    // Credentials inside connection strings: postgres://user:pass@host/db
    type: 'url_credentials',
    pattern: /([a-z][a-z0-9+.-]*:\/\/)([^\s/:@]+):([^\s/@]+)@/gi,
    replace: (_match, scheme = '', user = '') => `${scheme}${user}:${redact('url_credentials')}@`,
  },
  {
    type: 'github_token',
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    replace: () => redact('github_token'),
  },
  {
    type: 'aws_access_key_id',
    pattern: /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA|AGPA|AIDA|AIPA|ANPA|ANVA|AROA)[A-Z0-9]{16}\b/g,
    replace: () => redact('aws_access_key_id'),
  },
  {
    type: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g,
    replace: () => redact('jwt'),
  },
  {
    type: 'slack_token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
    replace: () => redact('slack_token'),
  },
  {
    type: 'npm_token',
    pattern: /\bnpm_[A-Za-z0-9]{30,}\b/g,
    replace: () => redact('npm_token'),
  },
  {
    type: 'api_key',
    pattern: /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/g,
    replace: () => redact('api_key'),
  },
  {
    type: 'bearer_token',
    pattern: /\b([Bb]earer|[Bb]asic|[Tt]oken)\s+(?!\[REDACTED:)([A-Za-z0-9._~+/=-]{12,})/g,
    replace: (_match, scheme = '') => `${scheme} ${redact('bearer_token')}`,
  },
  {
    // password=..., API_KEY: "...", --token ..., token => '...'
    type: 'assigned_secret',
    pattern:
      /\b([A-Za-z0-9_-]*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|auth[_-]?token|credentials?|private[_-]?key)[A-Za-z0-9_-]*)(\s*(?:=>|[:=])\s*|\s+)(["']?)(?!\[REDACTED:)([^\s"'`,;]{4,})\3/gi,
    replace: (_match, key = '', separator = '', quote = '') =>
      `${key}${separator}${quote}${redact('assigned_secret')}${quote}`,
  },
  {
    type: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replace: () => redact('email'),
  },
  {
    // Fallback for unknown credential formats: long strings that mix cases and digits.
    // Requiring all three classes keeps git SHAs (hex) and plain words out.
    type: 'high_entropy',
    pattern:
      /\b(?=[A-Za-z0-9+/_-]*[a-z])(?=[A-Za-z0-9+/_-]*[A-Z])(?=[A-Za-z0-9+/_-]*\d)[A-Za-z0-9+/_-]{40,}={0,2}\b/g,
    replace: () => redact('high_entropy'),
  },
];

/** Replaces every recognized secret in `text`. Safe to call on already-redacted text. */
export function redactSecrets(text: string): string {
  let output = text;
  for (const rule of REDACTION_RULES) {
    output = output.replace(rule.pattern, (match: string, ...groups: unknown[]) =>
      rule.replace(match, ...groups.filter((group) => typeof group === 'string')),
    );
  }
  return output;
}

/** True if `text` still contains something that looks like a secret. Used in tests and guards. */
export function containsSecret(text: string): boolean {
  return redactSecrets(text) !== text;
}
