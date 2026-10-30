import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { API_PREFIX, API_PREFIX_OPTIONS } from './app.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Behind Cloudflare and Caddy: count their hops so rate limits see the visitor, not the proxy.
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 2));
  app.enableCors();
  app.setGlobalPrefix(API_PREFIX, API_PREFIX_OPTIONS);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
