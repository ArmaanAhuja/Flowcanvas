// Symbols: the named things in a file that ⌘K finds (phase 4, ADR 0024). Purely syntactic: the
// tree says a name is declared here, and nothing more. Which `save()` a call reaches is phase 5.
import type { Node, Tree } from 'web-tree-sitter';
import type { LanguageId } from './grammars.js';
import { SYMBOL_KIND_NAMES, type SymbolKindName } from './protocol.js';

// One list, shared with the protocol that checks the engine's answers.
export const SYMBOL_KINDS = SYMBOL_KIND_NAMES;
export type SymbolKind = SymbolKindName;

export interface FileSymbol {
  readonly name: string;
  readonly kind: SymbolKind;
  /** The class, namespace or (for a heading) the parent heading it sits in, if any. */
  readonly container: string | null;
  /** 1-based line of the name. */
  readonly line: number;
  /** 1-based column of the name, in UTF-16 code units (as the editor counts them). */
  readonly column: number;
  /** Exported from its module (always false for headings). */
  readonly exported: boolean;
}

/**
 * The symbols of a parsed file. TypeScript and JavaScript: declarations at module level (and in
 * namespaces) plus class methods; local variables and functions inside functions are not
 * symbols. Markdown: headings. Other languages are parsed and counted, with no symbols (owner,
 * 9 Nov 2026).
 */
export function extractSymbols(language: LanguageId, tree: Tree): FileSymbol[] {
  switch (language) {
    case 'typescript':
    case 'tsx':
    case 'javascript':
      return scriptSymbols(tree.rootNode, language !== 'typescript');
    case 'markdown':
      return headings(tree.rootNode);
    default:
      return [];
  }
}

// TypeScript and JavaScript.

const JSX = ['jsx_element', 'jsx_self_closing_element', 'jsx_fragment'];
const FUNCTION_VALUES = new Set(['arrow_function', 'function_expression', 'function']);

function scriptSymbols(root: Node, jsx: boolean): FileSymbol[] {
  const symbols: FileSymbol[] = [];
  const exportedNames = namesInExportClauses(root);

  const add = (nameNode: Node, kind: SymbolKind, container: string | null, exported: boolean) => {
    symbols.push({
      name: nameNode.text,
      kind,
      container,
      line: nameNode.startPosition.row + 1,
      column: nameNode.startPosition.column + 1,
      exported: exported || (container === null && exportedNames.has(nameNode.text)),
    });
  };

  // A function is a component when it's named like one (PascalCase) and returns JSX somewhere in
  // its body: the React convention, read from syntax alone.
  const functionKind = (name: string, body: Node | null): SymbolKind =>
    jsx && body !== null && /^[A-Z]/.test(name) && body.descendantsOfType(JSX).length > 0
      ? 'component'
      : 'function';

  const visit = (node: Node, container: string | null, exported: boolean) => {
    const name = node.childForFieldName('name');
    switch (node.type) {
      case 'export_statement': {
        const declaration = node.childForFieldName('declaration');
        if (declaration !== null) visit(declaration, container, true);
        return;
      }
      case 'function_declaration':
      case 'generator_function_declaration':
      case 'function_signature':
        if (name !== null)
          add(name, functionKind(name.text, node.childForFieldName('body')), container, exported);
        return;
      case 'class_declaration':
      case 'abstract_class_declaration':
      case 'class': {
        if (name === null) return;
        add(name, 'class', container, exported);
        for (const member of node.childForFieldName('body')?.namedChildren ?? []) {
          const memberName = member.childForFieldName('name');
          if (member.type === 'method_definition' && memberName) {
            add(memberName, 'method', name.text, false);
          }
        }
        return;
      }
      case 'interface_declaration':
        if (name !== null) add(name, 'interface', container, exported);
        return;
      case 'type_alias_declaration':
        if (name !== null) add(name, 'type', container, exported);
        return;
      case 'enum_declaration':
        if (name !== null) add(name, 'enum', container, exported);
        return;
      case 'lexical_declaration':
      case 'variable_declaration': {
        const isConst = node.firstChild?.type === 'const';
        for (const declarator of node.namedChildren) {
          if (declarator.type !== 'variable_declarator') continue;
          const declared = declarator.childForFieldName('name');
          if (declared?.type !== 'identifier') continue; // destructuring declares no one name
          const value = declarator.childForFieldName('value');
          const kind = valueKind(declared.text, value, isConst);
          if (kind !== null) add(declared, kind, container, exported);
        }
        return;
      }
      case 'ambient_declaration':
      case 'expression_statement':
        for (const child of node.namedChildren) visit(child, container, exported);
        return;
      case 'internal_module':
      case 'module': {
        if (name === null) return;
        add(name, 'namespace', container, exported);
        for (const child of node.childForFieldName('body')?.namedChildren ?? []) {
          visit(child, name.text, false);
        }
        return;
      }
      default:
        return;
    }
  };

  // `const Button = () => …`, `const Card = forwardRef(() => <div />)` and `const LIMIT = 10`.
  // Only `const` is a constant; a `let` or `var` holding a function is still a function.
  const valueKind = (name: string, value: Node | null, isConst: boolean): SymbolKind | null => {
    if (value !== null && FUNCTION_VALUES.has(value.type)) {
      return functionKind(name, value.childForFieldName('body'));
    }
    if (value?.type === 'call_expression' && jsx && /^[A-Z]/.test(name)) {
      const wrapped = value
        .childForFieldName('arguments')
        ?.namedChildren.find((argument) => FUNCTION_VALUES.has(argument.type));
      if (wrapped) return functionKind(name, wrapped.childForFieldName('body'));
    }
    return isConst ? 'constant' : null;
  };

  for (const child of root.namedChildren) visit(child, null, false);
  return symbols;
}

/** Names exported by `export { a, b as c }` (without `from`, which re-exports another module). */
function namesInExportClauses(root: Node): Set<string> {
  const names = new Set<string>();
  for (const statement of root.namedChildren) {
    if (statement.type !== 'export_statement' || statement.childForFieldName('source')) continue;
    for (const specifier of statement.descendantsOfType('export_specifier')) {
      const local = specifier.childForFieldName('name');
      if (local) names.add(local.text);
    }
  }
  return names;
}

// Markdown (and MDX, read as Markdown).

function headings(root: Node): FileSymbol[] {
  const symbols: FileSymbol[] = [];
  // The headings above the current one, by level, so each knows its parent.
  const open: { level: number; name: string }[] = [];
  for (const heading of root.descendantsOfType(['atx_heading', 'setext_heading'])) {
    const content = heading.childForFieldName('heading_content');
    if (content === null) continue;
    // `## Title ##`: an ATX heading's optional closing hashes aren't part of its text (CommonMark).
    const text = content.text;
    const name = (heading.type === 'atx_heading' ? text.replace(/(^|\s)#+\s*$/, '') : text)
      .replace(/\s+/g, ' ')
      .trim();
    if (name === '') continue;
    const level = headingLevel(heading);
    while (open.length > 0 && (open.at(-1)?.level ?? 0) >= level) open.pop();
    symbols.push({
      name,
      kind: 'heading',
      container: open.at(-1)?.name ?? null,
      line: content.startPosition.row + 1,
      column: content.startPosition.column + 1,
      exported: false,
    });
    open.push({ level, name });
  }
  return symbols;
}

function headingLevel(heading: Node): number {
  for (const child of heading.children) {
    const match = /^(?:atx_h(\d)_marker|setext_h(\d)_underline)$/.exec(child.type);
    if (match) return Number(match[1] ?? match[2]);
  }
  return 1;
}
