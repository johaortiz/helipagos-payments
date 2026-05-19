import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { PaymentDomainError } from '../../payments/domain/entities/payment.entity';
import { InvalidPaymentTransitionException } from '../../payments/domain/exceptions/invalid-payment-transition.exception';
import { PaymentAlreadyFinalizedException } from '../../payments/domain/exceptions/payment-already-finalized.exception';
import { PaymentNotFoundException } from '../../payments/domain/exceptions/payment-not-found-exception';
import { HelipagosUnavailableError } from '../../payments/infrastructure/http/helipagos-http.client';

interface ErrorResponse {
  statusCode: HttpStatus;
  timestamp: string;
  path: string;
  error: string;
  message: string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const { statusCode, error, message } = this.resolve(exception);

    if (statusCode === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `Unhandled exception — ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorResponse = {
      statusCode,
      timestamp: new Date().toISOString(),
      path: request.url,
      error,
      message,
    };

    response.status(statusCode).json(body);
  }

  private resolve(exception: unknown): {
    statusCode: HttpStatus;
    error: string;
    message: string;
  } {
    // NestJS built-in exceptions (thrown by pipes, guards, etc.)
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const res = exception.getResponse();
      let message: string;
      if (typeof res === 'string') {
        message = res;
      } else {
        const body = res as Record<string, unknown>;
        const raw = body['message'];
        if (Array.isArray(raw)) {
          message = (raw as string[]).join(', ');
        } else {
          message = raw?.toString() ?? exception.message;
        }
      }
      return { statusCode: status, error: exception.constructor.name, message };
    }

    if (exception instanceof PaymentNotFoundException) {
      return {
        statusCode: HttpStatus.NOT_FOUND,
        error: 'PaymentNotFoundException',
        message: exception.message,
      };
    }

    if (exception instanceof InvalidPaymentTransitionException) {
      return {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'InvalidPaymentTransitionException',
        message: exception.message,
      };
    }

    if (exception instanceof PaymentAlreadyFinalizedException) {
      return {
        statusCode: HttpStatus.CONFLICT,
        error: 'PaymentAlreadyFinalizedException',
        message: exception.message,
      };
    }

    // Generic domain rule violation — placed after specific payment exceptions
    // so they are never shadowed by this broader guard.
    if (exception instanceof PaymentDomainError) {
      return {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'PaymentDomainError',
        message: exception.message,
      };
    }

    if (exception instanceof HelipagosUnavailableError) {
      return {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        error: 'HelipagosUnavailableError',
        message: exception.message,
      };
    }

    // Unknown error — mask internals, never expose stack traces
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'InternalServerError',
      message: 'An unexpected error occurred.',
    };
  }
}
