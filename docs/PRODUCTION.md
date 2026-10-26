# Production deployment and support boundaries

Verdant supports connecting to self-managed and managed PostgreSQL through the PostgreSQL protocol. Provider names in the connection form describe where the endpoint runs; they do not grant cloud control-plane access. Networking, firewalls, TLS certificates and database privileges must be configured by the cluster owner.

## Deployment boundary

The supplied Docker Compose deployment is a single-host installation with persistent PostgreSQL volumes and bounded container logs. It is useful for evaluation and controlled internal deployments. It does not by itself provide high availability, SSO, MFA, ingress TLS, a backup scheduler, incident paging, cloud IAM database-token refresh or an independently audited security certification.

Before granting access to a production database:

1. Put the console behind HTTPS and an identity-aware gateway. Set `VERDANT_PUBLIC_URL` and Secure cookies. Restrict source networks and keep PostgreSQL/control-store ports private.
2. Replace shared access tokens with your organization's gateway and user-management process. Use separate viewer, operator and administrator roles. Only administrators can save database or model credentials.
3. Back up the control store with `.secrets/credential_key` and database-role credentials; encrypt backups and test restoration. Losing the key makes saved connections unrecoverable.
4. Start each cluster in monitoring mode. Review generated SQL with the database owner and use TLS certificate verification. Add only the database grants that the cluster's capability report requires.
5. Observe collection overhead and query-text sensitivity. Set cadence/retention appropriate to fleet size. Grant optional maintenance separately, on explicit table allowlists, after validating it on staging.
6. Scrape authenticated `/metrics`, monitor worker heartbeat and latest sample age, and route findings to your organization's operational response. A dashboard is not a paging service.

## Database permissions

The GUI's bootstrap dialog generates a small monitoring-role script. Run it as the database owner or the managed service's administrator, after choosing a strong password. Verdant does not need a PostgreSQL superuser to read normal monitoring views. Managed platforms may redact fields or prohibit a grant; the capability report identifies missing collectors instead of fabricating healthy values.

`pg_stat_statements` is optional and must be installed/preloaded by the cluster administrator according to that provider's procedure. Verdant does not restart managed databases or change provider parameter groups to enable it. Slow-query rankings are cumulative statistics, not request traces. Cloud CPU, storage IOPS, provider failover events and operating-system logs require external telemetry integrations and are not inferred from SQL counters.

For RDS/Aurora, Azure Database for PostgreSQL, Google Cloud SQL and OCI Database with PostgreSQL, use the service endpoint, approved private-network route, port and CA chain. Confirm engine compatibility and administrator permissions in the provider's current documentation. PostgreSQL protocol compatibility does not mean every provider exposes every server view.

## Autonomous actions

The built-in demo keeps its bounded scenarios and fixed SQL tools. Those tools cannot target registered external clusters. Fleet monitoring creates evidence, incidents, reviews and durable memory. Optional table maintenance is limited to the explicit helper and policy shown by the connection setup; it does not enable arbitrary SQL, configuration changes, failover, role administration or session termination on remote databases.

An LLM selects among available bounded tools and contributes investigation text. It cannot supply an arbitrary SQL statement for execution. Human feedback is retained as evidence of a review; it does not prove that a database condition has recovered. Recovery requires a fresh successful observation.

## Remote models and data handling

Chat profiles support Ollama, OpenAI-compatible endpoints, Amazon Bedrock and OCI Generative AI. Authentication and native tool support differ by provider and model; test the exact model from the GUI before activation. Account entitlement, region availability, IAM policies and provider quotas remain prerequisites.

Activating a remote chat profile sends the planner's bounded context, including selected SQL evidence and recalled memory, to that provider. Review your organization's data handling requirements. Credentials are encrypted at rest in the control store, but authorized app/worker processes need the decryption key in memory.

The embedding pipeline remains separately pinned to a 768-dimensional model. Changing a chat profile does not replace stored embedding vectors or silently mix incompatible embedding spaces.

## Validation status

The repository includes unit tests, local fleet/API tests and a Docker smoke workflow. The CI matrix targets Node 22 and 24 on Linux, macOS and Windows. These checks establish specific tested behaviors, not a universal production certification. Test against each intended PostgreSQL service and LLM account before rollout; real cloud account acceptance requires your credentials and network access.
