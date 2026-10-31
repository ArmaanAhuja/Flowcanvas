import { Button, Input } from '@flowcanvas/ui';
import { useEffect, useId, useState, type SubmitEvent } from 'react';
import {
  fetchSecrets,
  isProblem,
  removeSecret,
  saveSecret,
  type ApiProblem,
  type SecretInfo,
} from './api';
import styles from './ProjectSecrets.module.css';

interface ProjectSecretsProps {
  readonly projectId: string;
  readonly projectName: string;
  /** Replaces the browser's fetch in tests. */
  readonly fetcher?: typeof fetch;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * A project's secrets (design brief: "environment variables by name only, with masked values, who added them and
 * when. Add, rotate and delete; values are write-only once saved"). The value never comes back from the API, so
 * the page can't show it even by mistake.
 */
export function ProjectSecrets({ projectId, projectName, fetcher = fetch }: ProjectSecretsProps) {
  const [secrets, setSecrets] = useState<SecretInfo[] | undefined>(undefined);
  const [problem, setProblem] = useState<ApiProblem | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  async function reload(): Promise<void> {
    const loaded = await fetchSecrets(fetcher, projectId);
    if (isProblem(loaded)) setProblem(loaded);
    else setSecrets(loaded);
  }

  useEffect(() => {
    let current = true;
    void fetchSecrets(fetcher, projectId).then((loaded) => {
      if (!current) return;
      if (isProblem(loaded)) setProblem(loaded);
      else setSecrets(loaded);
    });
    return () => {
      current = false;
    };
  }, [fetcher, projectId]);

  async function handleDelete(name: string): Promise<void> {
    const result = await removeSecret(fetcher, projectId, name);
    if (isProblem(result)) {
      setProblem(result);
      return;
    }
    setNotice(`Deleted ${name}.`);
    await reload();
  }

  return (
    <section className={styles.panel} aria-label={`Secrets for ${projectName}`}>
      <p className={styles.note}>
        Values are encrypted and can’t be shown again, here or anywhere. To change one, save it
        again with the same name.
      </p>
      {secrets !== undefined &&
        (secrets.length === 0 ? (
          <p className={styles.note}>No secrets yet.</p>
        ) : (
          <ul className={styles.list} aria-label="Saved secrets">
            {secrets.map((secret) => (
              <SecretRow
                key={secret.name}
                secret={secret}
                onDelete={() => handleDelete(secret.name)}
              />
            ))}
          </ul>
        ))}
      <SecretForm
        existing={secrets?.map(({ name }) => name) ?? []}
        onSave={async (name, value) => {
          const result = await saveSecret(fetcher, projectId, name, value);
          if (isProblem(result)) return result;
          setProblem(undefined);
          setNotice(result === 'created' ? `Saved ${name}.` : `Replaced the value of ${name}.`);
          await reload();
          return undefined;
        }}
      />
      {problem !== undefined && problem.field === undefined && (
        <p className={styles.error} role="alert">
          {problem.message}
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

function SecretRow({
  secret,
  onDelete,
}: {
  readonly secret: SecretInfo;
  readonly onDelete: () => Promise<void>;
}) {
  // Deleting can't be undone, so it takes a second, explicit click.
  const [confirming, setConfirming] = useState(false);
  return (
    <li className={styles.row}>
      <span className={styles.name}>{secret.name}</span>
      <span className={styles.masked} aria-label="Value hidden">
        ••••••••
      </span>
      <span className={styles.meta}>
        {secret.addedBy === null ? 'Added' : `Added by ${secret.addedBy}`} · updated{' '}
        {dateFormat.format(new Date(secret.updatedAt))}
      </span>
      {confirming ? (
        <span className={styles.actions}>
          <Button kind="danger" onClick={() => void onDelete()}>
            Delete {secret.name}
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
        <Button
          kind="ghost"
          aria-label={`Delete ${secret.name}`}
          onClick={() => {
            setConfirming(true);
          }}
        >
          Delete
        </Button>
      )}
    </li>
  );
}

function SecretForm({
  existing,
  onSave,
}: {
  readonly existing: readonly string[];
  readonly onSave: (name: string, value: string) => Promise<ApiProblem | undefined>;
}) {
  const id = useId();
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<ApiProblem | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const replacing = existing.includes(name);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    const result = await onSave(name, value);
    setSaving(false);
    setProblem(result);
    // The value leaves the page's memory as soon as it's saved.
    if (result === undefined) {
      setName('');
      setValue('');
    }
  }

  const problemId = `${id}-problem`;
  return (
    <form className={styles.form} onSubmit={(event) => void handleSubmit(event)} noValidate>
      <label className={styles.label} htmlFor={`${id}-name`}>
        Name
      </label>
      <Input
        id={`${id}-name`}
        mono
        value={name}
        autoComplete="off"
        spellCheck={false}
        placeholder="DATABASE_URL"
        invalid={problem?.field === 'name'}
        aria-describedby={problem?.field === 'name' ? problemId : undefined}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <label className={styles.label} htmlFor={`${id}-value`}>
        Value
      </label>
      <Input
        id={`${id}-value`}
        mono
        type="password"
        value={value}
        // Not a login password: browsers shouldn't offer to save or fill it.
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        spellCheck={false}
        invalid={problem?.field === 'value'}
        aria-describedby={problem?.field === 'value' ? problemId : undefined}
        onChange={(event) => {
          setValue(event.target.value);
        }}
      />
      {problem?.field !== undefined && (
        <p id={problemId} className={styles.error} role="alert">
          {problem.message}
        </p>
      )}
      <div className={styles.formActions}>
        <Button kind="secondary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : replacing ? `Replace ${name}` : 'Save secret'}
        </Button>
      </div>
    </form>
  );
}
