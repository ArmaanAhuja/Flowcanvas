/**
 * Labs: unfinished features that can go live behind a switch, off by default and marked as a preview,
 * so `main` stays shippable while a feature takes several phases. When a feature is finished, delete its
 * entry here and its <LabsFeature> wrappers: it is then simply on for everyone.
 */
export interface LabsFlag {
  /** Stable kebab-case id, e.g. "canvas-minimap". Stored in the browser, so don't rename it. */
  readonly id: string;
  /** Sentence case, e.g. "Canvas minimap". */
  readonly label: string;
  /** What turning it on shows, and what is still unfinished. */
  readonly description: string;
  /** The build-plan phase that finishes it, e.g. "2". */
  readonly phase: string;
}

/** Every switch ships off. */
export const LABS_FLAGS: readonly LabsFlag[] = [
  {
    id: 'canvas-stress-test',
    label: 'Canvas stress test',
    description:
      'Fills every project’s canvas with 500 example nodes, to try panning and zooming at scale. They are examples, not your project’s flows, and the canvas says so.',
    phase: '2',
  },
  {
    id: 'graph-stats',
    label: 'Graph stats',
    description:
      'Shows what the project’s flow graph holds in the inspector’s Details tab: nodes and edges by kind, how each edge is known, and how long the graph took to build, save and load. It counts the graph the canvas will draw; the flows themselves arrive with the flow builder.',
    phase: '7',
  },
];
