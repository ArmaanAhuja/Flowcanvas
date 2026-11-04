import type { ITheme } from '@xterm/xterm';

/**
 * The terminal's colours, read from the design tokens at runtime (xterm draws with values, not CSS variables),
 * so they follow the theme and nothing is hard-coded. ANSI colours without a matching token keep xterm's own.
 */
const TOKENS: Partial<Record<keyof ITheme, string>> = {
  background: '--color-surface-canvas',
  foreground: '--color-text-primary',
  cursor: '--color-text-primary',
  cursorAccent: '--color-surface-canvas',
  selectionBackground: '--color-accent-tint',
  black: '--color-surface-raised',
  red: '--color-state-removed-text',
  green: '--color-state-added-text',
  yellow: '--color-state-modified-text',
  blue: '--color-accent-text',
  magenta: '--color-state-affected-text',
  white: '--color-text-secondary',
  brightBlack: '--color-text-muted',
  brightWhite: '--color-text-primary',
};

export function terminalTheme(element: Element = document.documentElement): ITheme {
  const style = getComputedStyle(element);
  const theme: ITheme = {};
  for (const [key, variable] of Object.entries(TOKENS) as [keyof ITheme, string][]) {
    const value = style.getPropertyValue(variable).trim();
    if (value !== '') (theme as Record<string, string>)[key] = value;
  }
  return theme;
}

/** The mono text style's font, for xterm's own measurements; without the tokens, xterm keeps its own. */
export function terminalFont(element: Element = document.documentElement): {
  fontFamily?: string;
  fontSize?: number;
} {
  const style = getComputedStyle(element);
  const fontFamily = style.getPropertyValue('--text-mono-font-family').trim();
  const fontSize = Number.parseFloat(style.getPropertyValue('--text-mono-font-size'));
  return {
    ...(fontFamily === '' ? {} : { fontFamily }),
    ...(Number.isFinite(fontSize) ? { fontSize } : {}),
  };
}
