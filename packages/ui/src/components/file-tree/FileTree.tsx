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
  /** The file shown in the editor: marked, and its folders opened so it's in view. */
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

  const choose = (id: string) => {
    if (folders.has(id)) {
      setExpanded((now) => {
        const next = new Set(now);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else if (id !== selected) {
      onOpen(id);
    }
  };

  const renderNode = (node: TreeNode) => (
    <TreeItem
      key={node.id}
      id={node.id}
      // The row's accessible name: what it is, then whether it's the open file and has unsaved changes.
      textValue={[
        node.name,
        ...(node.id === selected ? ['open in the editor'] : []),
        ...(unsaved.has(node.id) ? ['unsaved changes'] : []),
      ].join(', ')}
      className={classNames(styles.item)}
      data-current={node.id === selected ? '' : undefined}
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
            {unsaved.has(node.id) && <span className={styles.unsaved} aria-hidden="true" />}
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
        // React Aria caches each row by its item; these change a row's name and look, so rows re-render with them.
        dependencies={[selected, unsaved]}
        // No selection: a click or Enter always acts (a file opens, a folder opens or closes) and the arrow keys only
        // move. With selection, React Aria turns clicks into selection changes once something is selected, or makes
        // arrows select as they move (found by the Code view's test, phase 3 step 5). The open file is marked in
        // its name and by data-current instead.
        selectionMode="none"
        expandedKeys={expanded}
        onExpandedChange={setExpanded}
        onAction={(key) => {
          choose(String(key));
        }}
        renderEmptyState={() => <p className={styles.empty}>No files yet.</p>}
      >
        {(node) => renderNode(node)}
      </Tree>
    </Virtualizer>
  );
}
