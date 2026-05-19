# Testing and Stress Validation

Documento de validación para los escenarios requeridos por la prueba técnica de Helipagos.

Incluye comandos de testing, matriz de cobertura, estrategia de concurrencia del webhook y uso del stress test con Artillery.

---

## 1. Comandos principales

```bash
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

### Qué valida cada comando

| Comando | Objetivo |
|---|---|
| `pnpm lint` | Reglas de ESLint y correcciones automáticas. |
| `pnpm test` | Tests unitarios de casos de uso, dominio y controller. |
| `pnpm test:e2e` | Tests end-to-end con Nest TestingModule + Supertest. |
| `pnpm build` | Compilación TypeScript/NestJS para producción. |

---

## 2. Cantidad de tests

Al momento de redactar esta documentación, el proyecto incluye:

- **54 tests unitarios**.
- **43 tests E2E**.

Los tests están organizados en:

```text
test/unit/payments
test/e2e/payments
test/e2e/health
```

---

## 3. Unit tests

Los tests unitarios cubren principalmente casos de uso de aplicación y reglas de dominio, usando mocks de repositorio y gateway.

Archivos principales:

```text
test/unit/payments/create-payment.use-case.spec.ts
test/unit/payments/get-payment.use-case.spec.ts
test/unit/payments/cancel-payment.use-case.spec.ts
test/unit/payments/handle-payment-webhook.use-case.spec.ts
test/unit/payments/lookup-payment.use-case.spec.ts
test/unit/payments/payments.controller.spec.ts
```

### Cobertura relevante

| Área | Casos cubiertos |
|---|---|
| Creación de pago | Alta exitosa, persistencia inicial como `PENDING`, actualización a `GENERADA`, error del proveedor, retry de pago pendiente. |
| Idempotencia | Misma `externalReference` no genera duplicado si ya existe `externalPaymentId`. |
| Recuperación | Pago `PENDING` sin `externalPaymentId` reintenta proveedor en el siguiente POST. |
| Consulta | Pago existente, inexistente, estado vivo del proveedor y fallback local para `PENDING`. |
| Cancelación | Cancelación exitosa, pago inexistente, pago procesado no cancelable. |
| Webhook | Estados conocidos, estado desconocido, `id_sp` desconocido, transición inválida, persistencia transaccional. |
| URL de webhook | `WEBHOOK_URL` de env tiene prioridad sobre body `webhookUrl`. |

---

## 4. E2E tests

Los E2E tests validan el comportamiento HTTP real de la app con guards, pipes, filtros, controllers y módulos integrados.

Archivos principales:

```text
test/e2e/payments/create-payment.e2e-spec.ts
test/e2e/payments/cancel-payment.e2e-spec.ts
test/e2e/payments/lookup.e2e-spec.ts
test/e2e/payments/webhook.e2e-spec.ts
test/e2e/health/health.e2e-spec.ts
```

### Cobertura relevante

| Área | Casos cubiertos |
|---|---|
| Health | `/api/health` y `/api/health/ready` sin JWT. |
| Auth | Endpoints protegidos devuelven 401 sin JWT. |
| Create payment | 201, validaciones 400, idempotencia, errores 503/502 del proveedor, retry de `PENDING`. |
| Lookup | Búsqueda por `externalReference`, por `externalPaymentId`, precedence de `externalReference`, 400 sin query params, 404. |
| Cancel | 200 al cancelar, 404 inexistente, 422 si estado no permite cancelar. |
| Webhook | 200 en casos válidos, 200 ante `id_sp` desconocido, 200 ante estado desconocido, 400 si body inválido. |
| Webhook secret | `apikey` correcto, incorrecto, ausente, modo required true/false y header custom. |

---

## 5. Matriz de escenarios requeridos por Helipagos

| # | Escenario requerido | Implementación | Validación |
|---:|---|---|---|
| 1 | Creación exitosa de pago | `POST /api/payments` crea pago local y llama a Helipagos. Responde `201` con `externalPaymentId`, `GENERADA` y `checkoutUrl`. | `create-payment.e2e-spec.ts` + prueba manual en Swagger. |
| 2 | Creación con campo faltante | DTOs + `ValidationPipe`. Campos requeridos devuelven `400`. | Tests E2E con `externalReference` faltante y `amount` inválido. |
| 3 | Consulta de pago existente | `GET /api/payments/:id` consulta el proveedor si hay `externalPaymentId`. | Unit tests de `GetPaymentUseCase` + E2E. |
| 4 | Consulta de pago inexistente | `PaymentNotFoundException` se mapea a `404`. | Unit/E2E. |
| 5 | Cancelación exitosa | `DELETE /api/payments/:id` cancela y actualiza estado local. | `cancel-payment.e2e-spec.ts`. |
| 6 | Cancelación de pago inexistente | Responde `404` sin efectos secundarios. | Unit/E2E. |
| 7 | Webhook de acreditación/procesamiento | `POST /api/payments/webhook` procesa `estado=PROCESADA` y actualiza DB. | Unit/E2E + prueba manual con curl. |
| 8 | Doble creación con misma `referencia_externa` | `externalReference` es idempotency key. No crea duplicados. | Unit/E2E de idempotencia. |
| 9 | API de Helipagos no disponible | Errores tipados del proveedor. `503` o `502` controlado. Pago queda `PENDING` recuperable. | Unit/E2E con mocks de `HelipagosUnavailableError` y `HelipagosAuthenticationError`. |
| 10 | Webhook con `id_sp` desconocido | Devuelve `200`, registra warning y no modifica datos. | Unit/E2E. |
| 11 | 50-60 webhooks concurrentes | Lock pesimista transaccional por `externalPaymentId`. Endpoint devuelve `200`. | Artillery (`webhook-stress.yml`) + resultado real documentado. |

---

## 6. Estrategia de concurrencia del webhook

El punto crítico de concurrencia está en el procesamiento de webhooks del mismo pago. El riesgo es que múltiples requests lean el mismo estado y apliquen transiciones inconsistentes.

Para evitarlo, el repositorio implementa un flujo transaccional:

1. Abre una transacción en PostgreSQL.
2. Busca el pago por `externalPaymentId`.
3. Aplica bloqueo pesimista de escritura sobre la fila.
4. Mapea la entidad ORM al dominio.
5. Ejecuta la transición de dominio dentro de la transacción.
6. Guarda el pago actualizado usando el `EntityManager` transaccional.
7. Confirma la transacción o revierte si ocurre un error no controlado.

Esto garantiza que dos webhooks concurrentes del mismo `id_sp` no actualicen el mismo registro de manera inconsistente.

---

## 7. Webhook contract

El webhook está diseñado para responder siempre `HTTP 200` ante eventos con formato válido, incluso cuando internamente no procesa el evento.

Esto aplica a:

- `id_sp` desconocido.
- estado desconocido.
- transición inválida o duplicada.
- `apikey` incorrecto.
- `apikey` ausente con `HELIPAGOS_WEBHOOK_SECRET_REQUIRED=true`.

La razón es evitar reintentos innecesarios del proveedor.

El único caso donde el webhook devuelve `400` es cuando el body no cumple el DTO mínimo, por ejemplo cuando faltan `id_sp` o `estado`.

---

## 8. Artillery stress test

Archivo:

```text
webhook-stress.yml
```

Comando:

```bash
HELIPAGOS_WEBHOOK_SECRET=<your-webhook-token> pnpm stress:webhook
```

El YAML usa el header documentado por Helipagos:

```yaml
headers:
  Content-Type: "application/json"
  apikey: "{{ $processEnvironment.HELIPAGOS_WEBHOOK_SECRET }}"
