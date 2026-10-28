import type { AgentPermission } from '@prisma/client';

export class UpdateAgentDto {
  permissions?: AgentPermission[];
  /** Boards the agent may use; each must be one the caller belongs to. */
  boardIds?: string[];
}
