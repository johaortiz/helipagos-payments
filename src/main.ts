import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './contexts/shared/filters/global-exception.filter';
import { LoggingInterceptor } from './contexts/shared/intercepters/logging.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // ── Global prefix
  app.setGlobalPrefix('api');

  // ── Global pipes
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // ── Global filters & interceptors
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  // ── Swagger
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Helipagos Payments API')
    .setDescription('Payment processing API using Helipagos')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  // ── Start
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Application running on http://localhost:${port}/api`);
}

void bootstrap();
