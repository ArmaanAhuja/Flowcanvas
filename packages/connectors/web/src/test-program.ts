// For tests: a TypeScript program over files held in memory, with its checker, as the engine's pass has one.
import * as ts from 'typescript';
import type { FileContext } from './ast.js';

export function programOf(files: Readonly<Record<string, string>>): (path: string) => FileContext {
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    experimentalDecorators: true,
    allowJs: true,
    noLib: true,
  };
  const host = ts.createCompilerHost(options);
  host.fileExists = (path) => path in files;
  host.readFile = (path) => files[path];
  host.getSourceFile = (path, version) =>
    path in files ? ts.createSourceFile(path, files[path] ?? '', version, true) : undefined;
  const program = ts.createProgram(Object.keys(files), options, host);
  const checker = program.getTypeChecker();
  return (path) => {
    const source = program.getSourceFile(path);
    if (source === undefined) throw new Error(`no ${path}`);
    return { ts, source, checker };
  };
}
