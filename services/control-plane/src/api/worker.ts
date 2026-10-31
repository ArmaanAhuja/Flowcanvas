import { createApi } from './app.js';

/**
 * The Worker's script. wrangler.jsonc sends only /api/* here (`run_worker_first`); every other request is
 * served from the app's static files, as before.
 */
export default createApi();
