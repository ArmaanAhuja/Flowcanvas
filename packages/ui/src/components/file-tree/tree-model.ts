/** A folder or a file in the tree; `id` is its project-relative path. */
export interface TreeNode {
  readonly id: string;
  readonly name: string;
  /** Folders only. */
  readonly children?: readonly TreeNode[];
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** Folders first, then files; each by name, ignoring case, with numbers in order (file2 before file10). */
function byKindThenName(a: TreeNode, b: TreeNode): number {
  const folders = Number(b.children !== undefined) - Number(a.children !== undefined);
  return folders !== 0 ? folders : collator.compare(a.name, b.name);
}

interface Building {
  readonly id: string;
  readonly name: string;
  readonly folders: Map<string, Building>;
  readonly files: string[];
}

/** Builds the nested tree from a flat list of file paths (as the workspace's file list gives them). */
export function buildTree(paths: readonly string[]): readonly TreeNode[] {
  const root: Building = { id: '', name: '', folders: new Map(), files: [] };
  for (const path of paths) {
    const parts = path.split('/').filter((part) => part !== '');
    let folder = root;
    for (const part of parts.slice(0, -1)) {
      const id = folder.id === '' ? part : `${folder.id}/${part}`;
      let next = folder.folders.get(part);
      if (next === undefined) {
        next = { id, name: part, folders: new Map(), files: [] };
        folder.folders.set(part, next);
      }
      folder = next;
    }
    const name = parts.at(-1);
    if (name !== undefined) folder.files.push(name);
  }
  const finish = (folder: Building): TreeNode[] =>
    [
      ...[...folder.folders.values()].map((child) => ({
        id: child.id,
        name: child.name,
        children: finish(child),
      })),
      ...folder.files.map((name) => ({
        id: folder.id === '' ? name : `${folder.id}/${name}`,
        name,
      })),
    ].sort(byKindThenName);
  return finish(root);
}

/** The folders that contain a path, outermost first: `src/lib/a.ts` → `src`, `src/lib`. */
export function ancestorsOf(path: string): string[] {
  const parts = path.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}
