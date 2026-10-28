/**
 * Auth0 post-login Action: "Approve AI agent".
 *
 * When an MCP client (Claude, ChatGPT, Cursor…) signs a user in for the Life Tasks
 * MCP API, send the user to the app to choose what the agent may do, then let the
 * login continue. Create it in Auth0 › Actions › Library, deploy it, and add it to
 * the Login flow (see README.md in this folder for secrets).
 *
 * Secrets: MCP_URL (the MCP API identifier), APP_URL (e.g. https://lifetasks.today),
 *          AGENT_CONNECT_SECRET (same value as the API's AGENT_CONNECT_SECRET).
 */
exports.onExecutePostLogin = async (event, api) => {
  // Only the MCP API; the web app's own logins ask for the normal API audience.
  if (event.resource_server?.identifier !== event.secrets.MCP_URL) return;
  // A silent check (prompt=none) can't show a page.
  if (event.request.query?.prompt === 'none') return;

  const token = api.redirect.encodeToken({
    secret: event.secrets.AGENT_CONNECT_SECRET,
    expiresInSeconds: 600,
    payload: {
      user_id: event.user.user_id,
      client_id: event.client.client_id,
      client_name: event.client.name,
    },
  });
  api.redirect.sendUserTo(`${event.secrets.APP_URL}/agents/connect`, { query: { session_token: token } });
};

/** The app sends the user back to /continue; "Cancel" there arrives as decision=deny. */
exports.onContinuePostLogin = async (event, api) => {
  if (event.request.query?.decision === 'deny') {
    api.access.deny('access_denied', 'You chose not to connect this agent.');
  }
};
