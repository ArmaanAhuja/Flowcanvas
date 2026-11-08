// Quick-open, imported by name so only it (and its React Aria parts) go into its own chunk. A dynamic
// import('@flowcanvas/ui') would keep the whole package together and pull quick-open into the first load (the
// bundle budget caught it: 143 → 159 kB, phase 3 step 8).
export { QuickOpen as default } from '@flowcanvas/ui';
