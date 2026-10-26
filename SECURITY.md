# Security policy

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/shadabshaukat/verdant-ai/security/advisories/new) when it is enabled for this repository. If private reporting is unavailable, ask the maintainer for a private reporting channel without including exploit details or secrets in a public issue.

Include the affected commit, deployment mode, relevant configuration with credentials removed, reproduction steps and expected impact. Avoid publishing target credentials, database content or a working exploit before a coordinated resolution.

Security fixes are developed on `main`. The project does not currently offer a commercial support SLA or maintained release branches.

## Deployment boundary

The default HTTP listener is published only on loopback. The control store and scenario databases stay on the internal Compose network. Registered endpoints use the configured network route and TLS policy. Local `.env` files and `.secrets/` are excluded from Git and container build contexts.

The console requires administrator, operator or viewer access. Sessions use HttpOnly SameSite cookies, bounded lifetime and origin checks; automation may use Bearer tokens. Tokens are shared role identities, not an individual-user SSO system or multi-tenant boundary. Terminate HTTPS and individual identity at your ingress/gateway before exposing the service. See [production deployment](docs/PRODUCTION.md).

The API and worker use bounded tools. The demo deployment shares fixed scenario credentials between processes; a model's tool boundary does not isolate a compromised application process. Production mode omits scenario databases and disables their execution paths. Registered cluster maintenance uses a separate executor and explicit allowlist. Application processes still need the vault key to use saved connections.

## Data and model handling

Observations, query text, human feedback and retrieval documents remain in PostgreSQL. Saved database passwords and model credentials use AES-256-GCM encryption with a separately mounted key. Planner context is sent to the active chat provider, and embedding excerpts go to the separately configured embedding endpoint; choose both according to your data-handling requirements. Model output and retrieved history remain untrusted contextual data. Current observations, grants and execution-time policy determine operational authority.

Back up the control database and preserve the matching secret files before an upgrade. Do not attach unredacted `.env`, secrets or database dumps to issues.
