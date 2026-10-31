import type { Database } from '../db/database.js';

/**
 * Usage metering skeleton. Each record is a measured amount for one person over one period. Phase 1d's workspaces
 * write `workspace_seconds` as they run; phase 44a adds the free allowance, limits and billing on top of the sums.
 */
export type UsageKind = 'workspace_seconds' | 'storage_byte_hours';

export interface UsageRecord {
  readonly userId: string;
  /** The workspace that used it, if any. It must be one of this person's. */
  readonly workspaceId: string | null;
  readonly kind: UsageKind;
  /** A whole number: seconds, or byte-hours. */
  readonly quantity: number;
  readonly startedAt: Date;
  readonly endedAt: Date;
}

/** What a person has used in the current calendar month (UTC). */
export interface UsageSummary {
  /** ISO 8601, UTC: the first instant of this month, and of the next (when the sums start again). */
  readonly periodStart: string;
  readonly resetsAt: string;
  readonly workspaceSeconds: number;
  readonly storageByteHours: number;
}

/** Thrown for a record that can't be true; the meter refuses it instead of storing a wrong amount. */
export class UsageError extends Error {
  override readonly name = 'UsageError';
}

/** The UTC calendar month containing `now`. */
export function monthPeriod(now: number): { readonly start: Date; readonly end: Date } {
  const date = new Date(now);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return { start: new Date(Date.UTC(year, month, 1)), end: new Date(Date.UTC(year, month + 1, 1)) };
}

function checkRecord(record: UsageRecord): void {
  const { quantity, startedAt, endedAt } = record;
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new UsageError('quantity must be a whole number, 0 or more');
  }
  const started = startedAt.getTime();
  const ended = endedAt.getTime();
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) {
    throw new UsageError('the period must end at or after it starts');
  }
  // Each record counts in exactly one month, so monthly sums never need splitting: the recorder splits at the boundary.
  if (ended > monthPeriod(started).end.getTime()) {
    throw new UsageError('a record must not cross into the next month; split it at the boundary');
  }
  if (record.kind === 'workspace_seconds' && quantity > Math.ceil((ended - started) / 1000)) {
    throw new UsageError('a workspace can’t run for longer than the period');
  }
}

/** Stores one measured amount. Refuses impossible records, and workspaces that aren't this person's. */
export async function recordUsage(db: Database, record: UsageRecord): Promise<void> {
  checkRecord(record);
  const rows = await db.query(
    `insert into usage_records (user_id, workspace_id, kind, quantity, started_at, ended_at)
     select $1, $2, $3, $4, $5::timestamptz, $6::timestamptz
     where $2::uuid is null or exists (
       select 1 from workspaces w join projects p on p.id = w.project_id
       where w.id = $2::uuid and p.owner_id = $1
     )
     returning id`,
    [
      record.userId,
      record.workspaceId,
      record.kind,
      record.quantity,
      record.startedAt.toISOString(),
      record.endedAt.toISOString(),
    ],
  );
  if (rows.length === 0) throw new UsageError('that workspace isn’t this person’s');
}

/** This month's sums for one person. Nothing recorded yet is a real 0, not a missing value. */
export async function usageSummary(
  db: Database,
  userId: string,
  now: number,
): Promise<UsageSummary> {
  const { start, end } = monthPeriod(now);
  const rows = await db.query<{ kind: UsageKind; total: number }>(
    `select kind, sum(quantity)::float8 as total from usage_records
     where user_id = $1 and started_at >= $2::timestamptz and started_at < $3::timestamptz
     group by kind`,
    [userId, start.toISOString(), end.toISOString()],
  );
  const total = (kind: UsageKind) => rows.find((row) => row.kind === kind)?.total ?? 0;
  return {
    periodStart: start.toISOString(),
    resetsAt: end.toISOString(),
    workspaceSeconds: total('workspace_seconds'),
    storageByteHours: total('storage_byte_hours'),
  };
}
