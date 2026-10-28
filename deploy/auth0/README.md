# Auth0 setup for AI agents

Besides the API / dynamic registration settings in `.env.example`, one Action lets
the user choose an agent's permissions while connecting it.

1. Auth0 › **Actions › Library › Create Action** (trigger: _Login / Post Login_),
   paste `agent-connect-action.js`.
2. Add secrets:
   - `MCP_URL` — the MCP API identifier (same as `MCP_PUBLIC_URL`)
   - `APP_URL` — the web app origin, e.g. `https://lifetasks.today`
   - `AGENT_CONNECT_SECRET` — a random string (`openssl rand -hex 32`); set the same
     value as `AGENT_CONNECT_SECRET` on the API
3. **Deploy**, then **Actions › Triggers › post-login** and drag the Action into the flow.

Flow: the assistant starts sign-in → Auth0 logs the user in → this Action redirects to
`<APP_URL>/agents/connect` → the user picks permissions → the app calls the API, then
returns to Auth0's `/continue` and the assistant receives its token.

Check against Auth0's Actions docs if a redirect misbehaves: `event.resource_server`,
`api.redirect.encodeToken` and `/continue?state=` are what this relies on.
