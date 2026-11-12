// Analysis engine: indexer, parsers, resolvers and flow builder. It runs inside each workspace.
// Phase 4: the grammars, symbol extraction, the SQLite index and the incremental indexer.
export const PACKAGE_NAME = '@flowcanvas/engine';

export {
  GRAMMAR_FILE_NAMES,
  packagedGrammarFiles,
  RUNTIME_FILE_NAME,
  useGrammarDirectory,
  languageOf,
  limitationOf,
  loadGrammars,
  type LanguageId,
  type Limitation,
} from './grammars.js';
export { extractSymbols, SYMBOL_KINDS, type FileSymbol, type SymbolKind } from './symbols.js';
export {
  INDEX_FORMAT,
  IndexStore,
  type FileRecord,
  type FileStatus,
  type IndexCounts,
  type StoredSymbol,
} from './store.js';
export {
  indexable,
  Indexer,
  type ChangedPath,
  type IndexerOptions,
  type IndexProgress,
  type IndexRun,
} from './indexer.js';
export {
  SNAPSHOT_STORE_FORMAT,
  SNAPSHOTS_KEPT,
  SnapshotStore,
  type SnapshotMeta,
} from './snapshots.js';
