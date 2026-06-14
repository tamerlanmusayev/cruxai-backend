import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Security headers
  app.use(helmet());

  // OpenAPI / Swagger — interactive docs at /docs, raw spec at /openapi.json
  const openapi = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('CruxAI API')
      .setDescription('AI learning platform — summaries, quizzes, flashcards, graph')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs', app, openapi, {
    jsonDocumentUrl: 'openapi.json',
  });

  // JSON body size cap (file uploads handled separately by multer limits)
  app.useBodyParser('json', { limit: '1mb' });

  const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim());
  app.enableCors({ origin: origins });

  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  const port = parseInt(process.env.PORT ?? '4000', 10);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`CruxAI API listening on :${port}`);
}
bootstrap();
