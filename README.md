# Helipagos Payments API

Microservicio backend desarrollado en **NestJS + TypeScript** para integrar solicitudes de pago con el ambiente sandbox de **Helipagos**.

El servicio expone una API REST propia para crear, consultar, cancelar y recibir notificaciones de pagos. Internamente consume la API sandbox de Helipagos, persiste el estado local en PostgreSQL y procesa webhooks públicos de actualización de estado.

La prueba técnica se enfocaba exclusivamente en backend. Por ese motivo no se implementó frontend; el tiempo se concentró en integración real con Helipagos, persistencia, idempotencia, manejo de errores, transaccionalidad, concurrencia del webhook, testing, Docker, Swagger y despliegue público.

---

## URLs públicas

Instancia desplegada en Railway:

- **Swagger:** `https://helipagos-payments-production.up.railway.app/api/docs`
- **Health check:** `https://helipagos-payments-production.up.railway.app/api/health`
- **Readiness check:** `https://helipagos-payments-production.up.railway.app/api/health/ready`
- **Webhook público:** `https://helipagos-payments-production.up.railway.app/api/payments/webhook`

---

## Stack técnico

- **Node.js 22**
- **NestJS 11**
- **TypeScript**
- **PostgreSQL**
- **TypeORM**
- **Axios + axios-retry**
- **JWT + Passport**
- **Swagger / OpenAPI**
- **Docker / Docker Compose**
- **Railway**
- **Jest + Supertest**
- **Artillery** para stress test del webhook

---

## Funcionalidades implementadas

### Pagos

- Crear solicitud de pago contra Helipagos.
- Consultar pago por ID interno.
- Consultar pago por `externalReference` o `externalPaymentId`.
- Cancelar pago.
- Procesar webhooks de Helipagos.
- Persistir estado local de cada solicitud.
- Mantener idempotencia por `externalReference`.
- Recuperar pagos `PENDING` si Helipagos falla durante la creación.
- Soportar carga concurrente sobre el webhook con bloqueo transaccional.

### Infraestructura y operación

- Swagger público.
- Health checks.
- Migraciones TypeORM.
- Bootstrap seguro de migraciones.
- Docker Compose para entorno local.
- Deploy en Railway.
- Configuración por variables de entorno.
- Manejo global de errores.
- Tests unitarios y E2E.
- Stress test con Artillery.

---

## Endpoints principales

La aplicación usa prefijo global `/api`.

| Método | Endpoint | Descripción | Auth |
|---|---|---|---|
| `POST` | `/api/auth/login` | Obtiene JWT de acceso | No |
| `POST` | `/api/payments` | Crea una solicitud de pago | Sí |
| `GET` | `/api/payments/:id` | Consulta un pago por ID interno | Sí |
| `GET` | `/api/payments/lookup` | Consulta por `externalReference` o `externalPaymentId` | Sí |
| `DELETE` | `/api/payments/:id` | Cancela una solicitud de pago | Sí |
| `POST` | `/api/payments/webhook` | Recibe notificaciones de Helipagos | No |
| `GET` | `/api/health` | Liveness check | No |
| `GET` | `/api/health/ready` | Readiness check con DB | No |

---

## Autenticación

La API protegida usa JWT Bearer Token.

Primero se obtiene un token:

```bash
curl -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "password": "admin123"
  }'
```

Respuesta:

```json
{
  "accessToken": "..."
}
```

Luego se usa:

```http
Authorization: Bearer <accessToken>
```

### Por qué no hay refresh token

Se implementó autenticación JWT simple porque la prueba no requería un sistema completo de usuarios ni sesiones. El objetivo fue proteger los endpoints operativos sin agregar complejidad innecesaria de refresh tokens, rotación, revocación o persistencia de sesiones.

Las credenciales se leen desde variables de entorno:

```env
AUTH_USERNAME=admin
AUTH_PASSWORD=admin123
JWT_SECRET=change-me
JWT_EXPIRES_IN=1h
```

