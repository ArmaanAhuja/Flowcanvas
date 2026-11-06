import { createApi } from './app.js';
import { createScheduled } from './scheduled.js';

/**
 * The Worker's script. wrangler.jsonc sends only /api/* here (`run_worker_first`); every other request is
 * served from the app's static files, as before. Its Cron Trigger runs `scheduled` every minute.
 */
const api = createApi();

export default {
  fetch: api.fetch,
  scheduled: createScheduled(),
};
