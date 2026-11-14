// What a detector reports (ADR 0030 §2): an entry point as its framework declares it, where, and what handles it.
// Paths are written one way for every framework: `:name` for a parameter, `*` for the rest of the path.

/** The design brief's groups (§23); jobs, cron and events are phase 11's. */
export const ENTRY_KINDS = ['screen', 'element', 'api-route', 'cli-command'] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export const FRAMEWORKS = [
  'next',
  'react-router',
  'express',
  'hono',
  'trpc',
  'nestjs',
  'graphql',
  'react',
  'package-json',
] as const;
export type Framework = (typeof FRAMEWORKS)[number];

/** A place in a file, 1-based, as the rest of Flowcanvas writes them. */
export interface Position {
  readonly line: number;
  readonly column: number;
}

/** A stretch of a file's text, by character offsets: what handles an entry point, for the engine to find its node. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

export interface FoundEntry {
  readonly kind: EntryKind;
  readonly framework: Framework;
  /** As the page lists it: `/settings/profile`, `POST /api/private/polls`, `spaces.listMembers`, `web: dev`. */
  readonly name: string;
  /** Where it's declared in its file. */
  readonly at: Position;
  /** False when part of it couldn't be worked out from the code (shown as not fully detected, never guessed). */
  readonly complete: boolean;
  /** Why it isn't complete. */
  readonly why?: string;
  /** The function or method that handles it, when it's declared right there. */
  readonly handler?: Span;
  /** An identifier naming its handler, declared elsewhere (`export default DocumentPage`), for the engine to resolve. */
  readonly handlerName?: Span;
  /** A script's project file (`scripts/seed.ts`, from the package's folder), when its command runs one. */
  readonly runs?: string;
}