---

## Variables de entorno

Ejemplo de configuración:

```env
NODE_ENV=development
PORT=3000

DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_NAME=helipagos
DB_SYNCHRONIZE=false

HELIPAGOS_BASE_URL=https://sandbox.helipagos.com
HELIPAGOS_BEARER_TOKEN=your-helipagos-bearer-token
HELIPAGOS_TIMEOUT=5000

WEBHOOK_URL=http://localhost:3000/api/payments/webhook

HELIPAGOS_WEBHOOK_SECRET=your-helipagos-webhook-token
HELIPAGOS_WEBHOOK_SECRET_HEADER=apikey
HELIPAGOS_WEBHOOK_SECRET_REQUIRED=true

URL_REDIRECT=https://www.helipagos.com

JWT_SECRET=change-me
JWT_EXPIRES_IN=1h
AUTH_USERNAME=admin
AUTH_PASSWORD=admin123
```

### Variables importantes

| Variable | Uso |
|---|---|
| `HELIPAGOS_BASE_URL` | URL base del sandbox de Helipagos. |
| `HELIPAGOS_BEARER_TOKEN` | Bearer token usado por este backend para llamar a Helipagos. |
| `HELIPAGOS_TIMEOUT` | Timeout HTTP para llamadas al proveedor. |
| `WEBHOOK_URL` | URL pública que se envía a Helipagos para recibir webhooks. |
| `HELIPAGOS_WEBHOOK_SECRET` | Token esperado para validar webhooks entrantes. |
| `HELIPAGOS_WEBHOOK_SECRET_HEADER` | Nombre del header de autenticación del webhook. Por documentación de Helipagos, se usa `apikey`. |
| `HELIPAGOS_WEBHOOK_SECRET_REQUIRED` | Si es `true`, webhooks sin `apikey` se responden con 200 pero no se procesan. |
| `DB_SYNCHRONIZE` | Debe permanecer en `false` fuera de pruebas controladas. Se usan migraciones. |

No se deben hardcodear tokens reales en el código ni en archivos versionados.

---

## Ejecución local sin Docker

Requisitos:

- Node.js 22
- pnpm 10.33.2
- PostgreSQL

Instalar dependencias:

```bash
pnpm install
```

Crear `.env.development` o `.env` con las variables correspondientes.

Ejecutar migraciones:

```bash
pnpm migration:run
```

Opcionalmente ejecutar seed:

```bash
pnpm seed
```

Levantar en modo desarrollo:

```bash
pnpm start:dev
```

La API queda disponible en:

```text
http://localhost:3000/api
```

Swagger:

```text
http://localhost:3000/api/docs
```

---

## Ejecución con Docker

### Desarrollo

Levanta PostgreSQL y la app con hot reload:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Luego, en otra terminal, correr migraciones dentro del contenedor:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app pnpm migration:run
```

Opcionalmente cargar datos de seed:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app pnpm seed
```

### Producción local

```bash
docker compose up --build
```

La app lee `.env` y fuerza `DB_HOST=db` para conectarse al servicio PostgreSQL dentro de la red de Docker.

---

## Base de datos y migraciones

Se usa PostgreSQL con TypeORM.

Scripts disponibles:

```bash
pnpm migration:run
pnpm migration:revert
pnpm migration:generate
pnpm migration:bootstrap
```

### `migration:run`

Ejecuta migraciones TypeORM normalmente.

```bash
pnpm migration:run
```

### `migration:bootstrap`

Script seguro pensado para despliegues donde la base podría estar parcialmente inicializada.

```bash
pnpm migration:bootstrap
```

Este script:

1. Revisa si existe la tabla `payments`.
2. Revisa si existe la tabla de migraciones.
3. Si la DB está vacía, corre migraciones normalmente.
4. Si `payments` ya existe pero la migración inicial no está registrada, valida estructura mínima.
5. Si la estructura coincide, registra la migración inicial como baseline y ejecuta migraciones pendientes.
6. Si la estructura no coincide, falla sin borrar ni modificar datos.

