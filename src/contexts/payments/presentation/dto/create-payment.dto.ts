import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

export class CreatePaymentDto {
  /** Amount in cents (e.g. 1500 = $15.00). */
  @ApiProperty({ example: 150000, description: 'Amount in cents.' })
  @IsInt()
  @IsPositive()
  amount!: number;

  /** ISO 8601 date — format YYYY-MM-DD. */
  @ApiProperty({
    example: '2026-12-31',
    description: 'Expiration date (YYYY-MM-DD).',
  })
  @IsDateString()
  expirationDate!: string;

  @ApiProperty({ example: 'Monthly subscription payment.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  description!: string;

  /** Merchant-assigned idempotency key. Must be unique per payment. */
  @ApiProperty({ example: 'order-abc-123' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  externalReference!: string;

  @ApiProperty({ example: 'https://mystore.com/payment/result' })
  @IsUrl()
  redirectUrl!: string;

  @ApiPropertyOptional({
    example: 'https://mystore.com/webhooks/helipagos',
    description:
      'Optional webhook URL. Falls back to WEBHOOK_URL environment variable.',
  })
  @IsUrl()
  @IsOptional()
  webhookUrl?: string;

  /** Optional surcharge in cents applied to the payment. */
  @ApiPropertyOptional({ example: 500 })
  @IsNumber()
  @IsPositive()
  @IsOptional()
  surcharge?: number;

  /** ISO 8601 date — second expiration for two-tier pricing. */
  @ApiPropertyOptional({ example: '2027-01-15' })
  @IsDateString()
  @IsOptional()
  secondExpirationDate?: string;

  @ApiPropertyOptional({ example: 'invoice-456' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @IsOptional()
  secondaryReference?: string;
}
