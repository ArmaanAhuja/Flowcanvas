// Where the built agent is, for the workspace host to copy into a workspace (phase 1d step 5).
// The agent needs only these files and Node's built-in modules.
export const AGENT_FILES = ['protocol.js', 'agent.js', 'main.js'] as const;
export const AGENT_DIR = new URL('.', import.meta.url);