No se usa `synchronize=true` en producción.

---

## Seeds

El proyecto incluye un seed runner:

```bash
pnpm seed
```

Los seeds están pensados para facilitar pruebas locales y desarrollo. No son necesarios para producción.

En Docker:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml exec app pnpm seed
```

---

## Flujo principal de creación de pago

1. Cliente llama a `POST /api/payments`.
2. El backend valida el DTO.
3. Se busca si ya existe un pago con la misma `externalReference`.
4. Si existe y ya tiene `externalPaymentId`, se devuelve el pago existente de forma idempotente.
5. Si existe en estado `PENDING` sin `externalPaymentId`, se reintenta la creación contra Helipagos usando el mismo registro local.
6. Si no existe, se crea un registro local `PENDING`.
7. Se llama al sandbox de Helipagos.
8. Si Helipagos responde correctamente, el pago se actualiza a `GENERADA` con `externalPaymentId`, `checkoutUrl`, `shortUrl` y `barCode`.
9. Si Helipagos falla, el pago queda `PENDING` y puede recuperarse reintentando el mismo `externalReference`.

Este diseño evita duplicados y permite recuperar intentos incompletos.

---

## Idempotencia

La idempotencia se basa en `externalReference`.

Reglas:

- `externalReference` es único en la base.
- Si se repite una creación con una referencia ya completada, no se llama nuevamente a Helipagos.
- Si se repite una creación con una referencia que quedó `PENDING` por una falla anterior del proveedor, se reintenta la llamada a Helipagos usando el mismo pago local.

Esto evita duplicados locales y permite recuperar fallas temporales del proveedor.

---

## Amount en centavos

El campo `amount` se maneja como entero en centavos.

Ejemplo:

```json
{
  "amount": 15023
}
```

Representa:

```text
$150.23
```

Se usa entero para evitar problemas de precisión decimal en dinero.

---

## Webhook

Endpoint público:

```text
POST /api/payments/webhook
```

URL pública de producción:

```text
https://helipagos-payments-production.up.railway.app/api/payments/webhook
```

Helipagos documenta que los webhooks se envían como `POST` con JSON en el body y el header `apikey`.

Configuración recomendada:

```env
HELIPAGOS_WEBHOOK_SECRET=your-helipagos-webhook-token
HELIPAGOS_WEBHOOK_SECRET_HEADER=apikey
HELIPAGOS_WEBHOOK_SECRET_REQUIRED=true
```

### Comportamiento del webhook

El webhook responde HTTP 200 ante eventos válidos de formato, incluso si internamente decide ignorarlos.

Motivo: si el proveedor no recibe HTTP 200, reintentará la entrega. Para evitar reintentos innecesarios, el endpoint acusa recibo y maneja internamente los casos esperables.

Casos contemplados:

| Caso | Resultado HTTP | Procesa |
|---|---:|---|
| `apikey` correcto | 200 | Sí |
| `apikey` incorrecto | 200 | No |
| `apikey` ausente con `HELIPAGOS_WEBHOOK_SECRET_REQUIRED=true` | 200 | No |
| `id_sp` desconocido | 200 | No, log warning |
| `estado` desconocido | 200 | No, log warning |
| transición inválida o duplicada | 200 | No, log warning |
| body inválido | 400 | No |

### Estados manejados

El webhook interpreta estados como:

- `PROCESADA`
- `ACREDITADA`
- `VENCIDA`
- `ANULADA`
- `RECHAZADA`
- `DEVUELTA`
- `CONTRACARGO`

Los estados desconocidos se ignoran para mantener compatibilidad futura con posibles nuevos estados del proveedor.

---

## Concurrencia del webhook

Para soportar webhooks concurrentes del mismo pago, el procesamiento usa una operación transaccional en el repositorio:

1. Busca el pago por `externalPaymentId`.
2. Abre transacción.
3. Aplica `SELECT ... FOR UPDATE` mediante lock pesimista.
4. Ejecuta la transición de dominio.
5. Persiste el resultado dentro de la misma transacción.
6. Confirma o revierte automáticamente.

Esto evita que dos webhooks simultáneos lean el mismo estado viejo y apliquen transiciones inconsistentes.

---

## Consulta de pagos

### Por ID interno

```text
GET /api/payments/:id
```

Este endpoint consulta el proveedor cuando el pago tiene `externalPaymentId`, de modo que puede reflejar el estado que devuelve Helipagos.

### Por referencia o ID del proveedor

```text
GET /api/payments/lookup?externalReference=order-abc-123
GET /api/payments/lookup?externalPaymentId=706166
```

Este endpoint devuelve el registro local y fue agregado para facilitar operación, debugging y evaluación. No llama al proveedor.

---

## Cancelación

Endpoint:

```text
DELETE /api/payments/:id
```

Reglas:

- Si el pago no existe, responde 404.
- Si el pago está en un estado cancelable, se llama a Helipagos y se actualiza localmente.
- Si el pago es `PENDING` y no tiene `externalPaymentId`, se cancela localmente sin llamar al proveedor.
- Si el dominio no permite cancelar el estado actual, responde con error controlado.

---

## Manejo de errores

Se usa un `GlobalExceptionFilter` para normalizar respuestas HTTP.

Ejemplos:

| Error | HTTP |
|---|---:|
| DTO inválido | 400 |
| Pago inexistente | 404 |
| Transición inválida | 422 |
| Pago finalizado | 409 |
| Helipagos rechazó request | 502 |
| Helipagos no disponible | 503 |
| Autenticación fallida con Helipagos | 503 |
| Error inesperado | 500 genérico |

No se exponen stack traces ni configuración sensible en respuestas HTTP.

Los errores del cliente HTTP de Helipagos se clasifican en errores tipados. Se evita loguear headers, tokens o configuración completa de Axios.

---

## Health checks

```bash
curl -i "$BASE_URL/api/health"
curl -i "$BASE_URL/api/health/ready"
```

`/health` valida que el proceso esté vivo.

`/health/ready` valida conectividad real con la base de datos mediante una consulta liviana.

---

## Testing

Comandos:

```bash
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

