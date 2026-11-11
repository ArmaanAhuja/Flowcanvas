// Definitions, references, callers and callees from TypeScript's language service (phase 5, ADR 0026). One
// language service per tsconfig, built when a question needs it and released (least recently used first) when memory
// runs high. Answers carry how each is known: resolved by the compiler, or unresolved and never guessed.
import { heap } from './v8.js';
import { basename, dirname, join, relative, sep } from 'node:path';
import type * as TS from 'typescript';
import {
  SEMANTIC_LIMITS,
  type CallEntry,
  type CallsResult,
  type CodeItem,
  type CodePosition,
  type DefinitionResult,
  type ReferencesResult,
  type Relation,
  type SymbolKindName,
} from '../protocol.js';
import { createProjectHost, type ProjectHost } from './host.js';
import { findPackages, ProjectModel, type ProjectConfig, type TypeScript } from './projects.js';

export interface SemanticOptions {
  readonly ts: TypeScript;
  /** The project's folder (absolute). */
  readonly root: string;
  /** The project's files, project-relative (the agent's list). */
  readonly files: readonly string[];
  /** Release language services when the heap passes this share of its limit (ADR 0026 §2). */
  readonly memoryShare?: number;
}

/** Said when part of the project couldn't be looked at. */
export const PARTLY = {
  memory: 'Part of this project is too large to look at here, so some callers may be missing.',
  limit: 'Showing the first results only.',
} as const;

const SOURCE = /\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs)$/;
const MAX_NAME = 120;

interface Live {
  readonly config: ProjectConfig;
  readonly service: TS.LanguageService;
  lastUsed: number;
}

export class SemanticService {
  readonly #ts: TypeScript;
  readonly #root: string;
  readonly #libDir: string;
  readonly #memoryShare: number;
  #files: readonly string[];
  #host: ProjectHost;
  #model: ProjectModel;
  #registry: TS.DocumentRegistry;
  readonly #live = new Map<string, Live>();
  readonly #versions = new Map<string, number>();
  #clock = 0;
  /** Set when a service was released, or couldn't be built, for memory: answers say they may be partial. */
  #squeezed = false;

