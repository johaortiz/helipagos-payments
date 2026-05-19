import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CancelPaymentUseCase } from './application/uses-cases/cancel-payment.use-case';
import { CreatePaymentUseCase } from './application/uses-cases/create-payment.use-case';
import { GetPaymentUseCase } from './application/uses-cases/get-payment.use-case';
import { HandlePaymentWebhookUseCase } from './application/uses-cases/handle-payment-webhook.use-case';
import { LookupPaymentUseCase } from './application/uses-cases/lookup-payment.use-case';
import { PaymentProviderGateway } from './domain/gateways/payment-provider.gateway';
import { PaymentRepository } from './domain/repositories/payment.repository';
import { HelipagosGateway } from './infrastructure/gateways/helipagos.gateway';
import { HelipagosHttpClient } from './infrastructure/http/helipagos-http.client';
import { PaymentOrmEntity } from './infrastructure/persistence/entities/payment.orm-entity';
import { TypeOrmPaymentRepository } from './infrastructure/persistence/repositories/typeorm-payment.repository';
import { PaymentsController } from './presentation/controllers/payments.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentOrmEntity]), HttpModule],
  controllers: [PaymentsController],
  providers: [
    //  Use cases
    CreatePaymentUseCase,
    GetPaymentUseCase,
    CancelPaymentUseCase,
    HandlePaymentWebhookUseCase,
    LookupPaymentUseCase,

    //  Infrastructure
    HelipagosHttpClient,

    // Bind abstract tokens to concrete implementations
    { provide: PaymentRepository, useClass: TypeOrmPaymentRepository },
    { provide: PaymentProviderGateway, useClass: HelipagosGateway },
  ],
  exports: [
    CreatePaymentUseCase,
    GetPaymentUseCase,
    CancelPaymentUseCase,
    HandlePaymentWebhookUseCase,
    LookupPaymentUseCase,
  ],
})
export class PaymentsModule {}
