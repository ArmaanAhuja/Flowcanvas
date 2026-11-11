// The palette's prefixes (design brief §22), in a module of their own: a page that reads them must not pull the
// palette (and React Aria's search parts) into its own chunk (phase 4 step 5, caught by the bundle budget).

/** `#` at the start limits the palette to files. */
export const FILES_PREFIX = '#';
