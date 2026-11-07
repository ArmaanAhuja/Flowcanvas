import { File, Folder, FolderOpen } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  Collection,
  ListLayout,
  Tree,
  TreeItem,
  TreeItemContent,
  Virtualizer,
  type Key,
} from 'react-aria-components';
import { classNames } from '../../class-names';
import { ancestorsOf, buildTree, type TreeNode } from './tree-model';
import styles from './FileTree.module.css';

export interface FileTreeProps {
  /** Every file of the project, as project-relative paths (folders come from them). */
  readonly files: readonly string[];
  /** The file shown in the editor: selected, and its folders opened so it's in view. */
  readonly selected?: string;
  /** A file was chosen (click, or Enter). */
  readonly onOpen: (path: string) => void;
  /** Files with changes not written yet: a dot after the name. */
  readonly unsaved?: ReadonlySet<string>;
  /** Names the tree, e.g. "Files". */
  readonly 'aria-label': string;
  readonly className?: string;
}

/** Row height (Graphite compact rows, 28 px): the virtualizer needs it as a number. */
const ROW_HEIGHT = 28;
const NO_UNSAVED: ReadonlySet<string> = new Set();

/**
 * The project's files as a tree (Figma 11, left panel). React Aria's Tree gives the WAI-ARIA tree pattern: arrow
 * keys move and open or close folders, Home and End jump, Enter opens a file, and each row says its level. Only
 * the rows in view are in the page (virtualized), so 50,000 files stay fast.
 */
export function FileTree({
  files,
  selected,
  onOpen,
  unsaved = NO_UNSAVED,
  'aria-label': ariaLabel,
  className,
}: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  const folders = useMemo(() => {
    const ids = new Set<string>();
    const visit = (nodes: readonly TreeNode[]) => {
      for (const node of nodes) {
        if (node.children !== undefined) {
          ids.add(node.id);
          visit(node.children);
        }
      }
    };
    visit(tree);
    return ids;
  }, [tree]);
  const [expanded, setExpanded] = useState<ReadonlySet<Key>>(new Set());

  // Opening a file reveals it: its folders open (the rest stay as they were).
  useEffect(() => {
    if (selected === undefined) return;
    setExpanded((now) => {
      const needed = ancestorsOf(selected).filter((folder) => !now.has(folder));
      return needed.length === 0 ? now : new Set([...now, ...needed]);
    });
  }, [selected]);

  const renderNode = (node: TreeNode) => (
    <TreeItem
      key={node.id}
      id={node.id}
      textValue={node.name}
      className={classNames(styles.item)}
      data-unsaved={unsaved.has(node.id) ? '' : undefined}
    >
      <TreeItemContent>
        {({ isExpanded }) => (
          <div className={styles.row}>
            <span className={styles.icon} aria-hidden="true">
              {node.children === undefined ? (
                <File size={14} />
              ) : isExpanded ? (
                <FolderOpen size={14} />
              ) : (
                <Folder size={14} />
              )}
            </span>
            <span className={styles.name}>{node.name}</span>
            {unsaved.has(node.id) && (
              <span className={styles.unsaved} role="img" aria-label="unsaved changes" />
            )}
          </div>
        )}
      </TreeItemContent>
      {node.children !== undefined && (
        <Collection items={node.children}>{(child) => renderNode(child)}</Collection>
      )}
    </TreeItem>
  );

  return (
    <Virtualizer layout={ListLayout} layoutOptions={{ rowSize: ROW_HEIGHT }}>
      <Tree
        aria-label={ariaLabel}
        className={classNames(styles.tree, className)}
        items={tree}
        selectionMode="single"
        selectedKeys={selected === undefined ? [] : [selected]}
        expandedKeys={expanded}
        onExpandedChange={setExpanded}
        onAction={(key) => {
          const id = String(key);
          if (folders.has(id)) {
            setExpanded((now) => {
              const next = new Set(now);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          } else {
            onOpen(id);
          }
        }}
        renderEmptyState={() => <p className={styles.empty}>No files yet.</p>}
      >
        {(node) => renderNode(node)}
      </Tree>
    </Virtualizer>
  );
}
