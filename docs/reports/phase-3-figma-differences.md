# Phase 3: Figma 11 and 16 and what's built, side by side

For the owner's review by eye. Figma is the layout reference; Graphite outranks it on everything visual (CLAUDE.md section 2), and colour values come from the tokens. The screen baselines (`e2e/visual/__screenshots__/screens-code-*`) catch changes from what's built; this list says how what's built differs from Figma, and why.

| Screen | Figma | Built |
| --- | --- | --- |
| The Code view | `11 · Code editor` (node 24:5122): [figma-11.png](phase-3/figma-11.png) | [built-code-view-dark.png](phase-3/built-code-view-dark.png) |
| A conflict | (not in Figma) | [built-code-conflict-light.png](phase-3/built-code-conflict-light.png) |
| Quick-open | `16 · Command palette` (node 24:7101): [figma-16.png](phase-3/figma-16.png) | [built-quick-open-dark.png](phase-3/built-quick-open-dark.png) |

## Matches

- **The layout:**
  - the Files panel in the left panel (248 px)
  - the editor where the canvas is, with tabs, breadcrumb, the code and the status bar
  - the review bar at the bottom (owner, 7 Nov)
- **The tabs:** the shown file on the canvas surface, a border between tabs, Mono small names.
- **The tree:** 28 px rows, folder and file icons, the open file on `surface/selected`, Mono small names.
- **The breadcrumb:** the file's folders and name, with chevrons, the last in primary text.
- **The status bar:** "Ln, Col", "Spaces: 2", "UTF-8" and the language, in Caption.
- **Quick-open:** 640 px wide, 10 px radius, panel surface, control border, popover shadow, about 120 px from the top; a search row with a 16 px icon; rows with a 14 px icon, the name, and the folder in Mono small; the selected row on `surface/selected`; a footer of key hints.

## Differences, and why

**Graphite outranks Figma** (CLAUDE.md section 2):

| Figma | Built | Why |
| --- | --- | --- |
| Code coloured with the accent (keywords), green (strings) and amber (numbers) | A quiet palette: keywords and strings `text/secondary` (keywords semibold), comments `text/muted`, the rest `text/primary` | Graphite: colour only carries meaning, and blue is for selection and focus only. Green and amber mean "added" and "modified" (owner, 8 Nov) |
| Tab and tree dots in amber and green (git change state) | Neutral dots meaning "unsaved changes", which is also said in their accessible names | They mean "unsaved" here; change state's hues arrive with change capture (stage 3) |
| Breadcrumb, status bar and line numbers in `text/tertiary` | `text/muted` | Graphite keeps tertiary for icons and lines; muted passes WCAG AA for small text |
| Off-grid spacing: tab padding 14, gaps 6 and 10, tree indent 14, breadcrumb sides 20 | 12, 8, 12 and 16 (the 4 px grid); tabs 36 px tall (`size.editor-tab`), the status bar 28 | Graphite's 4 px grid and spacing scale |

**Not built yet** (content that doesn't exist yet; no placeholders, rule 10):

| Figma | Built | Arrives with |
| --- | --- | --- |
| The breadcrumb ends in symbols (`processItem › llm.complete`) and a flow tag (`flow · Save item`) | The file's path only | Symbols: phase 4. Flows: stage 1 |
| A node chip on a line (`↳ node llm.complete`) and a highlighted modified line | No chips; changed lines aren't marked | Stage 1 (nodes); stage 3 (changes) |
| "0 errors · 1 warning" in the status bar | No error count; the autosave switch is there instead | Language servers, phase 33 (owner, 7 Nov) |
| `M` and `A` tags in the tree (git status) | None | The git panel, phase 34 |
| Quick-open groups Nodes, Commands and Files, with `@` for nodes and `>` for commands | Files only, and no groups | Nodes: stage 1. Commands: the command palette (Figma 16), a later phase |
| The rail's other tools, the branch and Share in the top bar | As in phase 2: only tools that work | Their phases (phase 2 differences list) |

**Added, not in Figma:**
- **The conflict banner,** with **Keep mine** and **Load the workspace's version**, and the deleted-file banner with **Close** (and, with unsaved changes, **Save it again** or **Close…**, which asks first). Owner decisions, 7 and 8 Nov. Figma has no screen for these states.
- **The restored note** ("Restored unsaved changes from 14:02"), the autosave switch, and "Saving…", "Saved" and "Unsaved changes" in the status bar.
- **Quick-open's focus** shows as the search row's bottom border in the accent, not the page's focus ring (WCAG 2.4.7; Figma 16 shows none). Its first row is selected only once you move to it with the arrow keys; Figma shows the first row selected.

## Not checked

- Pixel-by-pixel comparison with Figma: not done, by decision (29 Oct 2026). The owner reviews by eye.
- The light theme against Figma: Figma 11 and 16 are dark only. The light theme's baselines are in `e2e/visual/__screenshots__/screens-code-*-light-linux.png`.
