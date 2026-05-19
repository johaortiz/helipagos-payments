import {
  BadRequestException,
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
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CancelPaymentUseCase } from '../../application/uses-cases/cancel-payment.use-case';
import { CreatePaymentUseCase } from '../../application/uses-cases/create-payment.use-case';
import { GetPaymentUseCase } from '../../application/uses-cases/get-payment.use-case';
import { HandlePaymentWebhookUseCase } from '../../application/uses-cases/handle-payment-webhook.use-case';
import { LookupPaymentUseCase } from '../../application/uses-cases/lookup-payment.use-case';
import { CreatePaymentDto } from '../dto/create-payment.dto';
import { LookupPaymentQueryDto } from '../dto/lookup-payment.query.dto';
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
    private readonly lookupPaymentUseCase: LookupPaymentUseCase,
    private readonly configService: ConfigService,
  ) {}

  // ── POST /payments

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new payment' })
  @ApiResponse({ status: 201, type: PaymentResponseDto })
  @ApiResponse({
    status: 503,
    description:
      'Payment provider unavailable or authentication failed. ' +
      'A local PENDING payment was created and can be retried by resubmitting ' +
      'a POST with the same externalReference once the provider is reachable.',
  })
  @ApiResponse({
    status: 502,
    description:
      'Payment provider rejected the request (invalid payload sent upstream).',
  })
  async create(@Body() dto: CreatePaymentDto): Promise<PaymentResponseDto> {
    // Prefer the server-configured WEBHOOK_URL so callers cannot accidentally
    // break provider notifications by submitting a wrong URL via the request body.
    const configuredWebhookUrl = this.configService.get<string>('WEBHOOK_URL');
    const effectiveWebhookUrl = configuredWebhookUrl?.trim() || dto.webhookUrl;

    const output = await this.createPaymentUseCase.execute({
      amount: dto.amount,
      expirationDate: dto.expirationDate,
      description: dto.description,
      externalReference: dto.externalReference,
      redirectUrl: dto.redirectUrl,
      webhookUrl: effectiveWebhookUrl,
      surcharge: dto.surcharge,
      secondExpirationDate: dto.secondExpirationDate,
      secondaryReference: dto.secondaryReference,
    });

    return PaymentResponseDto.fromCreateOutput(output, dto.description);
  }

  // ── GET /payments/lookup
  // Defined before :id so NestJS never treats the literal string "lookup" as a UUID param.

  @Get('lookup')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Look up a payment by external reference or provider ID',
    description:
      'Returns the locally-stored payment record matching the supplied ' +
      '`externalReference` **or** `externalPaymentId`.\n\n' +
      'At least one query parameter is required. When both are provided, ' +
      '`externalReference` takes precedence.\n\n' +
      'This endpoint returns the local domain status and never calls the ' +
      'payment provider.',
  })
  @ApiQuery({
    name: 'externalReference',
    required: false,
    type: String,
    description: 'Merchant-assigned external reference (idempotency key).',
    example: 'order-abc-123',
  })
  @ApiQuery({
    name: 'externalPaymentId',
    required: false,
    type: Number,
    description: 'Provider-assigned numeric payment ID (Helipagos id_sp).',
    example: 706153,
  })
  @ApiResponse({ status: 200, type: PaymentResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'At least one of externalReference or externalPaymentId must be provided.',
  })
  @ApiResponse({ status: 404, description: 'Payment not found.' })
  async lookup(
    @Query() query: LookupPaymentQueryDto,
  ): Promise<PaymentResponseDto> {
    if (!query.externalReference && !query.externalPaymentId) {
      throw new BadRequestException(
        'At least one of externalReference or externalPaymentId must be provided.',
      );
    }

    const output = await this.lookupPaymentUseCase.execute({
      externalReference: query.externalReference,
      externalPaymentId: query.externalPaymentId,
    });

    return PaymentResponseDto.fromLookupOutput(output);
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
      '**Webhook authentication (`apikey` header)**\n\n' +
      'According to Helipagos documentation, webhook requests include an `apikey` header. ' +
      'The value should match `HELIPAGOS_WEBHOOK_SECRET` (the "Webhook" token provided by ' +
      'Helipagos — **not** the Bearer token used for outbound API calls to Helipagos).\n\n' +
      'When `HELIPAGOS_WEBHOOK_SECRET` is set in the environment, the controller validates ' +
      'the header before passing the event to the domain layer:\n\n' +
      '| Scenario | Behaviour |\n' +
      '|---|---|\n' +
      '| `HELIPAGOS_WEBHOOK_SECRET` not configured | Validation skipped — every request is processed |\n' +
      '| Header **present**, **correct** value | Request processed normally |\n' +
      '| Header **present**, **wrong** value | Request silently ignored (HTTP 200, no processing) |\n' +
      '| Header **absent**, `HELIPAGOS_WEBHOOK_SECRET_REQUIRED=true` (default) | Request silently ignored (HTTP 200, no processing) |\n' +
      '| Header **absent**, `HELIPAGOS_WEBHOOK_SECRET_REQUIRED=false` | Validation skipped — request is processed |\n\n' +
      'The header name defaults to `apikey` and can be overridden via `HELIPAGOS_WEBHOOK_SECRET_HEADER`.',
  })
  @ApiHeader({
    name: 'apikey',
    description:
      'Webhook authentication header. ' +
      'Helipagos documentation states that webhook requests include the "apikey" header. ' +
      'The value should match HELIPAGOS_WEBHOOK_SECRET (the "Webhook" token provided by ' +
      'Helipagos — not the Bearer token used for outbound API calls). ' +
      'Controlled by: HELIPAGOS_WEBHOOK_SECRET (expected value; if unset, validation is skipped entirely), ' +
      'HELIPAGOS_WEBHOOK_SECRET_HEADER (header name; default "apikey"), ' +
      'HELIPAGOS_WEBHOOK_SECRET_REQUIRED (when "true" (default), absent header causes the request to be acknowledged but not processed; ' +
      'when "false", absent header is accepted for compatibility).',
    required: false,
    schema: { type: 'string', example: 'your-helipagos-webhook-token' },
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
        'apikey',
      );
      const secretRequired =
        this.configService.get<string>(
          'HELIPAGOS_WEBHOOK_SECRET_REQUIRED',
          'true',
        ) === 'true';
      const received = headers[headerName.toLowerCase()];

      if (received === undefined) {
        if (secretRequired) {
          this.logger.warn(
            `Webhook "${headerName}" header absent — request ignored (HELIPAGOS_WEBHOOK_SECRET_REQUIRED=true)`,
          );
          return;
        }
        // secretRequired=false: absent header is accepted — process normally
      } else if (received !== secret) {
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
