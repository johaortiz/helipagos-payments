import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CancelPaymentUseCase } from '../../application/uses-cases/cancel-payment.use-case';
import { CreatePaymentUseCase } from '../../application/uses-cases/create-payment.use-case';
import { GetPaymentUseCase } from '../../application/uses-cases/get-payment.use-case';
import { HandlePaymentWebhookUseCase } from '../../application/uses-cases/handle-payment-webhook.use-case';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { PaymentResponseDto } from '../dto/payment-response.dto';
import { PaymentWebhookDto } from '../dto/payment-webhook.dto';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly createPaymentUseCase: CreatePaymentUseCase,
    private readonly getPaymentUseCase: GetPaymentUseCase,
    private readonly cancelPaymentUseCase: CancelPaymentUseCase,
    private readonly handlePaymentWebhookUseCase: HandlePaymentWebhookUseCase,
  ) {}

  // ── POST /payments ────────────────────────────────────────────────────────

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new payment' })
  @ApiResponse({ status: 201, type: PaymentResponseDto })
  @ApiResponse({ status: 503, description: 'Payment provider unavailable.' })
  async create(@Body() dto: CreatePaymentDto): Promise<PaymentResponseDto> {
    const output = await this.createPaymentUseCase.execute({
      amount: dto.amount,
      expirationDate: dto.expirationDate,
      description: dto.description,
      externalReference: dto.externalReference,
      redirectUrl: dto.redirectUrl,
      webhookUrl: dto.webhookUrl ?? '',
    });

    return PaymentResponseDto.fromCreateOutput(output, dto.description);
  }

  // ── GET /payments/:id ─────────────────────────────────────────────────────

  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a payment by ID' })
  @ApiResponse({ status: 200, type: PaymentResponseDto })
  @ApiResponse({ status: 404, description: 'Payment not found.' })
  async findById(@Param('id') id: string): Promise<PaymentResponseDto> {
    const output = await this.getPaymentUseCase.execute(id);

    return PaymentResponseDto.fromGetOutput(output);
  }

  // ── POST /payments/webhook ────────────────────────────────────────────────
  // Defined before :id routes so NestJS does not treat "webhook" as a path param.

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive a payment status update from Helipagos' })
  @ApiResponse({ status: 200, description: 'Webhook received.' })
  async webhook(@Body() dto: PaymentWebhookDto): Promise<void> {
    await this.handlePaymentWebhookUseCase.execute({
      id_sp: dto.id_sp,
      estado: dto.estado,
      referencia_externa: dto.referencia_externa,
      medio_pago: dto.medio_pago,
      importe_abonado: dto.importe_abonado,
      fecha_importe: dto.fecha_importe,
    });
  }

  // ── POST /payments/:id/cancel ─────────────────────────────────────────────

  @Post(':id/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel a payment' })
  @ApiResponse({ status: 204, description: 'Payment cancelled.' })
  @ApiResponse({ status: 404, description: 'Payment not found.' })
  @ApiResponse({
    status: 422,
    description: 'Invalid payment state transition.',
  })
  @ApiResponse({ status: 409, description: 'Payment already finalized.' })
  async cancel(@Param('id') id: string): Promise<void> {
    await this.cancelPaymentUseCase.execute(id);
  }
}
