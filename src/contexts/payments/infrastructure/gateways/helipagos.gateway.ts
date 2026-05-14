import { Injectable } from '@nestjs/common';

import {
  CancelPaymentResult,
  CreatePaymentRequest,
  CreatePaymentResult,
  PaymentDetails,
  PaymentProviderGateway,
} from '../../domain/gateways/payment-provider.gateway';
import {
  HelipagosHttpClient,
  HelipagosUnavailableError,
} from '../http/helipagos-http.client';

@Injectable()
export class HelipagosGateway extends PaymentProviderGateway {
  constructor(private readonly httpClient: HelipagosHttpClient) {
    super();
  }

  async createPayment(
    request: CreatePaymentRequest,
  ): Promise<CreatePaymentResult> {
    const response = await this.httpClient.createPayment({
      importe: request.amount,
      fecha_vto: request.expirationDate,
      descripcion: request.description,
      referencia_externa: request.externalReference,
      url_redirect: request.redirectUrl,
      webhook: request.webhookUrl,
      recargo: request.surcharge,
      fecha_2do_vto: request.secondExpirationDate,
      referencia_externa_2: request.secondaryReference,
    });

    return {
      providerPaymentId: response.id_sp,
      status: response.estado,
      checkoutUrl: response.checkout_url,
      shortUrl: response.short_url,
      barcode: response.codigo_barra,
      expirationDate: response.fecha_vencimiento,
      amount: response.importe,
      createdAt: response.fecha_creacion,
    };
  }

  async getPayment(providerPaymentId: number): Promise<PaymentDetails> {
    const results = await this.httpClient.getPayment(providerPaymentId);

    if (!results.length) {
      throw new HelipagosUnavailableError(
        `No payment data returned by provider for id: ${providerPaymentId}`,
      );
    }

    // The provider returns history in ascending order — the last element
    // represents the most recent state of the payment.
    const latest = results[results.length - 1];

    return {
      providerPaymentId: latest.id_sp,
      externalReference: latest.referencia_externa,
      status: latest.estado_pago,
      amount: latest.importe,
      paidAmount: latest.importe_pagado,
      paymentMethod: latest.medio_pago,
      checkoutUrl: latest.checkout_url,
      expirationDate: latest.fecha_vencimiento,
      paymentDate: latest.fecha_pago,
      creditedAt: latest.fecha_acreditacion,
      createdAt: latest.fecha_creacion,
      updatedAt: latest.fecha_actualizacion,
    };
  }

  async cancelPayment(providerPaymentId: number): Promise<CancelPaymentResult> {
    const response = await this.httpClient.cancelPayment(providerPaymentId);
    return {
      success: response.status === 200,
      message: response.message,
    };
  }
}
