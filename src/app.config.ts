import { RequestMethod } from '@nestjs/common';
import type { GlobalPrefixOptions } from '@nestjs/common/interfaces';

export const API_PREFIX = 'api';

/**
 * Discovery documents for addresses that have a path live at the host root, not under `/api`
 * (see WellKnownController). Shared with the tests so they run with the same routing as production.
 */
export const API_PREFIX_OPTIONS: GlobalPrefixOptions = {
  exclude: [
    { path: '.well-known/oauth-authorization-server/api/oauth', method: RequestMethod.GET },
    { path: '.well-known/openid-configuration/api/oauth', method: RequestMethod.GET },
    { path: '.well-known/oauth-protected-resource/api/mcp', method: RequestMethod.GET },
  ],
};
