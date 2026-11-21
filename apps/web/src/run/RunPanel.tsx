import {
  Button,
  Input,
  Menu,
  MenuButton,
  MenuItem,
  MenuTrigger,
  ProcessCard,
} from '@flowcanvas/ui';
import { Suspense, lazy, useState } from 'react';
import {
  looksSecret,
  randomSecret,
  type MissingVariable,
  type ProcessView,
  type RunState,
} from './api';
import type { RunControl } from './useRun';
import styles from './RunPanel.module.css';

// xterm.js only once a card shows its output.
const ProcessOutput = lazy(async () => ({
  default: (await import('./ProcessOutput')).ProcessOutput,
}));

export const RUN_TEXT = {
  loading: 'Reading how the project runs…',
  noScripts: 'This project’s package.json has no scripts to run.',
  notInstalled: 'Its dependencies aren’t installed yet.',
  install: 'Install dependencies',
  services: 'Start services',
  stopServices: 'Stop services',
  noDocker:
    'Docker isn’t installed, or Flowcanvas can’t find it on your PATH. Install Docker to start the project’s services.',
  needed: 'Needed before it runs',
  saved: (file: string) =>
    `Saved to ${file} on your computer. Flowcanvas never shows, logs or sends these values.`,
  noFile: (file: string) => `${file} doesn’t exist yet.`,
  create: (file: string, example: string) => `Create ${file} from ${example}`,
  others: (count: number) =>
    `${String(count)} more ${count === 1 ? 'isn’t' : 'aren’t'} set. The example doesn’t say ${count === 1 ? 'it’s' : 'they’re'} needed.`,
  node: (wanted: string, have: string | null) =>
    have === null
      ? `This project needs Node ${wanted}, and there’s no node on your PATH. Install Node ${wanted}, then reopen the project.`
      : `This project needs Node ${wanted}; you have ${have}. Install Node ${wanted} (with nvm, fnm or your package manager), then try again.`,
  runAnyway: 'Run anyway',
  empty: 'Nothing has run yet.',
} as const;

const fileName = (path: string) => path.split('/').pop() ?? path;

/** What Run would do now: install first, or ask for variables first, or just run. */
export function blockingVariables(state: RunState): readonly MissingVariable[] {
  return state.plan.missing.filter((variable) => variable.required === true);
}

/**
 * The dock's Run tab (build plan v2, phase 3): what the project needs before it runs (Node, dependencies, variables,
 * services), its scripts, and a card for each process started, newest first.
 */
export function RunPanel({
  run,
  onRun,
}: {
  readonly run: RunControl;
  /** Run's whole sequence (install if needed, then the main script), as the top bar's button runs it. */
  readonly onRun: (options?: { readonly anyway?: boolean }) => void;
}) {
  const { state } = run;
  if (state === undefined) {
    return (
      <p className={styles.note} role="status">
        {run.problem ?? RUN_TEXT.loading}
      </p>
    );
  }
  const { plan } = state;
  const others = plan.scripts.filter((script) => script.name !== plan.main);
  const blocking = blockingVariables(state);
  const processes = [...run.processes].reverse();
  return (
    <div className={styles.panel}>
      {run.problem !== undefined && (
        <p className={styles.problem} role="alert">
          {run.problem}
        </p>
      )}
      <div className={styles.actions}>
        {plan.main !== null && (
          <Button
            kind="secondary"
            onClick={() => {
              onRun();
            }}
          >
            Run {plan.main}
          </Button>
        )}
        {others.length > 0 && (
          <MenuTrigger>
            <MenuButton>Run a script</MenuButton>
            <Menu
              aria-label="Scripts"
              onAction={(key) => {
                void run.start({ kind: 'script', script: String(key) });
              }}
            >
              {others.map((script) => (
                <MenuItem
                  key={script.name}
                  id={script.name}
                  description={script.command}
                  descriptionMono
                >
                  {script.name}
                </MenuItem>
              ))}
            </Menu>
          </MenuTrigger>
        )}
        <Button kind="ghost" onClick={() => void run.start({ kind: 'install' })}>
          {RUN_TEXT.install}
        </Button>
        {plan.compose !== null && (
          <Button
            kind="ghost"
            disabled={!state.docker}
            onClick={() => void run.start({ kind: 'services' })}
          >
            {RUN_TEXT.services}
          </Button>
        )}
        {plan.compose !== null && state.docker && (
          <Button kind="ghost" onClick={() => void run.start({ kind: 'services-stop' })}>
            {RUN_TEXT.stopServices}
          </Button>
        )}
      </div>
      {plan.scripts.length === 0 && <p className={styles.note}>{RUN_TEXT.noScripts}</p>}
      {plan.node !== null && plan.node.fits === false && (
        <p className={styles.warning} role="alert">
          {RUN_TEXT.node(plan.node.wanted, plan.node.have)}
        </p>
      )}
      {!plan.installed && <p className={styles.note}>{RUN_TEXT.notInstalled}</p>}
      {plan.compose !== null && !state.docker && <p className={styles.note}>{RUN_TEXT.noDocker}</p>}
      <EnvPrompt
        run={run}
        state={state}
        {...(blocking.length > 0 && plan.main !== null
          ? {
              onRunAnyway: () => {
                onRun({ anyway: true });
              },
            }
          : {})}
      />
      {processes.length === 0 ? (
        <p className={styles.note}>{RUN_TEXT.empty}</p>
      ) : (
        processes.map((process) => <Card key={process.id} process={process} run={run} />)
      )}
    </div>
  );
}

