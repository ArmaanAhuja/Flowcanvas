// .env files (build plan v2, phase 3): the names in them, which are set, and setting one. Values are only ever written
// into the file the person chose; nothing here returns, logs or sends a value.
import {
  chmodSync,
  copyFileSync,
  constants,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;
export const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Every name a .env-style file mentions (an example file's list). */
export function parseEnvNames(text: string): string[] {
  const names: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = LINE.exec(line);
    if (match?.[1] !== undefined && !names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

export interface ExampleVariable {
  readonly name: string;
  /** What the comment just above it says: `required` (true), `optional` (false), or nothing (null). */
  readonly required: boolean | null;
}

/** An example file's variables, each with whether its comment says it's required. */
export function parseExample(text: string): ExampleVariable[] {
  const variables: ExampleVariable[] = [];
  let comment: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line)) {
      comment.push(line);
      continue;
    }
    const name = LINE.exec(line)?.[1];
    if (name !== undefined && !variables.some((v) => v.name === name)) {
      const said = comment.join(' ');
      variables.push({
        name,
        required: /\boptional\b/i.test(said) ? false : /\brequired\b/i.test(said) ? true : null,
      });
    }
    // A comment speaks for the group of variables right under it, until a blank line.
    if (line.trim() === '') comment = [];
  }
  return variables;
}

/** A .env file's names and values, in order (quotes removed; a trailing comment isn't part of a value). */
export function parseEnvEntries(text: string): [string, string][] {
  const entries: [string, string][] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = LINE.exec(line);
    if (match?.[1] === undefined) continue;
    const raw = (match[2] ?? '').trim();
    const quote = raw[0];
    const value =
      quote === '"' || quote === "'"
        ? raw.slice(1, Math.max(1, raw.lastIndexOf(quote)))
        : raw.replace(/\s+#.*$/, '');
    entries.push([match[1], value]);
  }
  return entries;
}

/** The names a .env file gives a non-empty value. */
export function parseEnvSet(text: string): string[] {
  return [
    ...new Set(
      parseEnvEntries(text)
        .filter(([, value]) => value !== '')
        .map(([name]) => name),
    ),
  ];
}

/** A value as a .env line keeps it: quoted when it has spaces, quotes, # or $ (no newlines are accepted at all). */
export function formatValue(value: string): string {
  return /^[\w@%+=:,./-]*$/.test(value)
    ? value
    : `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export class EnvProblem extends Error {
  override readonly name = 'EnvProblem';
}

/**
 * Sets `name` in the .env file at `file`: its line replaced where it has one, else added at the end. A new file is
 * readable by its owner only. Written whole and renamed into place, so a crash never leaves half a file.
 */
export function setEnvValue(file: string, name: string, value: string): void {
  if (!VARIABLE_NAME.test(name)) throw new EnvProblem('That isn’t a variable name.');
  if (/[\r\n\0]/.test(value)) throw new EnvProblem('A value can’t span lines.');
  const exists = existsSync(file);
  const lines = exists ? readFileSync(file, 'utf8').split('\n') : [];
  const line = `${name}=${formatValue(value)}`;
  const at = lines.findIndex((l) => LINE.exec(l)?.[1] === name);
  if (at >= 0) lines[at] = line;
  else {
    if (lines.length > 0 && lines.at(-1) === '') lines.pop();
    lines.push(line, '');
  }
  const temporary = `${file}.flowcanvas-tmp`;
  writeFileSync(temporary, lines.join('\n'), { mode: 0o600 });
  renameSync(temporary, file);
  if (!exists) chmodSync(file, 0o600);
}

/** Starts a .env from its example (its defaults are the project's own development values); never overwrites one. */
export function createEnvFile(example: string, file: string): void {
  copyFileSync(example, file, constants.COPYFILE_EXCL);
  chmodSync(file, 0o600);
}
