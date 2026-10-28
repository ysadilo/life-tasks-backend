import type { AgentPermission } from '@prisma/client';

export class UpdateAgentDto {
  permissions?: AgentPermission[];
  /** Boards the agent may use; each must be one the caller belongs to. */
  boardIds?: string[];
}

export class UpdateAgentSettingsDto {
  /** The master "Allow agents" switch. */
  enabled!: boolean;
}

export class ConnectRequestDto {
  /** The signed token the Auth0 post-login Action put in the approval link. */
  token!: string;
}

export class AuthorizeAgentDto extends ConnectRequestDto {
  permissions?: AgentPermission[];
  boardIds?: string[];
}
