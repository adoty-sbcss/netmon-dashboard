# netmon-dashboard

Cloud-hosted (Azure) dashboard **and** sensor management console for
[NetMon](https://github.com/adoty-sbcss/net_mon).

District staff log in (Microsoft / Google) to see their own network data —
drill-down by district → school → IDF/switch, physical + logical network maps,
and findings. SBCSS super-admins additionally get a central console to manage the
NetMon sensor fleet (push config, collect logs) with **no inbound connectivity
to the sensors**.

This app is the **reader/presenter + control plane** for NetMon. It does not
collect network data itself; the NetMon collectors do that and ship hourly
bundles, which this app ingests.

## Status

Pre-implementation. The architecture and build plan are in
[`docs/DESIGN.md`](docs/DESIGN.md). No Azure resources are provisioned yet.

## Stack (planned)

- **Web:** Next.js (App Router, TypeScript) on Azure Container Apps (scale-to-zero)
- **Ingestion:** Azure Container Apps Job (nightly cron)
- **DB:** Azure Database for PostgreSQL Flexible Server (private)
- **Storage:** Azure Blob · **Email:** Azure Communication Services
- **Secrets:** Key Vault + Managed Identity
- **IaC:** Bicep · **CI/CD:** GitHub Actions → ACR (OIDC federation)

See [`docs/DESIGN.md`](docs/DESIGN.md) for the full design, data model, auth model,
and milestone plan.