  constructor(options: SemanticOptions) {
    this.#ts = options.ts;
    this.#root = options.root;
    this.#libDir = dirname(
      options.ts.getDefaultLibFilePath({ target: options.ts.ScriptTarget.ESNext }),
    );
    this.#memoryShare = options.memoryShare ?? 0.7;
    this.#files = options.files;
    this.#registry = options.ts.createDocumentRegistry(true, options.root);
    ({ host: this.#host, model: this.#model } = this.#build(options.files));
  }

  #build(files: readonly string[]): { host: ProjectHost; model: ProjectModel } {
    // package.json files are read before the host knows the packages: inside the project, never secret.
    const bootstrap = createProjectHost({
      root: this.#root,
      libDir: this.#libDir,
      packages: new Map(),
    });
    const packages = findPackages(this.#root, files, bootstrap.readFile);
    const host = createProjectHost({
      root: this.#root,
      libDir: this.#libDir,
      packages: new Map([...packages.values()].map((p) => [p.name, join(this.#root, p.dir)])),
    });
    return { host, model: new ProjectModel(this.#ts, this.#root, host, files, packages) };
  }

  /**
   * Files changed or were deleted in the project (the watcher's events). Their versions go up, so each language
   * service re-checks only them; a new file, or a change to a tsconfig or package.json, rebuilds the model and the
   * services on their next use.
   */
  changed(paths: readonly string[], files?: readonly string[]): void {
    let structural = files !== undefined;
    for (const path of paths) {
      const absolute = join(this.#root, path);
      this.#versions.set(absolute, (this.#versions.get(absolute) ?? 0) + 1);
      const name = path.split('/').pop() ?? '';
      if (name === 'tsconfig.json' || name === 'package.json') structural = true;
      else if (SOURCE.test(path) && !this.#files.includes(path)) structural = true;
    }
    if (files !== undefined) this.#files = files;
    if (structural) {
      for (const live of this.#live.values()) live.service.dispose();
      this.#live.clear();
      this.#registry = this.#ts.createDocumentRegistry(true, this.#root);
      ({ host: this.#host, model: this.#model } = this.#build(this.#files));
    }
  }

  /** Releases every language service. */
  dispose(): void {
    for (const live of this.#live.values()) live.service.dispose();
    this.#live.clear();
  }

  // The language services.

  #service(config: ProjectConfig): TS.LanguageService | undefined {
    const live = this.#live.get(config.path);
    if (live !== undefined) {
      live.lastUsed = ++this.#clock;
      return live.service;
    }
    this.#makeRoom();
    const parsed = this.#model.parse(config);
    if (parsed === null) return undefined;
    const ts = this.#ts;
    const host = this.#host;
    const directory = join(this.#root, config.path, '..');
    const service = ts.createLanguageService(
      {
        getCompilationSettings: () => parsed.options,
        getScriptFileNames: () => [...parsed.fileNames],
        getScriptVersion: (file) => String(this.#versions.get(file) ?? 0),
        getScriptSnapshot: (file) => {
          const text = host.readFile(file);
          return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
        },
        getCurrentDirectory: () => directory,
        getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
        fileExists: host.fileExists,
        readFile: host.readFile,
        directoryExists: host.directoryExists,
        getDirectories: host.getDirectories,
        realpath: host.realpath,
        useCaseSensitiveFileNames: () => true,
      },
      this.#registry,
    );
    this.#live.set(config.path, { config, service, lastUsed: ++this.#clock });
    return service;
  }

  /** Before building another language service: release the least recently used while the heap is high. */
  #makeRoom(): void {
    const { used, limit } = heap.read();
    if (used < limit * this.#memoryShare) return;
    const oldest = [...this.#live.values()].sort((a, b) => a.lastUsed - b.lastUsed);
    for (const live of oldest) {
      live.service.dispose();
      this.#live.delete(live.config.path);
      this.#squeezed = true;
      if (heap.read().used < limit * this.#memoryShare) return;
    }
  }

  /** The language services whose programs hold `file`, among `configs`, with the file's source. */
  *#holding(
    configs: readonly ProjectConfig[],
    file: string,
  ): Generator<{ service: TS.LanguageService; program: TS.Program; source: TS.SourceFile }> {
    for (const config of configs) {
      const service = this.#service(config);
      const program = service?.getProgram();
      const source = program?.getSourceFile(file);
      if (service !== undefined && program !== undefined && source !== undefined) {
        yield { service, program, source };
      }
    }
  }

  // Places.

  #offset(source: TS.SourceFile, line: number, column: number): number {
    const lines = source.getLineStarts();
    const index = Math.min(Math.max(line - 1, 0), lines.length - 1);
    const start = lines[index] ?? 0;
    const end =
      index + 1 < lines.length ? (lines[index + 1] ?? source.text.length) : source.text.length;
    return Math.min(start + Math.max(column - 1, 0), end);
  }

  #inProject(file: string): boolean {
    const r = relative(this.#root, file);
    return r !== '' && !r.startsWith('..') && !r.split(sep).includes('node_modules');
  }

  #builtIn(file: string): boolean {
    return relative(this.#libDir, file).split(sep)[0] !== '..';
  }

  #position(program: TS.Program, file: string, offset: number): CodePosition | null {
    if (!this.#inProject(file)) return null;
    const source = program.getSourceFile(file);
    if (source === undefined) return null;
    const { line, character } = source.getLineAndCharacterOfPosition(offset);
    return {
      path: relative(this.#root, file).split(sep).join('/'),
      line: line + 1,
      column: character + 1,
    };
  }

  #item(program: TS.Program, item: TS.CallHierarchyItem): CodeItem {
    const builtIn = this.#builtIn(item.file);
    const isModule = item.kind === this.#ts.ScriptElementKind.moduleElement;
    return {
      // Calls outside any named function (a module's top level, an anonymous callback there): the file's name,
      // "(top level)" (owner, 12 Nov 2026).
      name: isModule ? `${basename(item.file)} (top level)` : cut(item.name),
      kind: kindOf(this.#ts, item.kind, item.name),
      container: containerOf(item.containerName),
      place: builtIn ? null : this.#position(program, item.file, item.selectionSpan.start),
      builtIn,
    };
  }

  /** `renders` when the call at `start` is a JSX element's tag; `calls` otherwise. */
  #relation(source: TS.SourceFile, start: number): Relation {
    const ts = this.#ts;
    let node = findNode(ts, source, start);
    while (node !== undefined && node !== source) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) return 'renders';
      if (
        ts.isCallExpression(node) ||
        ts.isNewExpression(node) ||
        ts.isTaggedTemplateExpression(node)
      ) {
        return 'calls';
      }
      node = node.parent;
    }
    return 'calls';
  }

  /** The callable at a place: what TypeScript's call hierarchy starts from. */
  #target(path: string, line: number, column: number) {
    const file = join(this.#root, path);
    for (const held of this.#holding(this.#model.configsFor(file), file)) {
      const offset = this.#offset(held.source, line, column);
      const prepared = held.service.prepareCallHierarchy(file, offset);
      const item = Array.isArray(prepared) ? prepared[0] : prepared;
      if (item !== undefined) return { item, program: held.program };
    }
    return undefined;
  }

  // The questions.

  definition(path: string, line: number, column: number): DefinitionResult {
    const file = join(this.#root, path);
    for (const { service, program, source } of this.#holding(this.#model.configsFor(file), file)) {
      const found = service.getDefinitionAtPosition(file, this.#offset(source, line, column));
      if (found === undefined || found.length === 0) continue;
      const definitions = found.slice(0, SEMANTIC_LIMITS.definitions).flatMap((d): CodeItem[] => {
        const builtIn = this.#builtIn(d.fileName);
        if (!builtIn && !this.#inProject(d.fileName)) return [];
        return [
          {
            name: cut(d.name),
            kind: kindOf(this.#ts, d.kind, d.name),
            container: containerOf(d.containerName),
            place: builtIn ? null : this.#position(program, d.fileName, d.textSpan.start),
            builtIn,
          },
        ];
      });
      return { definitions, message: null };
    }
    return { definitions: [], message: 'Nothing here has a definition the project can show.' };
  }

  references(path: string, line: number, column: number): ReferencesResult {
    const target = this.#target(path, line, column);
    const file = join(this.#root, path);
    const configs = this.#model.callerConfigsFor(target?.item.file ?? file);
    const seen = new Map<string, CodePosition & { isDefinition: boolean }>();
    let complete = true;
    for (const { service, program, source } of this.#holding(configs, file)) {
      for (const symbol of service.findReferences(file, this.#offset(source, line, column)) ?? []) {
        for (const reference of symbol.references) {
          const place = this.#position(program, reference.fileName, reference.textSpan.start);
          if (place === null) continue;
          const key = `${place.path}:${String(place.line)}:${String(place.column)}`;
          if (seen.has(key)) continue;
          if (seen.size >= SEMANTIC_LIMITS.references) {
            complete = false;
            break;
          }
          seen.set(key, { ...place, isDefinition: reference.isDefinition === true });
        }
      }
    }
    if (this.#squeezed) complete = false;
    return {
      target: target === undefined ? null : this.#item(target.program, target.item),
      references: [...seen.values()],
      complete,
      message: complete ? null : this.#squeezed ? PARTLY.memory : PARTLY.limit,
    };
  }

  callers(path: string, line: number, column: number): CallsResult {
    this.#squeezed = false;
    const target = this.#target(path, line, column);
    if (target === undefined) return nothingCallable();
    const { item } = target;
    const entries = new Map<string, CallEntry & { sites: CodePosition[] }>();
    let complete = true;
    for (const { service, program } of this.#holding(
      this.#model.callerConfigsFor(item.file),
      item.file,
    )) {
      for (const call of service.provideCallHierarchyIncomingCalls(
        item.file,
        item.selectionSpan.start,
      )) {
        const from = this.#item(program, call.from);
        const source = program.getSourceFile(call.from.file);
        if (source === undefined || !this.#inProject(call.from.file)) continue;
        for (const span of call.fromSpans) {
          const relation = this.#relation(source, span.start);
          const key = `${call.from.file}:${String(call.from.selectionSpan.start)}:${relation}`;
          let entry = entries.get(key);
          if (entry === undefined) {
            if (entries.size >= SEMANTIC_LIMITS.entries) {
              complete = false;
              continue;
            }
            entry = { ...from, relation, provenance: 'resolved', sites: [] };
            entries.set(key, entry);
          }
          const site = this.#position(program, call.from.file, span.start);
          if (
            site !== null &&
            entry.sites.length < SEMANTIC_LIMITS.sites &&
            !entry.sites.some((s) => s.line === site.line && s.column === site.column)
          ) {
            entry.sites.push(site);
          }
        }
      }
    }
    return this.#answer(target, [...entries.values()], complete);
  }

  callees(path: string, line: number, column: number): CallsResult {
    this.#squeezed = false;
    const target = this.#target(path, line, column);
    if (target === undefined) return nothingCallable();
    const { item, program } = target;
    const source = program.getSourceFile(item.file);
    const service = [...this.#holding(this.#model.configsFor(item.file), item.file)][0]?.service;
    if (source === undefined || service === undefined) return nothingCallable();
    const entries = new Map<string, CallEntry & { sites: CodePosition[] }>();
    const starts = new Map<string, Set<number>>();
    // Where TypeScript's hierarchy already put a call (its spans start where the callee expression starts).
    const covered = new Set<number>();
    let complete = true;
    const add = (
      key: string,
      base: CodeItem,
      relation: Relation,
      resolved: boolean,
      start: number,
    ) => {
      let entry = entries.get(key);
      if (entry === undefined) {
        if (entries.size >= SEMANTIC_LIMITS.entries) {
          complete = false;
          return;
        }
        entry = { ...base, relation, provenance: resolved ? 'resolved' : 'unresolved', sites: [] };
        entries.set(key, entry);
      }
      // Each call once, however many declarations TypeScript matched it to.
      const seen = starts.get(key) ?? new Set<number>();
      starts.set(key, seen);
      if (seen.has(start)) return;
      seen.add(start);
      const site = this.#position(program, item.file, start);
      if (site !== null && entry.sites.length < SEMANTIC_LIMITS.sites) entry.sites.push(site);
    };
    // A built-in has no place; its overloads sit in several lib files: one row per name (found by the corpus
    // check, `split` listed twice).
    const keyOf = (base: CodeItem, file: string, start: number, relation: Relation) =>
      base.builtIn ? `builtin:${base.name}:${relation}` : `${file}:${String(start)}:${relation}`;
    for (const call of service.provideCallHierarchyOutgoingCalls(
      item.file,
      item.selectionSpan.start,
    )) {
      const to = this.#item(program, call.to);
      for (const span of call.fromSpans) {
        covered.add(span.start);
        const relation = this.#relation(source, span.start);
        add(
          keyOf(to, call.to.file, call.to.selectionSpan.start, relation),
          to,
          relation,
          true,
          span.start,
        );
      }
    }
    // The calls TypeScript's hierarchy leaves out: those it can't resolve (shown as unresolved, never guessed), and
    // those it resolves to something its hierarchy doesn't model, such as a constant holding a function (`nanoid`)
    // or a built-in declared as a variable (`Boolean`, `new Error`).
    for (const site of this.#callSites(program, source, item)) {
      if (covered.has(site.start)) continue;
      const declared = site.declaration;
      if (declared === null) {
        add(
          `unresolved:${site.text}:${site.relation}`,
          { name: cut(site.text), kind: null, container: null, place: null, builtIn: false },
          site.relation,
          false,
          site.start,
        );
        continue;
      }
      const builtIn = this.#builtIn(declared.file);
      const base: CodeItem = {
        name: cut(declared.name),
        kind: kindOf(this.#ts, declared.kind, declared.name),
        container: declared.container === null ? null : cut(declared.container),
        place: builtIn ? null : this.#position(program, declared.file, declared.start),
        builtIn,
      };
      add(
        keyOf(base, declared.file, declared.start, site.relation),
        base,
        site.relation,
        true,
        site.start,
      );
    }
    return this.#answer(target, [...entries.values()], complete);
  }

  #answer(
    target: { item: TS.CallHierarchyItem; program: TS.Program },
    entries: CallEntry[],
    complete: boolean,
  ): CallsResult {
    const done = complete && !this.#squeezed;
    return {
      target: this.#item(target.program, target.item),
      entries,
      complete: done,
      message: done ? null : this.#squeezed ? PARTLY.memory : PARTLY.limit,
    };
  }

  /**
   * Call, `new` and JSX sites in the function's own body (not in a named function inside it, as TypeScript's hierarchy
   * counts them), each with what the compiler resolves its callee to, or null when it can't: a package without
   * types, `obj[key]()`. HTML elements (`<div>`) aren't calls; `super()` and `import()` aren't either.
   */
  #callSites(program: TS.Program, source: TS.SourceFile, item: TS.CallHierarchyItem): CallSite[] {
    const ts = this.#ts;
    const checker = program.getTypeChecker();
    const root = callableAt(ts, source, item.selectionSpan.start);
    if (root === undefined) return [];
    const found: CallSite[] = [];
    const declarationOf = (expression: TS.Node) => {
      const symbol = checker.getSymbolAtLocation(expression);
      const target =
        symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(symbol)
          : symbol;
      const declaration = target?.valueDeclaration ?? target?.declarations?.[0];
      if (target === undefined || declaration === undefined) return null;
      const file = declaration.getSourceFile();
      // A parameter, a local or a destructured name holds whatever it's given at run time: the compiler finds the
      // name, not the function, so the call stays unresolved (CLAUDE.md rule 4). Built-ins, module-level constants
      // and interface or class members are fixed: resolved.
      if (!this.#builtIn(file.fileName) && !isFixedCallee(ts, declaration)) return null;
      const name = ts.getNameOfDeclaration(declaration) ?? declaration;
      const owner = declaration.parent;
      return {
        file: file.fileName,
        start: name.getStart(file),
        name: target.getName(),
        kind: kindOfDeclaration(ts, declaration),
        container:
          (ts.isInterfaceDeclaration(owner) || ts.isClassLike(owner)) && owner.name !== undefined
            ? owner.name.text
            : null,
      };
    };
    const visit = (node: TS.Node): void => {
      if (node !== root && isNamedCallable(ts, node)) return;
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const callee = node.expression;
        // An IIFE, `(() => …)()`: its body is this function's own code, scanned below; the call itself isn't
        // unknown (found by the corpus check, Documenso's SignaturePad).
        let inline: TS.Expression = callee;
        while (ts.isParenthesizedExpression(inline)) inline = inline.expression;
        const skip =
          callee.kind === ts.SyntaxKind.SuperKeyword ||
          callee.kind === ts.SyntaxKind.ImportKeyword ||
          ts.isArrowFunction(inline) ||
          ts.isFunctionExpression(inline);
        const name = ts.isPropertyAccessExpression(callee) ? callee.name : callee;
        if (!skip) {
          found.push({
            start: callee.getStart(source),
            text: calleeText(ts, callee, source),
            relation: 'calls',
            declaration: declarationOf(name),
          });
        }
      } else if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName;
        const intrinsic = ts.isIdentifier(tag) && /^[a-z]/.test(tag.text);
        const name = ts.isPropertyAccessExpression(tag) ? tag.name : tag;
        if (!intrinsic) {
          found.push({
            start: tag.getStart(source),
            text: calleeText(ts, tag, source),
            relation: 'renders',
            declaration: declarationOf(name),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    if (ts.isSourceFile(root) || ts.isClassLike(root)) ts.forEachChild(root, visit);
    else if (ts.isFunctionLike(root)) {
      // A signature (in an interface or an overload list) has no body.
      const body = (root as TS.SignatureDeclaration & { readonly body?: TS.Node }).body;
      if (body !== undefined) visit(body);
    }
    return found;
  }
}

/** A call in a function's body, and the declaration the compiler resolves its callee to (null: it can't). */
interface CallSite {
  readonly start: number;
  readonly text: string;
  readonly relation: Relation;
  readonly declaration: {
    readonly file: string;
    readonly start: number;
    readonly name: string;
    readonly kind: TS.ScriptElementKind;
    readonly container: string | null;
  } | null;
}

/**
 * A callee whose function is fixed where it's declared: a module-level constant or variable (`export const nanoid =
 * customAlphabet(…)`), or a member of an interface, type or class. Not a parameter, a local, a destructured name or
 * an object literal's property: those hold whatever they're given at run time.
 */
function isFixedCallee(ts: TypeScript, declaration: TS.Declaration): boolean {
  if (ts.isVariableDeclaration(declaration)) {
    const statement = declaration.parent.parent;
    return (
      ts.isIdentifier(declaration.name) &&
      ts.isVariableStatement(statement) &&
      (ts.isSourceFile(statement.parent) || ts.isModuleBlock(statement.parent))
    );
  }
  return (
    ts.isPropertySignature(declaration) ||
    ts.isPropertyDeclaration(declaration) ||
    ts.isMethodSignature(declaration) ||
    ts.isMethodDeclaration(declaration) ||
    ts.isFunctionDeclaration(declaration) ||
    ts.isClassLike(declaration)
  );
}

/**
 * A declaration TypeScript's call hierarchy treats as its own callable (its `isValidCallHierarchyDeclaration`): a
 * function, method, accessor or class, a named function expression, or a function or class assigned to a constant
 * or a class property. Its calls are its own, not the enclosing function's.
 */
function isNamedCallable(ts: TypeScript, node: TS.Node): boolean {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isClassStaticBlockDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name))
  ) {
    return true;
  }
  if ((ts.isFunctionExpression(node) || ts.isClassExpression(node)) && node.name !== undefined)
    return true;
  if (!(ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isClassExpression(node)))
    return false;
  const parent = node.parent;
  return (
    (ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent)) &&
    parent.initializer === node &&
    ts.isIdentifier(parent.name) &&
    (ts.isPropertyDeclaration(parent) ||
      (ts.getCombinedNodeFlags(parent) & ts.NodeFlags.Const) !== 0)
  );
}

/**
 * The callable whose name is at `position`: the function, method or class itself, or, for `const f = () => …`, the
 * function assigned (climbing from the name reaches the file, and the whole file was scanned: found by the corpus
 * check, `createPoll` listed calls from the functions after it).
 */
function callableAt(ts: TypeScript, source: TS.SourceFile, position: number): TS.Node | undefined {
  let node = findNode(ts, source, position);
  while (node !== undefined && !ts.isSourceFile(node)) {
    if (ts.isFunctionLike(node) || ts.isClassLike(node)) return node;
    if (
      (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
      node.initializer !== undefined &&
      isNamedCallable(ts, node.initializer)
    ) {
      return node.initializer;
    }
    node = node.parent;
  }
  return node;
}

/**
 * A callee as written, a call's arguments shortened: `Buffer.concat(…).toString`, not the whole array passed to
 * `concat` (found by the corpus check). Anything else (`(save as () => void)`) as written; `cut` caps it.
 */
function calleeText(ts: TypeScript, node: TS.Node, source: TS.SourceFile): string {
  if (ts.isPropertyAccessExpression(node)) {
    return `${calleeText(ts, node.expression, source)}.${node.name.getText(source)}`;
  }
  if (ts.isCallExpression(node)) return `${calleeText(ts, node.expression, source)}(…)`;
  if (ts.isElementAccessExpression(node)) return `${calleeText(ts, node.expression, source)}[…]`;
  if (ts.isNonNullExpression(node)) return `${calleeText(ts, node.expression, source)}!`;
  return node.getText(source);
}

/** A declaration's kind in TypeScript's words, for `kindOf`. */
function kindOfDeclaration(ts: TypeScript, node: TS.Declaration): TS.ScriptElementKind {
  const K = ts.ScriptElementKind;
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))
    return K.functionElement;
  // A property holding a function is called like a method, and listed as one.
  if (
    ts.isMethodDeclaration(node) ||
    ts.isMethodSignature(node) ||
    ts.isPropertySignature(node) ||
    ts.isPropertyDeclaration(node)
  ) {
    return K.memberFunctionElement;
  }
  if (ts.isClassLike(node)) return K.classElement;
  if (ts.isVariableDeclaration(node))
    return (ts.getCombinedNodeFlags(node) & ts.NodeFlags.Const) !== 0
      ? K.constElement
      : K.variableElement;
  if (ts.isInterfaceDeclaration(node)) return K.interfaceElement;
  return K.unknown;
}

function nothingCallable(): CallsResult {
  return {
    target: null,
    entries: [],
    complete: true,
    message: 'Put the cursor on a function, method or component to see its calls.',
  };
}

/** A class or namespace a name sits in; a module (TypeScript gives its quoted name) isn't one. */
const containerOf = (name: string | undefined): string | null =>
  name === undefined || name === '' || name.startsWith('"') || name.startsWith("'")
    ? null
    : cut(name);

const cut = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_NAME ? `${flat.slice(0, MAX_NAME - 1)}…` : flat;
};

/** The innermost node that contains `position`. */
function findNode(ts: TypeScript, source: TS.SourceFile, position: number): TS.Node | undefined {
  let found: TS.Node | undefined;
  const visit = (node: TS.Node) => {
    if (position >= node.getStart(source) && position < node.getEnd()) {
      found = node;
      ts.forEachChild(node, visit);
    }
  };
  ts.forEachChild(source, visit);
  return found;
}

/** TypeScript's element kinds, in the index's words; components are PascalCase functions (as in ADR 0024). */
function kindOf(ts: TypeScript, kind: TS.ScriptElementKind, name: string): SymbolKindName | null {
  const K = ts.ScriptElementKind;
  switch (kind) {
    case K.functionElement:
    case K.localFunctionElement:
    case K.constElement:
    case K.letElement:
    case K.variableElement:
    case K.localVariableElement:
      return /^[A-Z]/.test(name) ? 'component' : 'function';
    case K.memberFunctionElement:
    case K.constructorImplementationElement:
    case K.memberGetAccessorElement:
    case K.memberSetAccessorElement:
      return 'method';
    case K.classElement:
    case K.localClassElement:
      return 'class';
    case K.interfaceElement:
      return 'interface';
    case K.typeElement:
      return 'type';
    case K.enumElement:
      return 'enum';
    case K.moduleElement:
      return null;
    default:
      return null;
  }
}