```

### Escenarios incluidos

| Escenario | Objetivo |
|---|---|
| `PROCESADA - concurrencia mismo pago` | Múltiples webhooks sobre el mismo pago. |
| `PROCESADA - duplicado` | Idempotencia ante eventos repetidos. |
| `id_sp desconocido` | Debe responder 200 sin romper. |
| `estado desconocido` | Forward compatibility: ignorar estado no reconocido. |
| `apikey válido` | Evento procesado normalmente. |
| `apikey inválido` | Evento reconocido con 200 pero ignorado. |
| `sin apikey` | Evento reconocido con 200 pero ignorado si `REQUIRED=true`. |

---

## 9. Datos recomendados para stress

El `webhook-stress.yml` incluido es un ejemplo operativo. Para una prueba real se recomienda usar datos de un pago recién creado:

1. Crear un pago con `POST /api/payments`.
2. Copiar `externalPaymentId`.
3. Copiar `externalReference`.
4. Reemplazar en `webhook-stress.yml`:

```yaml
id_sp: <externalPaymentId>
referencia_externa: "<externalReference>"
```

5. Ejecutar:

```bash
HELIPAGOS_WEBHOOK_SECRET=<your-webhook-token> pnpm stress:webhook
```

Si se ejecuta varias veces sobre el mismo pago ya procesado, el test sigue validando concurrencia e idempotencia, pero ya no valida la transición inicial `GENERADA -> PROCESADA`.

---

## 10. Resultado real de referencia

Se ejecutó un stress test contra la instancia desplegada en Railway con resultado satisfactorio:

```text
http.codes.200: 480
http.requests: 480
http.responses: 480
plugins.expect.ok.statusCode: 480
vusers.completed: 480
vusers.failed: 0
http.response_time.mean: 203.3 ms
http.response_time.p95: 228.2 ms
http.response_time.p99: 237.5 ms
```

Durante el stress, Railway puede reportar rate limit de logs si la aplicación imprime demasiados warnings. Eso no implica fallo funcional de la API; significa que la plataforma descartó logs por superar su límite de ingesta.

---

## 11. Cómo verificar después de stress

Consultar el pago por `externalPaymentId`:

```bash
curl -s "$BASE_URL/api/payments/lookup?externalPaymentId=$EXTERNAL_PAYMENT_ID" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Para un webhook válido `PROCESADA`, el estado esperado es:

```json
{
  "status": "PROCESADA"
}
```

---

## 12. Validación manual recomendada

Antes de entregar o redeployar:

```bash
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

Luego en producción:

```bash
curl -i "$BASE_URL/api/health"
curl -i "$BASE_URL/api/health/ready"
```

Y desde Swagger:

1. Login.
2. Crear pago.
3. Lookup por `externalReference`.
4. Lookup por `externalPaymentId`.
5. Simular webhook válido con `apikey`.
6. Verificar estado `PROCESADA`.
7. Simular webhook inválido y confirmar que responde 200 sin procesar.

---

## 13. Notas sobre logs esperados

Durante tests o stress pueden aparecer warnings esperados:

- pago no encontrado para `id_sp`.
- estado desconocido.
- transición inválida.
- `apikey` ausente o incorrecto.

Estos warnings son parte del comportamiento controlado del webhook. No representan crashes ni errores no manejados.

---

## 14. Criterio de aceptación operativo

La API se considera operativamente válida si:

- `/api/health` responde 200.
- `/api/health/ready` responde 200.
- `POST /api/payments` crea pagos contra sandbox.
- `GET /api/payments/:id` consulta pagos existentes.
- `DELETE /api/payments/:id` cancela pagos cancelables.
- `POST /api/payments/webhook` responde 200 y actualiza estado con `apikey` válido.
- Tests unitarios pasan.
- Tests E2E pasan.
- Stress webhook devuelve 200 sin VUs fallidos.
