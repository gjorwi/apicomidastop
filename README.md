# dóndecomo · API

API REST en Express con MongoDB Atlas para las apps web de clientes, negocios y administración.

## Configuración

```powershell
cd api
Copy-Item .env.example .env
```

Completa en `.env`:

- `MONGODB_URI`: cadena de conexión de MongoDB Atlas.
- `MONGODB_DB`: nombre de la base de datos.
- `JWT_SECRET`: clave larga y privada.
- `CLIENT_ORIGIN`, `BUSINESS_ORIGIN`, `ADMIN_ORIGIN`: orígenes permitidos.
- `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`: cuenta administradora inicial.
- `MONGODB_DNS_SERVERS` (opcional): servidores DNS para reintentar la resolución SRV de Atlas si el sistema falla.

## Instalar y preparar la base

```powershell
npm install
npm run bootstrap
```

`bootstrap` es **no destructivo**:

- Crea o actualiza las categorías base de la plataforma.
- Crea el administrador si no existe.
- Si el administrador ya existe, actualiza su nombre y estado, pero **no cambia su contraseña**.
- No crea negocios, productos, solicitudes ni calificaciones de ejemplo.
- Sincroniza los índices de MongoDB.

## Ejecutar

```powershell
npm run dev
```

La API queda en `http://localhost:4000/api`.

El endpoint `GET /api/health` informa el estado del servicio y de la conexión con MongoDB.

## Servicios principales

### Públicos

- `GET /categories`
- `GET /promotions`
- `GET /businesses`
- `GET /businesses/:slug`
- `POST /businesses/:slug/scan`
- `GET /businesses/:slug/scan?deviceId=...`
- `GET /products`
- `GET /products/:id`
- `GET /rankings/:categoryKey`
- `POST /ratings`
- `GET /ratings/:productId`
- `POST /business-requests`

### Autenticación

- `POST /auth/login`
- `GET /auth/me`

### Negocios

Requieren token de negocio aprobado.

- `GET /business/me`
- `PUT /business/me`
- `PATCH /business/me/status`
- `GET /business/me/products`
- `POST /business/me/products`
- `PUT /business/me/products/:id`
- `DELETE /business/me/products/:id`
- `GET /business/me/metrics`

### Administración

Requieren token de administrador.

- `GET /admin/stats`
- `GET /admin/settings`
- `PATCH /admin/settings`
- `GET /admin/requests`
- `PATCH /admin/requests/:id`
- `GET /admin/businesses`
- `PATCH /admin/businesses/:id`
- `GET /admin/products`
- `GET /admin/users`
- `PATCH /admin/users/:id`
- `POST /admin/users/:id/reset-password`
- `GET /admin/categories`
- `PATCH /admin/categories/:key`
- `GET /admin/rankings`
- `POST /admin/rankings/publish`
- `DELETE /admin/ratings/:id`

El reset de contraseña acepta una contraseña manual de al menos 8 caracteres o, si se envía vacía, genera una automática y la devuelve una sola vez.

## Reglas de calificación

- Antes de votar, el cliente debe escanear el QR del local con la ubicación activada.
- El escaneo se valida contra la ubicación del negocio y solo se habilita si el cliente está dentro del radio configurado (15 metros por defecto, configurable desde `/admin/settings`).
- Cada escaneo válido registra una visita con 2 votos disponibles y vence a las 24 horas.
- Al usar los 2 votos o al vencer el plazo, la visita queda como histórica (`used` o `expired`).
- Un mismo dispositivo solo puede puntuar una vez cada plato.
- Escala entera de 1 a 5.
- El Top 3 usa las calificaciones de los últimos 12 meses, con peso por antigüedad y mínimo de cinco calificaciones.
- La publicación mensual guarda una captura de los rankings y no altera las capturas anteriores.
- Si una categoría no tiene calificaciones suficientes, no se genera una captura vacía.
