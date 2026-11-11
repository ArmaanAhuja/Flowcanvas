// Quick-open (Ctrl/⌘+P) and the command palette (⌘K), imported by name into one chunk of their own. Together,
// because they share React Aria's search parts (Autocomplete, SearchField, ListBox, Modal): as two chunks, the
// shared parts went into the page's own chunk, which every project page downloads (the bundle budget caught it:
// 94.6 → 108.7 kB, phase 4 step 5). A dynamic import('@flowcanvas/ui') would pull them into the first load
// (phase 3 step 8).
export { CommandPalette, QuickOpen } from '@flowcanvas/ui';
