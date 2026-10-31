import { formatBuildInfo, type BuildInfo } from '@flowcanvas/graph-model';
import {
  Menu,
  MenuButton,
  MenuItem,
  MenuTrigger,
  Popover,
  PopoverButton,
  PopoverTrigger,
  useThemePreference,
  type ThemePreference,
} from '@flowcanvas/ui';
import { useCallback, useState } from 'react';
import releases from 'virtual:changelog';
import { Account } from './account/Account';
import { Admin } from './admin/Admin';
import type { Session } from './account/session';
import styles from './App.module.css';
import { LabsPanel } from './labs/LabsPanel';
import { LabsProvider } from './labs/LabsProvider';
import { Projects } from './projects/Projects';
import { CATALOGUE_URL } from './links';
import { Usage } from './usage/Usage';
import { useWhatsNewSeen } from './whats-new/seen';
import { WhatsNew } from './whats-new/WhatsNew';

interface AppProps {
  readonly buildInfo: BuildInfo;
  /** Replaces the browser's fetch for the API calls, in tests. */
  readonly fetcher?: typeof fetch;
}

const THEMES: readonly { readonly id: ThemePreference; readonly label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
];

function themeLabel(preference: ThemePreference): string {
  return THEMES.find((theme) => theme.id === preference)?.label ?? 'System';
}

export function App({ buildInfo, fetcher }: AppProps) {
  const [theme, setTheme] = useThemePreference();
  const [unseen, markSeen] = useWhatsNewSeen(releases[0]?.version);
  const [session, setSession] = useState<Session | undefined>(undefined);
  const onSessionChange = useCallback((changed: Session) => {
    setSession(changed);
  }, []);
  const user = session?.kind === 'signed-in' ? session.user : undefined;
  const apiFetcher = fetcher === undefined ? {} : { fetcher };
  return (
    <LabsProvider>
      <main className={styles.page}>
        <div className={styles.content}>
          <h1 className={styles.title}>Flowcanvas</h1>
          <p className={styles.summary}>
            A canvas-first development environment. This build has the Graphite design system; the
            canvas comes in the next phases.
          </p>
          <dl className={styles.facts}>
            <dt className={styles.term}>Build</dt>
            <dd className={styles.build}>{formatBuildInfo(buildInfo)}</dd>
            <Account {...apiFetcher} onSessionChange={onSessionChange} />
          </dl>
          {user !== undefined && <Projects {...apiFetcher} />}
          {user !== undefined && <Usage {...apiFetcher} />}
          {/* The API checks the role on every request too; hiding the section is for clarity, not security. */}
          {user?.role === 'admin' && <Admin ownEmail={user.email} {...apiFetcher} />}
          <div className={styles.actions}>
            <a className={styles.link} href={CATALOGUE_URL}>
              Open the component catalogue
            </a>
            <div className={styles.controls}>
              <PopoverTrigger
                onOpenChange={(open) => {
                  if (open) markSeen();
                }}
              >
                <PopoverButton
                  kind="ghost"
                  aria-label={unseen ? "What's new (new changes)" : "What's new"}
                >
                  What&apos;s new
                  {/* A state dot only when something changed since the notes were last opened. */}
                  {unseen && <span className={styles.dot} aria-hidden="true" />}
                </PopoverButton>
                <Popover title={`What's new in ${buildInfo.version}`}>
                  <WhatsNew releases={releases} version={buildInfo.version} />
                </Popover>
              </PopoverTrigger>
              {/* Settings → Labs from phase 2, when the app shell has a Settings page. */}
              <PopoverTrigger>
                <PopoverButton kind="ghost">Labs</PopoverButton>
                <Popover title="Labs">
                  <LabsPanel />
                </Popover>
              </PopoverTrigger>
              <MenuTrigger>
                <MenuButton aria-label={`Theme: ${themeLabel(theme)}`}>
                  Theme: {themeLabel(theme)}
                </MenuButton>
                <Menu
                  aria-label="Theme"
                  placement="bottom end"
                  selectionMode="single"
                  disallowEmptySelection
                  selectedKeys={[theme]}
                  onSelectionChange={(keys) => {
                    const next = keys === 'all' ? undefined : THEMES.find(({ id }) => keys.has(id));
                    if (next !== undefined) setTheme(next.id);
                  }}
                >
                  {THEMES.map(({ id, label }) => (
                    <MenuItem
                      key={id}
                      id={id}
                      {...(id === 'system' ? { description: 'follows your OS' } : {})}
                    >
                      {label}
                    </MenuItem>
                  ))}
                </Menu>
              </MenuTrigger>
            </div>
          </div>
        </div>
      </main>
    </LabsProvider>
  );
}
