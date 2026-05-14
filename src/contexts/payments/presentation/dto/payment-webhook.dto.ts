import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class PaymentWebhookDto {
  @ApiProperty({
    example: 987654,
    description: 'Provider payment ID (Helipagos id_sp).',
  })
  @IsNumber()
  id_sp!: number;

  @ApiProperty({
    example: 'PROCESADA',
    description: 'Raw payment status from the provider.',
  })
  @IsString()
  @IsNotEmpty()
  estado!: string;

  @ApiProperty({ example: 'order-abc-123' })
  @IsString()
  @IsNotEmpty()
  referencia_externa!: string;

  @ApiPropertyOptional({ example: 'VISA' })
  @IsString()
  @IsOptional()
  medio_pago?: string;

  /** Provider sends this as a string, not a number. */
  @ApiPropertyOptional({ example: '150000' })
  @IsString()
  @IsOptional()
  importe_abonado?: string;

  @ApiPropertyOptional({ example: '2026-05-14T10:30:00' })
  @IsString()
  @IsOptional()
  fecha_importe?: string;
}
