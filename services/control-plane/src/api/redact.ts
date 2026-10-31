/**
 * Removes secret-shaped text from anything about to be logged: database connection strings (they embed a password),
 * bearer and provider tokens, OAuth codes and client secrets in URLs or form bodies, our own cookies, and email
 * addresses (personal data). Errors from drivers and providers can quote the URL or body they failed on.
 * Every log line goes through this (createApi wraps `log`), as a backstop to never logging such values at all.
 */
export function redact(text: string): string {
  return (
    text
      .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, 'postgresql://[redacted]')
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, 'Bearer [redacted]')
      // GitHub tokens (gho_, ghp_, ghu_, ghs_, ghr_, github_pat_) and Google access tokens (ya29.).
      .replace(/\b(?:gh[opusr]_|github_pat_)[A-Za-z0-9_]+/g, '[redacted token]')
      .replace(/\bya29\.[A-Za-z0-9._-]+/g, '[redacted token]')
      // OAuth values in query strings, form bodies or JSON: code, state, verifier, secrets, tokens.
      .replace(
        /\b(code|state|code_verifier|client_secret|access_token|refresh_token|id_token)(["']?\s*[=:]\s*["']?)[^\s&"',}]+/gi,
        '$1$2[redacted]',
      )
      // Our cookies, by name (session token; sign-in state and PKCE verifier).
      .replace(/(__Host-fc_[a-z]+=)[^;\s]+/g, '$1[redacted]')
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[redacted email]')
  );
}

/** A short, safe description of an unknown error for logs. */
export function describeError(error: unknown): string {
  if (error instanceof Error) return redact(`${error.name}: ${error.message}`);
  return redact(String(error));
}
