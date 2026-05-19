import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../../../src/contexts/auth/auth.module';
import { HealthModule } from '../../../src/contexts/health/health.module';
import { PaymentsModule } from '../../../src/contexts/payments/payments.module';
import { PaymentProviderGateway } from '../../../src/contexts/payments/domain/gateways/payment-provider.gateway';
import { GlobalExceptionFilter } from '../../../src/contexts/shared/filters/global-exception.filter';
import { createMockProviderGateway } from '../../mocks/helipagos-http.client.mock';

// ─── Factory

export async function createTestApp(): Promise<{
  app: INestApplication;
  moduleRef: TestingModule;
}> {
  const moduleRef = await Test.createTestingModule({
    imports: [
      // Load .env.test so ConfigService has JWT_SECRET, AUTH_USERNAME, etc.
      ConfigModule.forRoot({
        isGlobal: true,
        envFilePath: `.env.${process.env.NODE_ENV ?? 'test'}`,
      }),
      // Use the dedicated test PostgreSQL DB from .env.test.
      // synchronize + dropSchema ensure a clean, up-to-date schema on every run.
      TypeOrmModule.forRootAsync({
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (cs: ConfigService) => ({
          type: 'postgres',
          host: cs.getOrThrow<string>('DB_HOST'),
          port: cs.getOrThrow<number>('DB_PORT'),
          username: cs.getOrThrow<string>('DB_USERNAME'),
          password: cs.get<string>('DB_PASSWORD', ''),
          database: cs.getOrThrow<string>('DB_NAME'),
          autoLoadEntities: true,
          synchronize: true,
          dropSchema: true,
          logging: false,
        }),
      }),
      AuthModule,
      HealthModule,
      PaymentsModule,
    ],
  })
    // Replace the real Helipagos gateway so tests never hit the external API.
    .overrideProvider(PaymentProviderGateway)
    .useValue(createMockProviderGateway())
    .compile();

  const app = moduleRef.createNestApplication();

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());

  await app.init();

  return { app, moduleRef };
}

// ─── Helper

/** Returns the mocked PaymentProviderGateway from a compiled test module. */
export function getProviderGatewayMock(
  moduleRef: TestingModule,
): ReturnType<typeof createMockProviderGateway> {
  return moduleRef.get<ReturnType<typeof createMockProviderGateway>>(
    PaymentProviderGateway,
  );
}
