import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { CreatePaymentOutput } from '../../application/dto/create-payment.output';
import { GetPaymentOutput } from '../../application/uses-cases/get-payment.use-case';
import { Payment } from '../../domain/entities/payment.entity';

export class PaymentResponseDto {
  @ApiProperty({ example: 'a3f1c2d4-...' })
  id!: string;

  @ApiPropertyOptional({ example: 987654, nullable: true })
  externalPaymentId!: number | null;

  @ApiProperty({ example: 'order-abc-123' })
  externalReference!: string;

  @ApiProperty({ example: 150000, description: 'Amount in cents.' })
  amount!: number;

  @ApiProperty({ example: 'Monthly subscription payment.' })
  description!: string;

  @ApiProperty({ example: 'GENERADA' })
  status!: string;

  @ApiProperty({ example: '2026-12-31' })
  expirationDate!: string;

  @ApiPropertyOptional({
    example: 'https://checkout.helipagos.com/...',
    nullable: true,
  })
  checkoutUrl!: string | null;

  @ApiPropertyOptional({ example: 'https://hpg.ar/...', nullable: true })
  shortUrl!: string | null;

  @ApiPropertyOptional({ example: '1234567890123456', nullable: true })
  barCode!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  static fromDomain(payment: Payment): PaymentResponseDto {
    const dto = new PaymentResponseDto();
    dto.id = payment.id;
    dto.externalPaymentId = payment.externalPaymentId;
    dto.externalReference = payment.externalReference;
    dto.amount = payment.amount;
    dto.description = payment.description;
    dto.status = payment.status;
    dto.expirationDate = payment.expirationDate;
    dto.checkoutUrl = payment.checkoutUrl;
    dto.shortUrl = payment.shortUrl;
    dto.barCode = payment.barCode;
    dto.createdAt = payment.createdAt;
    dto.updatedAt = payment.updatedAt;
    return dto;
  }

  static fromCreateOutput(
    output: CreatePaymentOutput,
    description: string,
  ): PaymentResponseDto {
    const dto = new PaymentResponseDto();
    dto.id = output.id;
    dto.externalPaymentId = output.externalPaymentId;
    dto.externalReference = output.externalReference;
    dto.amount = output.amount;
    dto.description = description;
    dto.status = output.status;
    dto.expirationDate = output.expirationDate;
    dto.checkoutUrl = output.checkoutUrl;
    dto.shortUrl = output.shortUrl;
    dto.barCode = output.barCode;
    dto.createdAt = output.createdAt;
    dto.updatedAt = output.createdAt;
    return dto;
  }

  static fromGetOutput(output: GetPaymentOutput): PaymentResponseDto {
    const dto = new PaymentResponseDto();
    dto.id = output.id;
    dto.externalPaymentId = output.externalPaymentId;
    dto.externalReference = output.externalReference;
    dto.amount = output.amount;
    dto.description = output.description;
    dto.status = output.status;
    dto.expirationDate = output.expirationDate;
    dto.checkoutUrl = output.checkoutUrl;
    dto.shortUrl = null;
    dto.barCode = null;
    dto.createdAt = output.createdAt;
    dto.updatedAt = output.updatedAt;
    return dto;
  }
}