function Card({ process, run }: { readonly process: ProcessView; readonly run: RunControl }) {
  const live = process.state === 'running' || process.state === 'stopping';
  return (
    <ProcessCard
      label={process.label}
      command={process.command}
      state={process.state}
      exitCode={process.exitCode}
      ports={process.ports}
      problem={process.problem}
      output={
        process.problem === null ? (
          <Suspense fallback={null}>
            <ProcessOutput
              id={process.id}
              label={process.label}
              running={process.state === 'running'}
              run={run}
            />
          </Suspense>
        ) : undefined
      }
      actions={
        <>
          <Button
            size="sm"
            kind="ghost"
            onClick={() => {
              run.restart(process.id);
            }}
          >
            {live ? 'Restart' : 'Run again'}
          </Button>
          {live && (
            <Button
              size="sm"
              disabled={process.state === 'stopping'}
              onClick={() => {
                run.stop(process.id);
              }}
            >
              Stop
            </Button>
          )}
        </>
      }
    />
  );
}

/**
 * The prompt for missing variables (build plan v2, phase 3): a .env to start from its example, then the variables the
 * example says are required, then the rest, folded. Each value goes into the project's own .env file.
 */
function EnvPrompt({
  run,
  state,
  onRunAnyway,
}: {
  readonly run: RunControl;
  readonly state: RunState;
  readonly onRunAnyway?: () => void;
}) {
  const absent = state.plan.envFiles.filter((file) => !file.exists);
  const required = state.plan.missing.filter((variable) => variable.required === true);
  const rest = state.plan.missing.filter((variable) => variable.required !== true);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  if (absent.length === 0 && state.plan.missing.length === 0) return null;
  const files = [...new Set(state.plan.missing.map((variable) => variable.file))];
  return (
    <section className={styles.env} aria-labelledby="run-env-heading">
      <h3 id="run-env-heading" className={styles.heading}>
        Environment variables
      </h3>
      {problem !== undefined && (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      )}
      {absent.map((file) => (
        <p key={file.file} className={styles.row}>
          <span>{RUN_TEXT.noFile(file.file)}</span>
          <Button
            size="sm"
            onClick={() => {
              void run.createEnvFile(file.file).then(setProblem);
            }}
          >
            {RUN_TEXT.create(file.file, fileName(file.example))}
          </Button>
        </p>
      ))}
      {required.length > 0 && (
        <div className={styles.group} role="group" aria-labelledby="run-env-needed">
          <h4 id="run-env-needed" className={styles.subheading}>
            {RUN_TEXT.needed}
          </h4>
          {required.map((variable) => (
            <VariableRow
              key={`${variable.file}:${variable.name}`}
              variable={variable}
              onSave={(value) => run.setVariable(variable.file, variable.name, value)}
            />
          ))}
          {onRunAnyway !== undefined && (
            <Button size="sm" kind="ghost" onClick={onRunAnyway}>
              {RUN_TEXT.runAnyway}
            </Button>
          )}
        </div>
      )}
      {rest.length > 0 && (
        <details className={styles.more}>
          <summary>{RUN_TEXT.others(rest.length)}</summary>
          {rest.map((variable) => (
            <VariableRow
              key={`${variable.file}:${variable.name}`}
              variable={variable}
              onSave={(value) => run.setVariable(variable.file, variable.name, value)}
            />
          ))}
        </details>
      )}
      {files.length > 0 && <p className={styles.note}>{RUN_TEXT.saved(files.join(', '))}</p>}
    </section>
  );
}

function VariableRow({
  variable,
  onSave,
}: {
  readonly variable: MissingVariable;
  readonly onSave: (value: string) => Promise<string | undefined>;
}) {
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const id = `run-env-${variable.file}-${variable.name}`.replace(/[^\w-]/g, '-');
  return (
    <form
      className={styles.variable}
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void onSave(value).then((said) => {
          setBusy(false);
          setProblem(said);
          if (said === undefined) setValue('');
        });
      }}
    >
      <label htmlFor={id} className={styles.name}>
        {variable.name}
      </label>
      <span className={styles.where}>{variable.listedIn}</span>
      <Input
        id={id}
        type="password"
        mono
        controlSize="sm"
        autoComplete="off"
        spellCheck={false}
        value={value}
        invalid={problem !== undefined}
        aria-describedby={problem === undefined ? undefined : `${id}-problem`}
        onChange={(event) => {
          setValue(event.target.value);
        }}
      />
      {looksSecret(variable.name) && (
        <Button
          size="sm"
          kind="ghost"
          onClick={() => {
            setValue(randomSecret());
          }}
        >
          Generate
        </Button>
      )}
      <Button size="sm" type="submit" disabled={busy || value === ''}>
        Save
      </Button>
      {problem !== undefined && (
        <span id={`${id}-problem`} className={styles.problem}>
          {problem}
        </span>
      )}
    </form>
  );
}
