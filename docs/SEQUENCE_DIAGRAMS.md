# Diagramas de secuencia — Helipagos Payments API

Este documento complementa `DESIGN.md` con diagramas Mermaid de los flujos principales del backend.

Los diagramas están escritos como Markdown para que GitHub los renderice automáticamente. También pueden editarse en [Mermaid Live Editor](https://mermaid.live/) copiando el contenido de cada bloque.

---

## 1. Creación de pago exitosa

```mermaid
sequenceDiagram
    autonumber
    actor Client as Cliente / Swagger / Postman
    participant API as PaymentsController
    participant UC as CreatePaymentUseCase
    participant Repo as PaymentRepository
    participant Gateway as PaymentProviderGateway
    participant Helipagos as Helipagos Sandbox
    participant DB as PostgreSQL

    Client->>API: POST /api/payments
    API->>UC: execute(input)
    UC->>Repo: findByExternalReference(externalReference)
    Repo->>DB: SELECT payment WHERE external_reference = ?
    DB-->>Repo: null
    Repo-->>UC: null

    UC->>Repo: save(payment PENDING)
    Repo->>DB: INSERT payment status=PENDING
    DB-->>Repo: saved

    UC->>Gateway: createPayment(providerInput)
    Gateway->>Helipagos: POST /api/solicitud_pago/v1/checkout/solicitud_pago
    Helipagos-->>Gateway: id_sp, estado=GENERADA, checkout_url
    Gateway-->>UC: CreatePaymentResult

    UC->>Repo: update(payment GENERADA + externalPaymentId)
    Repo->>DB: UPDATE payment
    DB-->>Repo: updated

    UC-->>API: CreatePaymentOutput
    API-->>Client: HTTP 201 + payment response
```

---

## 2. Creación idempotente y recuperación de `PENDING`

```mermaid
sequenceDiagram
    autonumber
    actor Client as Cliente
    participant API as PaymentsController
    participant UC as CreatePaymentUseCase
    participant Repo as PaymentRepository
    participant Gateway as PaymentProviderGateway
    participant Helipagos as Helipagos Sandbox
    participant DB as PostgreSQL

    Client->>API: POST /api/payments con externalReference repetida
    API->>UC: execute(input)
    UC->>Repo: findByExternalReference(externalReference)
    Repo->>DB: SELECT payment WHERE external_reference = ?
    DB-->>Repo: existing payment
    Repo-->>UC: Payment

    alt Pago ya creado en Helipagos
        UC-->>API: existing payment output
        API-->>Client: HTTP 201 + mismo pago
    else Pago PENDING sin externalPaymentId
        UC->>Gateway: createPayment(providerInput)
        Gateway->>Helipagos: POST solicitud_pago
        Helipagos-->>Gateway: id_sp, estado=GENERADA, checkout_url
        Gateway-->>UC: CreatePaymentResult

        UC->>Repo: update(existing payment)
        Repo->>DB: UPDATE same payment
        DB-->>Repo: updated

        UC-->>API: updated payment output
        API-->>Client: HTTP 201 + pago recuperado
    end
```

---

## 3. Falla de Helipagos durante creación

```mermaid
sequenceDiagram
    autonumber
    actor Client as Cliente
    participant API as PaymentsController
    participant UC as CreatePaymentUseCase
    participant Repo as PaymentRepository
    participant Gateway as PaymentProviderGateway
    participant HTTP as HelipagosHttpClient
    participant Helipagos as Helipagos Sandbox
    participant Filter as GlobalExceptionFilter
    participant DB as PostgreSQL

    Client->>API: POST /api/payments
    API->>UC: execute(input)

    UC->>Repo: save(payment PENDING)
    Repo->>DB: INSERT payment status=PENDING
    DB-->>Repo: saved

    UC->>Gateway: createPayment(providerInput)
    Gateway->>HTTP: post create payment
    HTTP->>Helipagos: POST solicitud_pago

    Helipagos-->>HTTP: 401 / timeout / 5xx / rejected request
    HTTP-->>Gateway: throws typed provider error
    Gateway-->>UC: throws error
    UC-->>API: propagates controlled error
    API-->>Filter: exception

    Filter-->>Client: HTTP 502/503 safe error response

    Note over DB: El pago queda PENDING y es recuperable<br/>reintentando POST /payments con la misma externalReference.
```

---

## 4. Webhook válido con `apikey`

```mermaid
sequenceDiagram
    autonumber
    participant Helipagos as Helipagos Sandbox
    participant API as PaymentsController
    participant UC as HandlePaymentWebhookUseCase
    participant Repo as PaymentRepository
    participant DB as PostgreSQL

    Helipagos->>API: POST /api/payments/webhook<br/>Header apikey válido
    API->>API: validate apikey against HELIPAGOS_WEBHOOK_SECRET
    API->>UC: execute(webhookPayload)

    UC->>Repo: processByExternalPaymentIdForUpdate(id_sp, handler)
    Repo->>DB: BEGIN TRANSACTION
    Repo->>DB: SELECT payment WHERE external_payment_id = ? FOR UPDATE
    DB-->>Repo: locked payment

    Repo->>UC: execute handler(payment)
    UC->>UC: applyTransition(PROCESADA)
    UC-->>Repo: payment updated in memory

    Repo->>DB: UPDATE payment status=PROCESADA
    Repo->>DB: COMMIT
    Repo-->>UC: updated payment

    UC-->>API: void
    API-->>Helipagos: HTTP 200
```

---

## 5. Webhook inválido, desconocido o duplicado

```mermaid
sequenceDiagram
    autonumber
    participant Sender as Helipagos / Evaluador / Artillery
    participant API as PaymentsController
    participant UC as HandlePaymentWebhookUseCase
    participant Repo as PaymentRepository
    participant DB as PostgreSQL

    Sender->>API: POST /api/payments/webhook

    alt apikey inválido o ausente con required=true
        API->>API: log warning
        API-->>Sender: HTTP 200 sin procesar
    else apikey válido
        API->>UC: execute(webhookPayload)

        alt id_sp desconocido
            UC->>Repo: processByExternalPaymentIdForUpdate(id_sp)
            Repo->>DB: SELECT payment FOR UPDATE
            DB-->>Repo: null
            Repo-->>UC: null
            UC->>UC: log warning
            UC-->>API: void
            API-->>Sender: HTTP 200
        else estado desconocido o transición inválida
            UC->>Repo: processByExternalPaymentIdForUpdate(id_sp, handler)
            Repo->>DB: BEGIN TRANSACTION + SELECT FOR UPDATE
            DB-->>Repo: locked payment
            UC->>UC: detect invalid/unknown transition
            UC->>UC: log warning
            Repo->>DB: COMMIT or rollback without unsafe state change
            UC-->>API: void
            API-->>Sender: HTTP 200
        end
    end
```

---

## 6. Cancelación de pago

```mermaid
sequenceDiagram
    autonumber
    actor Client as Cliente / Swagger / Postman
    participant API as PaymentsController
    participant UC as CancelPaymentUseCase
    participant Repo as PaymentRepository
    participant Gateway as PaymentProviderGateway
    participant Helipagos as Helipagos Sandbox
    participant DB as PostgreSQL

    Client->>API: DELETE /api/payments/:id
    API->>UC: execute(id)

    UC->>Repo: findById(id)
    Repo->>DB: SELECT payment WHERE id = ?
    DB-->>Repo: payment
    Repo-->>UC: Payment

    alt payment.externalPaymentId exists
        UC->>Gateway: cancelPayment(externalPaymentId)
        Gateway->>Helipagos: PUT /cancelacion_solicitud_pago?id={id_sp}
        Helipagos-->>Gateway: cancellation accepted
    else PENDING without externalPaymentId
        Note over UC: No provider call needed
    end

    UC->>UC: payment.cancel()
    UC->>Repo: update(payment ANULADA)
    Repo->>DB: UPDATE payment status=ANULADA
    DB-->>Repo: updated

    UC-->>API: void
    API-->>Client: HTTP 200
```

---

## 7. Consulta de pago por ID interno

```mermaid
sequenceDiagram
    autonumber
    actor Client as Cliente
    participant API as PaymentsController
    participant UC as GetPaymentUseCase
    participant Repo as PaymentRepository
    participant Gateway as PaymentProviderGateway
    participant Helipagos as Helipagos Sandbox
    participant DB as PostgreSQL

    Client->>API: GET /api/payments/:id
    API->>UC: execute(id)

    UC->>Repo: findById(id)
    Repo->>DB: SELECT payment WHERE id = ?
    DB-->>Repo: payment
    Repo-->>UC: Payment

    alt payment has externalPaymentId
        UC->>Gateway: getPayment(externalPaymentId)
        Gateway->>Helipagos: GET /get_solicitud_pago?id={id_sp}
        Helipagos-->>Gateway: provider status/details
        Gateway-->>UC: provider details
        UC-->>API: output using provider status
    else payment is local PENDING
        UC-->>API: output using local PENDING status
    end

    API-->>Client: HTTP 200 + payment response
```

---

## 8. Lookup local por `externalReference` o `externalPaymentId`

```mermaid
sequenceDiagram
    autonumber
    actor Client as Cliente / Evaluador
    participant API as PaymentsController
    participant UC as LookupPaymentUseCase
    participant Repo as PaymentRepository
    participant DB as PostgreSQL

    Client->>API: GET /api/payments/lookup?externalReference=...
    API->>UC: execute(query)

    alt externalReference presente
        UC->>Repo: findByExternalReference(externalReference)
        Repo->>DB: SELECT payment WHERE external_reference = ?
    else externalPaymentId presente
        UC->>Repo: findByExternalPaymentId(externalPaymentId)
        Repo->>DB: SELECT payment WHERE external_payment_id = ?
    end

    DB-->>Repo: payment or null
    Repo-->>UC: Payment or null

    alt payment found
        UC-->>API: local payment output
        API-->>Client: HTTP 200 + payment response
    else payment not found
        UC-->>API: PaymentNotFoundException
        API-->>Client: HTTP 404
    end
```

---

## 9. Health checks

```mermaid
sequenceDiagram
    autonumber
    actor Client as Railway / Evaluador / Browser
    participant API as HealthController
    participant DB as PostgreSQL

    Client->>API: GET /api/health
    API-->>Client: HTTP 200 status=ok

    Client->>API: GET /api/health/ready
    API->>DB: SELECT 1
    DB-->>API: ok
    API-->>Client: HTTP 200 status=ready
```

---
