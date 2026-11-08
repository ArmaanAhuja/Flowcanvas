// Sentences shared by the Files panel and the Code view, in a module of their own so neither pulls the other's
// chunk in.
export const FILES_TEXT = {
  notRunning: 'Open the workspace to see its files.',
  loading: 'Listing the project’s files…',
  truncated: 'Only the first 50,000 files are listed.',
} as const;
