import { Button, Input, Toggle } from '@flowcanvas/ui';
import { useCallback, useEffect, useId, useState, type SubmitEvent } from 'react';
import { formatWorkspaceTime } from '../usage/Usage';
import {
  allowEmail,
  disallowEmail,
  fetchAdminView,
  isProblem,
  type AdminView,
  type AllowedEmail,
  type ApiProblem,
  type Person,
} from './api';
import styles from './Admin.module.css';

interface AdminProps {
  /** The signed-in admin's email: their own entry can't be changed here, so they can't lock themselves out. */
  readonly ownEmail: string;
  /** Replaces the browser's fetch in tests. */
  readonly fetcher?: typeof fetch;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const PROVIDER_NAMES: Readonly<Record<string, string>> = { github: 'GitHub', google: 'Google' };

/**
 * The admin view: who may sign in, who has, and how much each person uses. Counts only; never project names,
 * addresses or secrets. Shown only to admins, and the API checks the role on every request as well.
 */
export function Admin({ ownEmail, fetcher = fetch }: AdminProps) {
  const [view, setView] = useState<AdminView | undefined>(undefined);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  const reload = useCallback(async (): Promise<void> => {
    const loaded = await fetchAdminView(fetcher);
    if (isProblem(loaded)) setProblem(loaded.message);
    else setView(loaded);
  }, [fetcher]);

  useEffect(() => {
    let current = true;
    void fetchAdminView(fetcher).then((loaded) => {
      if (!current) return;
      if (isProblem(loaded)) setProblem(loaded.message);
      else setView(loaded);
    });
    return () => {
      current = false;
    };
  }, [fetcher]);

  async function act(run: () => Promise<ApiProblem | undefined>, done: string): Promise<void> {
    const failed = await run();
    if (failed !== undefined) {
      setProblem(failed.message);
      return;
    }
    setProblem(undefined);
    setNotice(done);
    await reload();
  }

  return (
    <section className={styles.section} aria-labelledby="admin-heading">
      <h2 id="admin-heading" className={styles.heading}>
        Admin
      </h2>
      {view !== undefined && (
        <>
          <h3 className={styles.subheading}>People</h3>
          {view.people.length === 0 ? (
            <p className={styles.note}>Nobody has signed in yet.</p>
          ) : (
            <ul className={styles.list} aria-label="People">
              {view.people.map((person) => (
                <PersonRow key={person.id} person={person} />
              ))}
            </ul>
          )}

          <h3 className={styles.subheading}>Allowlist</h3>
          <p className={styles.note}>
            Only these emails can sign in. Removing one signs that person out everywhere; their
            account and projects stay.
          </p>
          <AllowForm
            onAllow={async (email, role) => {
              const result = await allowEmail(fetcher, email, role);
              if (isProblem(result)) return result;
              setProblem(undefined);
              setNotice(
                result === 'added' ? `Allowed ${email}.` : `${email} is now ${roleName(role)}.`,
              );
              await reload();
              return undefined;
            }}
          />
          <ul className={styles.list} aria-label="Allowed emails">
            {view.allowlist.map((allowed) => (
              <AllowedRow
                key={allowed.email}
                allowed={allowed}
                own={allowed.email === ownEmail}
                onChangeRole={(role) =>
                  act(
                    async () => {
                      const result = await allowEmail(fetcher, allowed.email, role);
                      return isProblem(result) ? result : undefined;
                    },
                    `${allowed.email} is now ${roleName(role)}.`,
                  )
                }
                onRemove={() =>
                  act(
                    () => disallowEmail(fetcher, allowed.email),
                    `Removed ${allowed.email}. They’re signed out.`,
                  )
                }
              />
            ))}
          </ul>
        </>
      )}
      {problem !== undefined && (
        <p className={styles.error} role="alert">
          {problem}
        </p>
      )}
      {notice !== undefined && (
        <p className={styles.note} role="status">
          {notice}
        </p>
      )}
    </section>
  );
}

const roleName = (role: 'member' | 'admin') => (role === 'admin' ? 'an admin' : 'a member');

function PersonRow({ person }: { readonly person: Person }) {
  const providers = person.providers.map((id) => PROVIDER_NAMES[id] ?? id).join(', ');
  const projects = `${String(person.projectCount)} ${person.projectCount === 1 ? 'project' : 'projects'}`;
  const lastSignIn =
    person.lastSignedInAt === null
      ? 'never signed in'
      : `last signed in ${dateFormat.format(new Date(person.lastSignedInAt))}`;
  return (
    <li className={styles.item}>
      <span className={styles.itemHeader}>
        <span className={styles.name}>{person.displayName}</span>
        <span className={styles.email}>{person.email}</span>
      </span>
      <span className={styles.meta}>
        {[
          person.role === 'admin' ? 'Admin' : 'Member',
          providers,
          projects,
          `${formatWorkspaceTime(person.workspaceSecondsThisMonth)} this month`,
          lastSignIn,
          ...(person.allowed ? [] : ['no longer on the allowlist']),
        ]
          .filter((part) => part !== '')
          .join(' · ')}
      </span>
    </li>
  );
}

function AllowedRow({
  allowed,
  own,
  onChangeRole,
  onRemove,
}: {
  readonly allowed: AllowedEmail;
  readonly own: boolean;
  readonly onChangeRole: (role: 'member' | 'admin') => Promise<void>;
  readonly onRemove: () => Promise<void>;
}) {
  // Removing signs someone out at once, so it takes a second, explicit click.
  const [confirming, setConfirming] = useState(false);
  const other = allowed.role === 'admin' ? 'member' : 'admin';
  return (
    <li className={styles.item}>
      <span className={styles.itemHeader}>
        <span className={styles.email}>{allowed.email}</span>
        {own ? (
          <span className={styles.meta}>You</span>
        ) : confirming ? (
          <span className={styles.actions}>
            <Button kind="danger" onClick={() => void onRemove()}>
              Remove {allowed.email}
            </Button>
            <Button
              kind="ghost"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Keep
            </Button>
          </span>
        ) : (
          <span className={styles.actions}>
            <Button
              kind="ghost"
              aria-label={`Make ${allowed.email} ${roleName(other)}`}
              onClick={() => void onChangeRole(other)}
            >
              {other === 'admin' ? 'Make admin' : 'Make member'}
            </Button>
            <Button
              kind="ghost"
              aria-label={`Remove ${allowed.email}`}
              onClick={() => {
                setConfirming(true);
              }}
            >
              Remove
            </Button>
          </span>
        )}
      </span>
      <span className={styles.meta}>
        {allowed.role === 'admin' ? 'Admin' : 'Member'} ·{' '}
        {allowed.signedUp ? 'has signed in' : 'hasn’t signed in yet'} · added{' '}
        {dateFormat.format(new Date(allowed.addedAt))}
      </span>
    </li>
  );
}

function AllowForm({
  onAllow,
}: {
  readonly onAllow: (email: string, role: 'member' | 'admin') => Promise<ApiProblem | undefined>;
}) {
  const id = useId();
  const [email, setEmail] = useState('');
  const [admin, setAdmin] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    const result = await onAllow(email.trim(), admin ? 'admin' : 'member');
    setSaving(false);
    setProblem(result);
    if (result === undefined) {
      setEmail('');
      setAdmin(false);
    }
  }

  const problemId = `${id}-problem`;
  return (
    <form className={styles.form} onSubmit={(event) => void handleSubmit(event)} noValidate>
      <label className={styles.label} htmlFor={`${id}-email`}>
        Email
      </label>
      <Input
        id={`${id}-email`}
        type="email"
        value={email}
        autoComplete="off"
        spellCheck={false}
        placeholder="ada@example.com"
        invalid={problem !== undefined}
        aria-describedby={problem === undefined ? undefined : problemId}
        onChange={(event) => {
          setEmail(event.target.value);
        }}
      />
      <span className={styles.label} id={`${id}-admin`}>
        Admin
      </span>
      <Toggle aria-labelledby={`${id}-admin`} checked={admin} onCheckedChange={setAdmin} />
      {problem !== undefined && (
        <p id={problemId} className={styles.error} role="alert">
          {problem.message}
        </p>
      )}
      <div className={styles.formActions}>
        <Button kind="secondary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Allow email'}
        </Button>
      </div>
    </form>
  );
}
