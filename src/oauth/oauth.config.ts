/** Where the pieces of the OAuth server live, derived from the public MCP URL (`MCP_PUBLIC_URL`). */

export const mcpUrl = () => process.env.MCP_PUBLIC_URL;

/** The API origin, e.g. https://lifetasks.today — the app and the API share a host. */
export const publicOrigin = () => new URL(mcpUrl() as string).origin;

/** The OAuth issuer assistants discover: <origin>/api/oauth. */
export const issuerUrl = () => `${publicOrigin()}/api/oauth`;

/** The web app, where the person approves an assistant. */
export const appUrl = () => process.env.APP_URL ?? publicOrigin();

/** Metadata (RFC 8414) describing our authorization server; every endpoint sits under the issuer. */
export function authorizationServerMetadata() {
  const issuer = issuerUrl();
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  };
}

/** RFC 9728 metadata: the MCP server is the protected resource and we are its authorization server. */
export function protectedResourceMetadata() {
  return {
    resource: mcpUrl(),
    authorization_servers: [issuerUrl()],
    bearer_methods_supported: ['header'],
  };
}