### Unit tests

Cubren reglas de dominio y casos de uso:

- creación de pagos
- idempotencia
- recuperación de pagos `PENDING`
- consulta
- cancelación
- webhook
- lookup

### E2E tests

Cubren endpoints principales:

- health
- creación
- cancelación
- lookup
- webhook
- validación de secret del webhook
- errores controlados

---

## Stress test del webhook

El archivo `webhook-stress.yml` usa Artillery.

Comando:

```bash
HELIPAGOS_WEBHOOK_SECRET=<webhook-token> pnpm stress:webhook
```

El valor de `HELIPAGOS_WEBHOOK_SECRET` no debe commitearse.

### Importante

El `webhook-stress.yml` incluido es un ejemplo operativo. Para una prueba real se recomienda:

1. Crear primero un pago nuevo.
2. Tomar su `externalPaymentId`.
3. Tomar su `externalReference`.
4. Actualizar el YAML con esos valores.
5. Ejecutar el stress.

Una vez que un pago ya quedó `PROCESADA`, volver a ejecutar el stress sobre ese mismo pago valida principalmente idempotencia y concurrencia sobre estado ya procesado. Para validar transición inicial bajo carga, conviene usar un pago recién creado.

### Resultado de referencia

Se ejecutó un stress test contra Railway con:

- 480 requests
- 480 HTTP 200
- 0 VUs fallidos
- p95 aproximado: 228 ms
- p99 aproximado: 237 ms

