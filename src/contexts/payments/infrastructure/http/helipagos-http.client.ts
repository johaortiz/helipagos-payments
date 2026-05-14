import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axiosRetry from 'axios-retry';
import { firstValueFrom } from 'rxjs';

// ─── Typed error ──────────────────────────────────────────────────────────────

export class HelipagosUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Helipagos service is unavailable. Please try again later.');
    this.name = 'HelipagosUnavailableError';
    if (cause instanceof Error) this.cause = cause;
  }
}

// ─── Helipagos API types (snake_case — provider contract) ────────────────────

export interface HelipagosCreatePaymentBody {
  importe: number;
  fecha_vto: string;
  descripcion: string;
  referencia_externa: string;
  url_redirect: string;
  referencia_externa_2?: string;
  webhook?: string;
  recargo?: number;
  fecha_2do_vto?: string;
}

export interface HelipagosCreatePaymentResponse {
  id_sp: number;
  id_cliente: number;
  estado: string;
  referencia_externa: string;
  fecha_creacion: string;
  descripcion: string;
  codigo_barra: string;
  id_url: string;
  checkout_url: string;
  short_url: string;
  fecha_vencimiento: string;
  importe: number;
  recargo?: number;
  fecha_vencimiento_2do?: string;
}

export interface HelipagosGetPaymentResponse {
  id_sp: number;
  descripcion: string;
  importe: number;
  referencia_externa: string;
  referencia_externa_2: string | null;
  codigo_barra: string;
  estado_pago: string;
  medio_pago: string | null;
  importe_pagado: number | null;
  importe_vencido: number;
  cuotas: number | null;
  fecha_pago: string | null;
  fecha_acreditacion: string | null;
  fecha_creacion: string;
  fecha_actualizacion: string;
  fecha_vencimiento: string;
  segunda_fecha_vencimiento: string | null;
  checkout_url: string;
}

export interface HelipagosGetCancelPaymentResponse {
  message: string;
  status: number;
}

// ─── Client ───────────────────────────────────────────────────────────────────

@Injectable()
export class HelipagosHttpClient {
  private readonly logger = new Logger(HelipagosHttpClient.name);
  private readonly baseUrl: string;
  private readonly bearerToken: string;
  private readonly timeout: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.baseUrl = this.configService.getOrThrow<string>('HELIPAGOS_BASE_URL');
    this.bearerToken = this.configService.getOrThrow<string>(
      'HELIPAGOS_BEARER_TOKEN',
    );
    this.timeout = this.configService.get<number>('HELIPAGOS_TIMEOUT', 5000);

    axiosRetry(this.httpService.axiosRef, {
      retries: 3,
      retryDelay: (...args) => axiosRetry.exponentialDelay(...args),
      // Only retry on network errors or 5xx responses — not on 4xx (client errors).
      retryCondition: (error) =>
        axiosRetry.isNetworkError(error) ||
        (error.response !== undefined && error.response.status >= 500),
    });
  }

  async createPayment(
    body: HelipagosCreatePaymentBody,
  ): Promise<HelipagosCreatePaymentResponse> {
    const endpoint = '/api/solicitud_pago/v1/checkout/solicitud_pago';
    this.logger.log(`POST ${endpoint}`);

    try {
      const response = await firstValueFrom(
        this.httpService.post<HelipagosCreatePaymentResponse>(
          `${this.baseUrl}${endpoint}`,
          body,
          { headers: this.authHeaders(), timeout: this.timeout },
        ),
      );

      return response.data;
    } catch (error: any) {
      throw this.wrapError(error);
    }
  }

  async getPayment(id: number): Promise<HelipagosGetPaymentResponse[]> {
    const endpoint = '/api/solicitud_pago/v1/get_solicitud_pago';
    this.logger.log(`POST ${endpoint} — id: ${id}`);

    try {
      const response = await firstValueFrom(
        this.httpService.post<HelipagosGetPaymentResponse[]>(
          `${this.baseUrl}${endpoint}`,
          {},
          {
            params: { id },
            headers: this.authHeaders(),
            timeout: this.timeout,
          },
        ),
      );
      return response.data;
    } catch (error) {
      throw this.wrapError(error);
    }
  }

  async cancelPayment(id: number): Promise<HelipagosGetCancelPaymentResponse> {
    const endpoint =
      '/api/solicitud_pago/v1/checkout/cancelacion_solicitud_pago';
    this.logger.log(`PUT ${endpoint} — id: ${id}`);

    try {
      const response = await firstValueFrom(
        this.httpService.put<HelipagosGetCancelPaymentResponse>(
          `${this.baseUrl}${endpoint}`,
          null,
          {
            params: { id },
            headers: this.authHeaders(),
            timeout: this.timeout,
          },
        ),
      );
      return response.data;
    } catch (error) {
      throw this.wrapError(error);
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.bearerToken}`,
      'Content-Type': 'application/json',
    };
  }

  private wrapError(error: unknown): HelipagosUnavailableError {
    this.logger.error('Helipagos request failed', error);
    return new HelipagosUnavailableError(error);
  }
}
