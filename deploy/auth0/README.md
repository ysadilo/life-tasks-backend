# Auth0 setup for AI agents

The API is its own OAuth server for assistants (Claude, ChatGPT, Cursor…): it registers them,
issues their tokens and shows the approval page. **Auth0 only signs the person in**, through one
fixed application — so the number of connected assistants never touches an Auth0 plan limit.

You do **not** need dynamic client registration, a second Auth0 API, default permissions for
third-party apps, a post-login Action, or domain-level connections for this.

## One-time setup

1. Auth0 › **Applications › Create Application** → **Regular Web Applications**, e.g. "Life Tasks agent sign-in".
2. **Settings**
   - _Allowed Callback URLs_: `https://<your host>/api/oauth/callback`
     (the origin of `MCP_PUBLIC_URL`, e.g. `https://lifetasks.today/api/oauth/callback`)
   - Copy the **Client ID** and **Client Secret**.
3. **Connections** tab: enable the same login methods your users already use (Google, username/password…).
4. On the API (`deploy/.env`):

   ```
   MCP_PUBLIC_URL=https://<your host>/api/mcp
   AUTH0_LOGIN_CLIENT_ID=<client id>
   AUTH0_LOGIN_CLIENT_SECRET=<client secret>
   ```

   (`AUTH0_DOMAIN` is already set.)

5. The proxy in front of the API must send `/.well-known/*` to it (some assistants look for
   discovery documents at the host root). In this repo's setup that is a rule in the frontend's Caddyfile.

## Flow

assistant → `/api/oauth/register` → `/api/oauth/authorize` → Auth0 login → `/api/oauth/callback`
→ web app `/agents/connect` (the person picks boards and permissions) → assistant gets a code →
`/api/oauth/token`. Revoking an agent in Settings deletes its tokens immediately.

## Clean-up of the old setup

If you followed the earlier dynamic-registration setup you can delete: the "MCP" API, the
`agent-connect` Action, the leftover `tpc_…` applications, and turn dynamic client registration off.
