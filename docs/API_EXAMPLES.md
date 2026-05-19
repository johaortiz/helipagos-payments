# API Examples

Ejemplos prácticos para probar la API de integración con Helipagos.

> Los comandos están escritos con `curl` y variables de entorno para evitar pegar tokens reales en la documentación.

---

## 1. Variables base

Para producción en Railway:

```bash
export BASE_URL="https://helipagos-payments-production.up.railway.app"
```

Para local:

```bash
export BASE_URL="http://localhost:3000"
```

La API usa prefijo global `/api`, por lo que todos los endpoints quedan bajo:

```bash
$BASE_URL/api
```

---

## 2. Health checks

### Liveness

```bash
curl -i "$BASE_URL/api/health"
```

Respuesta esperada:

```http
HTTP/2 200
```

Ejemplo de body:

```json
{
  "status": "ok",
  "timestamp": "2026-05-19T05:00:00.000Z",
  "uptime": 123.45,
  "environment": "production"
}
```

### Readiness con DB

```bash
curl -i "$BASE_URL/api/health/ready"
```

Respuesta esperada si PostgreSQL está disponible:

```http
HTTP/2 200
```

Ejemplo de body:

```json
{
  "status": "ready",
  "database": "up",
  "timestamp": "2026-05-19T05:00:00.000Z"
}
```

---

## 3. Login

Los endpoints de pagos, salvo el webhook, requieren JWT.

```bash
curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "admin123"
  }'
```

Respuesta:

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

Para guardar el token automáticamente con `jq`:

```bash
export TOKEN=$(curl -s -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq -r '.accessToken')
```

Verificación:

```bash
echo "$TOKEN"
```

---

## 4. Crear solicitud de pago

> `amount` y `surcharge` se expresan en centavos. Por ejemplo, `15023` representa `$150.23`.

```bash
export REF="order-example-$(date +%s)"

curl -s -X POST "$BASE_URL/api/payments" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"amount\": 15023,
    \"expirationDate\": \"2026-12-31\",
    \"description\": \"Monthly subscription payment.\",
    \"externalReference\": \"$REF\",
    \"redirectUrl\": \"https://mystore.com/payment/result\",
    \"surcharge\": 500,
    \"secondExpirationDate\": \"2027-01-15\",
    \"secondaryReference\": \"invoice-456\"
  }" | tee payment-response.json
```

Respuesta esperada:

```http
HTTP 201
```

Ejemplo de body:

```json
{
  "id": "f3e15ce0-80ec-45bd-93f3-36365349f1ec",
  "externalPaymentId": 706166,
  "externalReference": "order-example-123",
  "amount": 15023,
  "description": "Monthly subscription payment.",
  "status": "GENERADA",
  "expirationDate": "2026-12-31",
  "checkoutUrl": "https://checkout.helipagos.com/checkout/...",
  "shortUrl": "https://sandbox.hpagos.co/...",
  "barCode": "139000001...",
  "createdAt": "2026-05-19T05:01:02.254Z",
  "updatedAt": "2026-05-19T05:01:02.254Z"
}
```

Guardar IDs de la respuesta:

```bash
export PAYMENT_ID=$(cat payment-response.json | jq -r '.id')
export EXTERNAL_PAYMENT_ID=$(cat payment-response.json | jq -r '.externalPaymentId')
export EXTERNAL_REFERENCE=$(cat payment-response.json | jq -r '.externalReference')
```

---

## 5. `webhookUrl` y URL pública de webhook

El request body acepta `webhookUrl` como fallback, pero en producción se recomienda configurar:

```env
WEBHOOK_URL=https://helipagos-payments-production.up.railway.app/api/payments/webhook
```

Cuando `WEBHOOK_URL` está configurada, el backend la usa como fuente de verdad y **ignora** el `webhookUrl` enviado por el cliente. Esto evita errores manuales como enviar `/webhooks` en vez de `/webhook`.

Endpoint correcto:

```text
POST /api/payments/webhook
```

URL pública correcta:

```text
https://helipagos-payments-production.up.railway.app/api/payments/webhook
```

---

## 6. Creación idempotente

Repetir una creación con la misma `externalReference` no genera un duplicado local ni vuelve a llamar innecesariamente a Helipagos si el pago ya fue creado.

```bash
curl -s -X POST "$BASE_URL/api/payments" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"amount\": 15023,
    \"expirationDate\": \"2026-12-31\",
    \"description\": \"Idempotency retry\",
    \"externalReference\": \"$EXTERNAL_REFERENCE\",
    \"redirectUrl\": \"https://mystore.com/payment/result\"
  }"
```

Resultado esperado: devuelve el pago existente asociado a esa referencia.

---

## 7. Consultar pago por ID interno

```bash
curl -s "$BASE_URL/api/payments/$PAYMENT_ID" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Este endpoint consulta a Helipagos cuando el pago tiene `externalPaymentId`, por lo que puede reflejar estado externo del proveedor.

---

## 8. Lookup por `externalReference`

```bash
curl -s "$BASE_URL/api/payments/lookup?externalReference=$EXTERNAL_REFERENCE" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Este endpoint devuelve el estado local persistido y no llama al proveedor.

---

## 9. Lookup por `externalPaymentId`

```bash
curl -s "$BASE_URL/api/payments/lookup?externalPaymentId=$EXTERNAL_PAYMENT_ID" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Útil para validar webhooks porque Helipagos envía `id_sp`, equivalente a `externalPaymentId`.

---

## 10. Cancelar pago

```bash
curl -i -X DELETE "$BASE_URL/api/payments/$PAYMENT_ID" \
  -H "Authorization: Bearer $TOKEN"
