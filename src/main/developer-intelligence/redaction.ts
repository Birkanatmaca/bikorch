/**
 * Secret redaction for Developer Intelligence.
 *
 * Runs before anything is persisted and again before any outbound analysis request.
 * The goal is to catch the common shapes of credentials, not to be a perfect classifier.
 * Prefer false positives over leaking a real secret.
 */

export interface RedactionResult {
  text: string
  redactedCount: number
}

export const REDACTED = '[REDACTED]'

const SENSITIVE_KEY = /(?:api[_-]?key|secret|token|passw(?:or)?d|passwd|private[_-]?key|access[_-]?key|client[_-]?secret|auth|credential|session[_-]?id|cookie)/i

interface Pattern {
  name: string
  regex: RegExp
  /** Replacement function: receives the match and returns the redacted string. */
  replace: (match: string, ...groups: string[]) => string
}

const PATTERNS: Pattern[] = [
  {
    name: 'private-key-block',
    regex:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: () => REDACTED
  },
  {
    name: 'openai-anthropic-key',
    regex: /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}\b/g,
    replace: () => REDACTED
  },
  {
    name: 'github-token',
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    replace: () => REDACTED
  },
  {
    name: 'aws-access-key',
    regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
    replace: () => REDACTED
  },
  {
    name: 'google-api-key',
    regex: /\bAIza[0-9A-Za-z_-]{30,}\b/g,
    replace: () => REDACTED
  },
  {
    name: 'slack-token',
    regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
    replace: () => REDACTED
  },
  {
    name: 'stripe-key',
    regex: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
    replace: () => REDACTED
  },
  {
    name: 'jwt',
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replace: () => REDACTED
  },
  {
    name: 'bearer-header',
    regex: /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{12,}/g,
    replace: (_match, scheme) => `${scheme} ${REDACTED}`
  },
  {
    name: 'authorization-header',
    regex: /((?:authorization|x-api-key|api-key|x-auth-token)\s*[:=]\s*)(["']?)[^\s"',;]{8,}\2/gi,
    replace: (_match, prefix) => `${prefix}${REDACTED}`
  },
  {
    name: 'connection-string-credentials',
    regex: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:@/]+):([^\s@/]+)@/gi,
    replace: (_match, scheme, user) => `${scheme}${user}:${REDACTED}@`
  },
  {
    name: 'env-assignment',
    // KEY=value / KEY: value / "key": "value" where the key name looks sensitive.
    regex:
      /(["']?)([A-Za-z_][A-Za-z0-9_.-]*)\1(\s*[:=]\s*)(["']?)([^\s"',;]{4,})\4/g,
    replace: (match, quote, key, separator, valueQuote) =>
      SENSITIVE_KEY.test(key) && !/^(?:true|false|null|none|undefined)$/i.test(match)
        ? `${quote}${key}${quote}${separator}${valueQuote}${REDACTED}${valueQuote}`
        : match
  },
  {
    name: 'cli-flag',
    // --password foo, --token=abc, -p secret
    regex: /(--?(?:password|passwd|token|api-key|apikey|secret|auth)(?:[=\s]+))(["']?)[^\s"']{4,}\2/gi,
    replace: (_match, prefix) => `${prefix}${REDACTED}`
  }
]

/**
 * Redacts likely secrets in `text`. Deterministic and side-effect free.
 */
export function redactSecrets(text: string): RedactionResult {
  if (!text) return { text: '', redactedCount: 0 }

  let output = text
  let redactedCount = 0

  for (const pattern of PATTERNS) {
    output = output.replace(pattern.regex, (match: string, ...rest: unknown[]) => {
      const groups = rest.slice(0, -2) as string[]
      const replaced = pattern.replace(match, ...groups)
      if (replaced !== match) redactedCount += 1
      return replaced
    })
  }

  return { text: output, redactedCount }
}

/** True when the text still contains something that looks like a secret after redaction. */
export function looksLikeSecret(text: string): boolean {
  return redactSecrets(text).redactedCount > 0
}