Durante el stress pueden aparecer warnings esperables por escenarios intencionales: `apikey` inválido, `id_sp` desconocido, estado desconocido o falta de `apikey`.

---

## Swagger

Swagger está disponible en:

```text
/api/docs
```

En producción:

```text
https://helipagos-payments-production.up.railway.app/api/docs
```

Desde Swagger se puede:

1. Hacer login en `/auth/login`.
2. Copiar el JWT.
3. Usar `Authorize`.
4. Crear pagos.
5. Consultar pagos.
6. Cancelar pagos.
7. Simular webhooks con header `apikey`.

---

## Deploy en Railway

La aplicación se encuentra desplegada en Railway usando PostgreSQL administrado.

Variables clave en producción:

```env
NODE_ENV=production
DB_SYNCHRONIZE=false
HELIPAGOS_BASE_URL=https://sandbox.helipagos.com
HELIPAGOS_BEARER_TOKEN=<provided-by-helipagos>
HELIPAGOS_WEBHOOK_SECRET=<provided-by-helipagos>
HELIPAGOS_WEBHOOK_SECRET_HEADER=apikey
HELIPAGOS_WEBHOOK_SECRET_REQUIRED=true
WEBHOOK_URL=https://helipagos-payments-production.up.railway.app/api/payments/webhook
```

`WEBHOOK_URL` se usa como fuente de verdad para la URL enviada a Helipagos. Si un cliente envía `webhookUrl` en el body pero `WEBHOOK_URL` está configurada, el backend prioriza la variable de entorno para evitar errores manuales.

---

## Decisiones y supuestos principales

- No se implementó frontend porque la consigna no lo requiere.
- Se implementó JWT simple como diferenciador, sin refresh token para mantener el alcance controlado.
- El webhook es público porque Helipagos debe poder invocarlo sin JWT.
- El webhook se protege con `apikey`.
- El Bearer token de Helipagos se usa solo para llamadas salientes del backend al proveedor.
- `externalReference` se usa como clave de idempotencia.
- `amount` se maneja en centavos.
- Las credenciales y URLs se configuran por variables de entorno.
- El estado local se sincroniza por webhook; `GET /payments/:id` puede consultar estado vivo del proveedor.
- Los webhooks desconocidos o duplicados no rompen el contrato HTTP.
- Los pagos `PENDING` por falla del proveedor son intencionales y recuperables reintentando el mismo `externalReference`.
- Se usa PostgreSQL porque es una opción cercana al entorno productivo habitual.
- Se usa Docker Compose para simplificar el setup local.
- Se usa Artillery para validar concurrencia del webhook.

---

## Scripts disponibles

```bash
pnpm build
pnpm start:dev
pnpm start:prod
pnpm lint
pnpm test
pnpm test:e2e
pnpm stress:webhook
pnpm migration:run
pnpm migration:revert
pnpm migration:bootstrap
pnpm seed
```

---

## Archivos relevantes

```text
src/contexts/payments/domain
src/contexts/payments/application
src/contexts/payments/infrastructure
src/contexts/payments/presentation
src/contexts/shared/filters/global-exception.filter.ts
src/database/migrations
src/database/scripts/bootstrap-migrations.ts
webhook-stress.yml
docker-compose.yml
docker-compose.dev.yml
```

---

## Documentación complementaria

Más detalle técnico puede encontrarse en:

```text
DESIGN.md
docs/API_EXAMPLES.md
docs/TESTING_AND_STRESS.md
docs/SEQUENCE_DIAGRAMS.md
```

`DESIGN.md` documenta arquitectura, decisiones y trade-offs.

`docs/API_EXAMPLES.md` contiene ejemplos `curl` copiables.

`docs/TESTING_AND_STRESS.md` mapea los escenarios requeridos por la prueba técnica contra tests, comandos y estrategia de validación.

`docs/SEQUENCE_DIAGRAMS.md` documenta los flujos principales como diagramas de secuencia Mermaid.
