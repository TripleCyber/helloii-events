# Helloii Events

Servicio de eventos de Helloii: alimenta la página del evento (`app.helloii.chat/event`), registra el check-in
(«Aquí estoy»), avisa en tiempo real al kiosco de la pantalla del evento y tiene un panel para crear eventos y ver la
asistencia.

Una sola imagen (.NET 10) que corre en uno de dos roles (`EVENTS_ROLE`):

| Rol | Sirve | Dónde |
|---|---|---|
| `public` | API del evento, check-in, WebSocket y web del kiosco, imágenes y QR | `https://events.idp.tripleenable.com` |
| `admin` | Panel y su API | `https://events.idp.tripleenable.com/admin`, detrás de usuario y contraseña de Traefik |

Los dos usan el mismo Postgres. Un check-in llega al kiosco por `LISTEN/NOTIFY`, así funciona con cualquier número
de instancias.

## API

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/v1/events/{código}?user={jid}` | El evento, con el estado para ese usuario (`open`, `done`, `notYet`, `closed`, `cancelled`) |
| POST | `/api/v1/events/{código}/check-ins` | `{ user: { username, firstName, displayName, photo } }` → `200 { state: "done", doneAt, firstTime }` o `409 { state }` |
| GET | `/api/v1/events/{código}/qr.svg` | QR de `https://app.helloii.chat/e?id={código}` |
| WS | `/api/v1/events/{código}/live` | Kiosco. Primer mensaje `{ token }`; recibe `hello`, `checkin`, `event`, `revoked` |
| GET | `/kiosk/{código}#t={token}` | Web del kiosco |
| GET | `/media/{id}` | Pósters y logos (las fotos de asistentes nunca son públicas) |
| * | `/api/admin/...` | Panel: eventos, imágenes, enlace del kiosco, asistencia y CSV |

Reglas:

- Fuera de la ventana de check-in no se permite nada: antes responde `notYet` y después `closed`, siempre `409` al
  intentar registrarse. El check-in no puede cerrar después del fin del evento.
- Un check-in por usuario y evento; repetirlo devuelve el primero (`firstTime: false`).
- Autenticación del usuario: **pendiente**. Hoy el nombre, el usuario y la foto los manda la página, que los recibe
  del puente de la app (`me`). Cuando se agregue, el JID del token dirá contra qué entorno autenticar.
- Las escrituras del panel exigen `X-Events-Admin: 1`, para que otra web no use la sesión de Traefik del navegador.

## Variables

| Variable | Ejemplo |
|---|---|
| `EVENTS_ROLE` | `public`, `admin` o `all` (local) |
| `DATABASE_URL` | `postgres://usuario:clave@host:5432/base` (la URL interna que da Coolify) |
| `PUBLIC_ORIGIN` | `https://events.idp.tripleenable.com` |
| `QR_LINK_BASE` | `https://app.helloii.chat/e?id=` |
| `CORS_ORIGINS` | `https://app.helloii.chat` |

## Local

```bash
docker run -d --name events-pg -e POSTGRES_PASSWORD=devpass -p 127.0.0.1:55432:5432 postgres:17-alpine
EVENTS_ROLE=all DATABASE_URL=postgres://postgres:devpass@127.0.0.1:55432/postgres \
  PUBLIC_ORIGIN=http://localhost:8099 ASPNETCORE_URLS=http://127.0.0.1:8099 \
  dotnet run --project src/Events --no-launch-profile
dotnet test
```

Panel en `http://localhost:8099/admin/`. Las migraciones (`src/Events/Db/Migrations`) se aplican solas al arrancar.

Despliegue: `docs/despliegue.md`.