```

Respuesta esperada en cancelación exitosa:

```http
HTTP/2 200
```

Luego se puede verificar el estado:

```bash
curl -s "$BASE_URL/api/payments/lookup?externalReference=$EXTERNAL_REFERENCE" \
  -H "Authorization: Bearer $TOKEN" | jq
```

Si el pago ya fue procesado, la cancelación devuelve un error controlado, normalmente `422`.

---

## 11. Simular webhook válido

El webhook usa el header documentado por Helipagos:

```http
apikey: <webhook-token>
```

El Bearer token de Helipagos **no** se usa para validar webhooks entrantes. El Bearer se usa solo para llamadas salientes desde este backend hacia Helipagos.

Guardar el token de webhook en una variable local:

```bash
export HELIPAGOS_WEBHOOK_SECRET="your-helipagos-webhook-token"
```

Simular un webhook válido:

```bash
curl -i -X POST "$BASE_URL/api/payments/webhook" \
  -H "Content-Type: application/json" \
  -H "apikey: $HELIPAGOS_WEBHOOK_SECRET" \
  -d "{
    \"id_sp\": $EXTERNAL_PAYMENT_ID,
    \"estado\": \"PROCESADA\",
    \"referencia_externa\": \"$EXTERNAL_REFERENCE\",
    \"medio_pago\": \"Visa\",
    \"importe_abonado\": \"15023\",
    \"fecha_importe\": \"Sat Jul 17 14:12:21 ART 2021\"
  }"
```

Respuesta esperada:

```http
HTTP/2 200
```

Verificar que el estado local cambió a `PROCESADA`:

```bash
curl -s "$BASE_URL/api/payments/lookup?externalPaymentId=$EXTERNAL_PAYMENT_ID" \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

## 12. Simular webhook con `apikey` inválida

```bash
curl -i -X POST "$BASE_URL/api/payments/webhook" \
  -H "Content-Type: application/json" \
  -H "apikey: invalid-secret" \
  -d "{
    \"id_sp\": $EXTERNAL_PAYMENT_ID,
    \"estado\": \"PROCESADA\",
    \"referencia_externa\": \"$EXTERNAL_REFERENCE\",
    \"importe_abonado\": \"15023\"
  }"
```

Respuesta esperada:

```http
HTTP/2 200
```

El request se acusa como recibido, pero no se procesa. Esto evita que el proveedor reintente indefinidamente y mantiene la validación interna del webhook.

---

## 13. Simular webhook sin `apikey`

```bash
curl -i -X POST "$BASE_URL/api/payments/webhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"id_sp\": $EXTERNAL_PAYMENT_ID,
    \"estado\": \"PROCESADA\",
    \"referencia_externa\": \"$EXTERNAL_REFERENCE\",
    \"importe_abonado\": \"15023\"
  }"
```

Si `HELIPAGOS_WEBHOOK_SECRET_REQUIRED=true`, se espera:

```http
HTTP/2 200
```

pero el webhook no se procesa.

---

## 14. Webhook con `id_sp` desconocido

```bash
curl -i -X POST "$BASE_URL/api/payments/webhook" \
  -H "Content-Type: application/json" \
  -H "apikey: $HELIPAGOS_WEBHOOK_SECRET" \
  -d '{
    "id_sp": 999999,
    "estado": "PROCESADA",
    "referencia_externa": "unknown"
  }'
```

Respuesta esperada:

```http
HTTP/2 200
```

El sistema registra un warning y no modifica datos.

---

## 15. Webhook con estado desconocido

```bash
curl -i -X POST "$BASE_URL/api/payments/webhook" \
  -H "Content-Type: application/json" \
  -H "apikey: $HELIPAGOS_WEBHOOK_SECRET" \
  -d "{
    \"id_sp\": $EXTERNAL_PAYMENT_ID,
    \"estado\": \"ESTADO_FUTURO\",
    \"referencia_externa\": \"$EXTERNAL_REFERENCE\"
  }"
```

Respuesta esperada:

```http
HTTP/2 200
```

El sistema lo ignora para mantener compatibilidad futura con nuevos estados del proveedor.

---

## 16. Casos de error frecuentes

### JWT faltante

```bash
curl -i -X POST "$BASE_URL/api/payments" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 15023,
    "expirationDate": "2026-12-31",
    "description": "Missing auth",
    "externalReference": "missing-auth",
    "redirectUrl": "https://mystore.com/payment/result"
  }'
```

Respuesta esperada:

```http
HTTP/2 401
```

### Campo requerido faltante

```bash
curl -i -X POST "$BASE_URL/api/payments" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "amount": 15023,
    "expirationDate": "2026-12-31",
    "description": "Missing externalReference",
    "redirectUrl": "https://mystore.com/payment/result"
  }'
```

Respuesta esperada:

```http
HTTP/2 400
```

### Amount decimal

```bash
curl -i -X POST "$BASE_URL/api/payments" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "amount": 150.23,
    "expirationDate": "2026-12-31",
    "description": "Invalid decimal amount",
    "externalReference": "decimal-amount-test",
    "redirectUrl": "https://mystore.com/payment/result"
  }'
```

Respuesta esperada:

```http
HTTP/2 400
```

El dinero debe expresarse como entero en centavos.

---

## 17. Stress test del webhook

El stress test está documentado con más detalle en:

```text
docs/TESTING_AND_STRESS.md
```

Comando rápido:

```bash
HELIPAGOS_WEBHOOK_SECRET="your-helipagos-webhook-token" pnpm stress:webhook
```

Recomendación: para una prueba real, crear primero un pago nuevo, copiar su `externalPaymentId` y `externalReference`, y actualizar `webhook-stress.yml` con esos valores.
