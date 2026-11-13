# Despliegue en Coolify

Proyecto **Tr3spass**, entorno **events**. Sin compose: dos aplicaciones desde este repo (Dockerfile) y un Postgres.

| Recurso | Configuración |
|---|---|
| `events-postgres` | PostgreSQL 18, no público |
| `events` | Repo `TripleCyber/helloii-events`, rama `main`, Dockerfile, puerto `8080`, dominio `https://events.idp.tripleenable.com`, `EVENTS_ROLE=public` |
| `events-admin` | El mismo repo y Dockerfile, dominio `https://events.idp.tripleenable.com/admin`, `EVENTS_ROLE=admin`, **HTTP Basic Auth** con usuario y contraseña |

Variables en las dos apps: `DATABASE_URL` (la URL interna de `events-postgres`), `PUBLIC_ORIGIN`, `QR_LINK_BASE`,
`CORS_ORIGINS` (ver el README).

- Cada push a `main` despliega las dos. No hay GitHub Actions: Coolify construye la imagen en su servidor.
- El panel puede llegar con o sin el prefijo `/admin` (según Traefik lo quite o no); el servicio acepta los dos.
- Basic Auth: completar usuario **y** contraseña antes de guardar (un usuario vacío ya tumbó el panel de Coolify una
  vez) y guardar una cosa a la vez.
- Salud: `GET /healthz` (también comprueba la base).
