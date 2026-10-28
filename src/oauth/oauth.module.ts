import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { authorizationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { tokenHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/token.js';
import { clientRegistrationHandler } from '@modelcontextprotocol/sdk/server/auth/handlers/register.js';
import { OAuthController, WellKnownController } from './oauth.controller';
import { OAuthService } from './oauth.service';

/** The API as an OAuth server for AI assistants: the MCP SDK's handlers, backed by OAuthService. */
@Module({
  controllers: [OAuthController, WellKnownController],
  providers: [OAuthService],
  exports: [OAuthService],
})
export class OAuthModule implements NestModule {
  constructor(private readonly oauth: OAuthService) {}

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(authorizationHandler({ provider: this.oauth })).forRoutes('oauth/authorize');
    consumer.apply(tokenHandler({ provider: this.oauth })).forRoutes('oauth/token');
    consumer.apply(clientRegistrationHandler({ clientsStore: this.oauth.clientsStore })).forRoutes('oauth/register');
  }
}
