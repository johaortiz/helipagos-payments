import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiHeader,
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
import { JwtAuthGuard } from 'src/contexts/auth/guards/jwt-auth.guard';
import { Public } from 'src/contexts/auth/decorators/public.decorator';

@UseGuards(JwtAuthGuard)
@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly createPaymentUseCase: CreatePaymentUseCase,
    private readonly getPaymentUseCase: GetPaymentUseCase,
    private readonly cancelPaymentUseCase: CancelPaymentUseCase,
    private readonly handlePaymentWebhookUseCase: HandlePaymentWebhookUseCase,
    private readonly configService: ConfigService,
  ) {}

  // ── POST /payments

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
      webhookUrl: dto.webhookUrl,
    });

    return PaymentResponseDto.fromCreateOutput(output, dto.description);
  }

  // ── GET /payments/:id

  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a payment by ID' })
  @ApiResponse({ status: 200, type: PaymentResponseDto })
  @ApiResponse({ status: 404, description: 'Payment not found.' })
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentResponseDto> {
    const output = await this.getPaymentUseCase.execute(id);

    return PaymentResponseDto.fromGetOutput(output);
  }

  // ── POST /payments/webhook
  // Defined before :id routes so NestJS does not treat "webhook" as a path param.
  @Public()
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive a payment status update from Helipagos',
    description:
      'Webhook endpoint called by Helipagos whenever a payment status changes.\n\n' +
      '**This endpoint always returns HTTP 200**, regardless of whether the payload was ' +
      'processed or ignored. Any non-200 response would cause the provider to retry ' +
      'the delivery indefinitely.\n\n' +
      '**Optional secret-header validation**\n\n' +
      'When `HELIPAGOS_WEBHOOK_SECRET` is set in the environment, the controller ' +
      'validates an incoming header before passing the event to the domain layer:\n\n' +
      '| Scenario | Behaviour |\n' +
      '|---|---|\n' +
      '| `HELIPAGOS_WEBHOOK_SECRET` not configured | Validation skipped — every request is processed |\n' +
      '| Configured header **absent** in the request | Validation skipped — request is processed |\n' +
      '| Configured header **present**, **correct** value | Request processed normally |\n' +
      '| Configured header **present**, **wrong** value | Request silently ignored (HTTP 200, no processing) |\n\n' +
      'The header name defaults to `x-webhook-secret` and can be overridden via ' +
      '`HELIPAGOS_WEBHOOK_SECRET_HEADER`.',
  })
  @ApiHeader({
    name: 'x-webhook-secret',
    description:
      'Optional shared secret for webhook authenticity verification. ' +
      'Only checked when HELIPAGOS_WEBHOOK_SECRET is set in the environment. ' +
      'The header name is configurable via HELIPAGOS_WEBHOOK_SECRET_HEADER ' +
      '(default: x-webhook-secret). ' +
      'If present and incorrect the request is ignored but HTTP 200 is still returned.',
    required: false,
    schema: { type: 'string', example: 'my-shared-secret' },
  })
  @ApiResponse({
    status: 200,
    description:
      'Webhook acknowledged. ' +
      'Possible outcomes: payload processed successfully; ignored because the payment ID ' +
      'is unknown or the state transition is invalid; or silently rejected because the ' +
      'secret header value did not match. ' +
      'HTTP 200 is always returned to prevent provider retries.',
  })
  @ApiResponse({
    status: 400,
    description:
      'Request body failed validation (missing or invalid required fields).',
  })
  async webhook(
    @Headers() headers: Record<string, string>,
    @Body() dto: PaymentWebhookDto,
  ): Promise<void> {
    const secret = this.configService.get<string>('HELIPAGOS_WEBHOOK_SECRET');

    if (secret) {
      const headerName = this.configService.get<string>(
        'HELIPAGOS_WEBHOOK_SECRET_HEADER',
        'x-webhook-secret',
      );
      const received = headers[headerName.toLowerCase()];

      if (received !== undefined && received !== secret) {
        this.logger.warn(
          `Webhook secret mismatch — rejecting request (header: "${headerName}")`,
        );
        return;
      }
    }

    await this.handlePaymentWebhookUseCase.execute({
      id_sp: dto.id_sp,
      estado: dto.estado,
      referencia_externa: dto.referencia_externa,
      medio_pago: dto.medio_pago,
      importe_abonado: dto.importe_abonado,
      fecha_importe: dto.fecha_importe,
    });
  }

  // ── DELETE /payments/:id/cancel

  @Delete(':id/cancel')
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
  async cancel(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.cancelPaymentUseCase.execute(id);
  }
}
