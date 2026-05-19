import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
} from 'class-validator';

export class LookupPaymentQueryDto {
  @ApiPropertyOptional({
    description: 'Merchant-assigned external reference (idempotency key).',
    example: 'order-abc-123',
  })
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  externalReference?: string;

  @ApiPropertyOptional({
    description: 'Provider-assigned numeric payment ID (Helipagos id_sp).',
    example: 706153,
  })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  @IsOptional()
  externalPaymentId?: number;
}
