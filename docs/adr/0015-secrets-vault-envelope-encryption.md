# 0015 — Secrets vault: envelope encryption with a master key in a Worker secret

- Status: accepted
- Date: 31 Oct 2026
- Phase: 1c, step 6

## Context

Phase 1c's *Done when* includes "saved secrets never appear in logs", and CLAUDE.md rule 5 says secrets live only in the vault and are never indexed, logged, shown or sent to a model. Projects need values such as `DATABASE_URL` or API keys that a workspace (phase 1d) will receive. The control plane runs in a Cloudflare Worker on the free plan with Neon Postgres (ADR 0013), with no paid key-management service.

## Options considered

1. **Envelope encryption in the Worker (chosen).** A master key in a Worker secret wraps one random data key per project; data keys encrypt values with AES-256-GCM (Web Crypto). Free, and nothing new to run.
2. **A managed KMS** (AWS KMS, Google Cloud KMS) to wrap the data keys. The master key would never be in our memory, and there'd be audit logs and rotation built in. It needs another cloud account with billing, and a network call per unwrap.
3. **One key for everything, straight in a Worker secret.** Simpler, but every value would share one key, rotating it means re-encrypting everything at once, and one project's key couldn't be destroyed on its own.
4. **Postgres `pgcrypto`.** The key would travel to the database in every query and could appear in its logs.

## Decision

Option 1.

```
VAULT_KEY (Worker secret / .dev.vars; 32 random bytes, base64; never in the database)
  └─ wraps the project's data key → project_keys (wrapped_key 48 bytes, wrap_iv 12, key_version 1)
       └─ encrypts each value → project_secrets (ciphertext = value + 16-byte tag, iv 12)
```

- AES-256-GCM with a fresh random 96-bit IV for every encryption (`src/vault/crypto.ts`).
- **Additional authenticated data** binds ciphertext to where it belongs: `project-key:<project>` for a wrapped key, `secret:<project>:<name>` for a value. A row copied to another project or name fails to decrypt (tested).
- **Write-only:** no route returns a value. `readSecret` exists for handing values to the project's workspace (phase 1d) and for tests.
- Values are passed only as request bodies and function arguments. They're never in URLs, logs or error messages; canary tests cover responses, logs and every database row.
- Bytes cross the database driver as hex (`decode`/`encode`), so Neon's HTTP driver and PGlite behave the same.

## Consequences

- **Losing VAULT_KEY loses every saved value.** The staging key must be kept in the owner's password manager before it's stored on Cloudflare. A lost local key only loses local test values.
- **Rotating the master key** means a version-2 key, rewrapping every project key, then retiring version 1. `key_version` is there for this (upgrade-later 28).
- **Anyone who can read the Worker's secrets and the database can decrypt.** A managed KMS would separate those (upgrade-later 28).
- Encryption runs inside the per-request CPU budget. Web Crypto is native, so a save costs well under a millisecond.
