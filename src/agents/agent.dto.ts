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
  /** The id of the pending sign-in the approval page was opened with. */
  request!: string;
}

export class AuthorizeAgentDto extends ConnectRequestDto {
  permissions?: AgentPermission[];
  boardIds?: string[];
  /** The person pressed Cancel. */
  deny?: boolean;
}
