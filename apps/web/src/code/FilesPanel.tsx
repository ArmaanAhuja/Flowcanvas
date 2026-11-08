import { FileTree } from '@flowcanvas/ui';
import { useEffect, useRef, useState } from 'react';
import { isProblem } from '../projects/api';
import { fetchTree, type FileList } from './api';
import { FILES_TEXT } from './texts';
import styles from './Code.module.css';

type Tree =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly list: FileList }
  | { readonly kind: 'problem'; readonly message: string };

/** The left panel in the Code view (Figma 11): the project's files from the workspace. */
export function FilesPanel({
  projectId,
  projectName,
  running,
  selected,
  unsaved,
  onOpen,
  refresh = 0,
  onList,
  fetcher,
}: {
  readonly projectId: string;
  readonly projectName: string;
  readonly running: boolean;
  readonly selected: string | undefined;
  readonly unsaved: ReadonlySet<string>;
  readonly onOpen: (path: string) => void;
  /** Rises when the tree should be listed again (a file appeared or went in the workspace). */
  readonly refresh?: number;
  /** Every listing's paths, for the page to tell new files from known ones. */
  readonly onList?: (files: readonly string[]) => void;
  readonly fetcher: typeof fetch;
}) {
  const [tree, setTree] = useState<Tree>({ kind: 'loading' });
  const onListRef = useRef(onList);
  onListRef.current = onList;

  useEffect(() => {
    if (!running) return;
    let current = true;
    // A refresh keeps the tree shown while it lists again (no flash of "Listing…").
    if (refresh === 0) setTree({ kind: 'loading' });
    void fetchTree(projectId, fetcher).then((result) => {
      if (!current) return;
      if (!isProblem(result)) onListRef.current?.(result.files);
      setTree(
        isProblem(result)
          ? { kind: 'problem', message: result.message }
          : { kind: 'ready', list: result },
      );
    });
    return () => {
      current = false;
    };
  }, [projectId, fetcher, running, refresh]);

  return (
    <section className={styles.panel} aria-labelledby="files-heading">
      <header className={styles.panelHeader}>
        <h2 id="files-heading" className={styles.panelTitle}>
          Files
        </h2>
        <span className={styles.panelMeta}>{projectName}</span>
      </header>
      {!running ? (
        <p className={styles.note}>{FILES_TEXT.notRunning}</p>
      ) : tree.kind === 'loading' ? (
        <p className={styles.note} role="status">
          {FILES_TEXT.loading}
        </p>
      ) : tree.kind === 'problem' ? (
        <p className={styles.note} role="alert">
          {tree.message}
        </p>
      ) : (
        <>
          <div className={styles.tree}>
            <FileTree
              aria-label="Files"
              files={tree.list.files}
              {...(selected === undefined ? {} : { selected })}
              unsaved={unsaved}
              onOpen={onOpen}
            />
          </div>
          {tree.list.truncated && <p className={styles.note}>{FILES_TEXT.truncated}</p>}
        </>
      )}
    </section>
  );
}
