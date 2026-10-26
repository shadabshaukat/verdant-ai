# Configuration reference

Copy `.env.example` with `npm run setup`. The portable CLI reads `.env`, then applies shell environment overrides. Docker containers receive only the explicitly mapped Compose settings. Keep credentials out of version control.

## Deployment

| Variable | Default | Purpose |
| --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | `verdant-dba` | Names containers, networks and persistent volumes. Changing it selects a different installation. |
| `DEPLOYMENT_MODE` | `demo` | `production` disables scenario execution and omits primary/standby services; requires Compose 2.24.4+. |
| `MODEL_SETUP` | `ensure` | `skip` allows remote-first GUI setup without local model downloads. Explicit `npm run models` still downloads configured models. |
| `APP_HOST` / `APP_PORT` | `127.0.0.1` / `8090` | Published console address. Keep the loopback binding when using a local reverse proxy. |
| `APP_UID` / `APP_GID` | automatic | CLI matches the Linux caller; Docker Desktop uses 1000. Direct Compose users must set these to the owner of the private secret files. |
| `APP_IMAGE` | `verdant-dba/app:1.2.0` | Local application image name; source is built by the CLI. |
| `DEMO_ENABLED` | `true` | Enables scenario injection in the built-in demo. External registered endpoints never use the demo fixture executor. |
| `OLLAMA_MODE` | `bundled` | `bundled` adds the CPU Ollama service; `external` uses an existing provider. |
| `OLLAMA_URL` | derived | Bundled: `http://ollama:11434`; external: `http://host.docker.internal:11434`. |
| `OLLAMA_CHAT_URL` / `OLLAMA_EMBED_URL` | inherit shared URL | Separate default chat and embedding endpoints. GUI chat profiles override the chat planner; embeddings remain separately configured. |
| `OLLAMA_MODEL` | `qwen3:4b-instruct-2507-q4_K_M` | Default chat model when no saved GUI chat profile is active. |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text:v1.5` | Default embedding model. The stored vector schema requires 768 dimensions. |
| `OLLAMA_IMAGE` | `.env.example` | Pinned bundled Ollama image. Model weights and licenses are separate from Verdant source. |

On Linux, a native Ollama process must listen on an interface reachable from containers. `host.docker.internal` is mapped to the Docker host gateway; the host loopback listener alone is insufficient. Prefer bundled Ollama when you do not need a native GPU runtime.

## Access and credentials

| Variable or file | Meaning |
| --- | --- |
| `.secrets/admin_token` | Initial administrator access token. Setup creates a cryptographically random token. Read this file locally and enter it in the sign-in form. |
| `.secrets/credential_key` | Base64-encoded 32-byte AES-256-GCM key for saved database and provider credentials. Restore it with its matching control-database backup. |
| `VERDANT_ADMIN_TOKEN_FILE` | Runtime override for the administrator token file. Compose mounts its managed file at `/run/secrets/admin_token`. |
| `VERDANT_CREDENTIAL_KEY_FILE` | Runtime override for the encryption key file, normally `/run/secrets/credential_key`. |
| `VERDANT_OPERATOR_TOKEN` / `VERDANT_VIEWER_TOKEN` | Optional separate tokens of at least 32 characters. Operators can review and steer; viewers can read and search. Only administrators manage connections and models. |
| `VERDANT_PUBLIC_URL` | Externally visible origin, e.g. `https://verdant.example.org`. Sets the allowed browser origin and automatically requires Secure cookies for HTTPS. No path is allowed. |
| `VERDANT_COOKIE_SECURE` | Set `true` behind HTTPS even if the public URL is omitted. |
| `VERDANT_SESSION_SECONDS` | Session lifetime, 300–86400 seconds, default 28800. Token rotation invalidates sessions for that role. |
| `VERDANT_ALLOW_INSECURE_ENDPOINTS` | Default `false`. Explicit opt-in for unencrypted remote private-network LLM endpoints; local Ollama remains usable. |

Session cookies are HttpOnly and SameSite=Strict. API clients may use `Authorization: Bearer <role-token>`. Tokens identify shared access roles; deploy an identity-aware gateway if individual SSO, MFA or user lifecycle management is required. Authentication is always required by the application.

Passwords, private keys and API credentials entered in the GUI are encrypted before insertion into PostgreSQL. They are never returned by list/detail APIs. An empty credential on edit preserves an existing value; use the explicit clear operation when supported. TLS settings and connection metadata remain visible to authorized console readers. SQL observations can contain sensitive application data; select an appropriate access boundary and retention period.

## Scheduling and timeouts

| Variable | Default | Range / behavior |
| --- | --- | --- |
| `MONITOR_INTERVAL_SECONDS` | 15 | 5–300; seeds only an untouched demo policy. Existing operator settings take precedence. |
| `FLEET_MONITOR_INTERVAL_SECONDS` | 30 | External fleet collection cadence; see connection policy for per-cluster controls. |
| `FLEET_HISTORY_DAYS` | 14 | Retention for fleet metric snapshots. Durable events, reviews and memory are retained separately. |
| `PLANNER_TIMEOUT_MS` | 45000 | 1000–180000; model calls are bounded and aborted on shutdown. |
| `PLANNER_CONTEXT_TOKENS` | 12288 | 2048–32768. |
| `PLANNER_MAX_TOKENS` | 300 | 64–2048. |
| `OLLAMA_KEEP_ALIVE` | `30m` | `0` or duration up to 24 hours. |
| `EMBEDDING_TIMEOUT_MS` | 12000 | 500–60000 for indexing. |
| `EMBEDDING_QUERY_TIMEOUT_MS` | 5000 | 100–30000 for search embedding. |
| `SEMANTIC_RECALL_TIMEOUT_MS` | 1200 | 100–5000; no greater than query embedding timeout. |
| `MEMORY_INDEX_INTERVAL_MS` | 15000 | 1000–300000. |
| `MEMORY_INDEX_BATCH_SIZE` | 100 | 1–500 source documents. |
| `MEMORY_EMBED_BATCH_SIZE` | 8 | 1–64 texts. |
| `DB_CONNECT_TIMEOUT_MS` | 5000 | 100–30000. |
| `DB_STATEMENT_TIMEOUT_MS` | 8000 | 100–30000. |
| `DB_QUERY_TIMEOUT_MS` | 10000 | 200–60000; must exceed statement timeout. |
| `CONTROL_POOL_MAX` / `TARGET_POOL_MAX` | 8 / 4 | 2–32 / 1–16. Fleet endpoints use separately bounded pools. |
| `SHUTDOWN_TIMEOUT_MS` | 10000 | 1000–30000; Compose permits a 45-second stop grace period. |

The demo's low-level database settings also accept `CONTROL`, `PRIMARY`, `STANDBY`, `PRIMARY_ACTION`, `STANDBY_ACTION`, `PRIMARY_DEMO` and `STANDBY_DEMO` prefixes with `_DATABASE_URL`, `_DATABASE_URL_FILE`, `_PASSWORD_FILE`, `_HOST`, `_PORT`, `_DATABASE` and `_USER` suffixes. Prefer mounted files for credentials. GUI-managed remote clusters do not require changes to these fixed demo settings.

## Configuration changes

Restart services after changing `.env`: `npm start`. Saved connections and active GUI model profiles are read from the control database and do not require rebuilding an image. Database migrations run before app startup. See [migrations](MIGRATIONS.md), [operations](OPERATIONS.md) and the [production deployment guide](PRODUCTION.md).
