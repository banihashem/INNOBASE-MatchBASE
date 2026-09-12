# Local Docker runtime — MB-UX-OPS-002 L02

This profile runs the Consultant workspace, durable research worker, PostgreSQL18 and read-only PM dashboard on Docker Desktop. It retains local simulator authentication. The existing production Dockerfile and production identity controls are separate. No registry push is required.

## Commands (PowerShell, repository root)

```powershell
./deployment/local/Manage-LocalDocker.ps1 -Action Build
./deployment/local/Manage-LocalDocker.ps1 -Action Up
./deployment/local/Manage-LocalDocker.ps1 -Action Status
./deployment/local/Manage-LocalDocker.ps1 -Action Backup
./deployment/local/Manage-LocalDocker.ps1 -Action Stop
```

Build creates a disposable PostgreSQL container on a random loopback port and runs the complete workspace unit command, including database-dependent tests, before sending application source to Docker. It removes only that disposable test container afterward. The Dockerfile repeats unit tests on Linux; its build stage has no database or runtime credentials, so database cases are separately covered by the first gate. Any test failure prevents the final image. No tests are disabled to permit a build. The disposable database contains test data only and accepts trusted local connections; it is never used as the runtime database.

By default the application is at http://localhost:3000. The PM dashboard is at http://localhost:3001 and preserves its snapshot freshness warnings. Host database access is on127.0.0.1:55433; containers use postgres:5432. Dashboard and database ports always bind to loopback; web can opt into a specific private LAN address as described below. Web uses Next development mode intentionally to preserve this project's local test identity policy; it is not a production deployment. Source changes require another validated Build followed by Up. The image contains the locked development workspace and Chromium for Consultant PDF rendering.

## Private LAN access

After Build, select a private IPv4 address currently assigned to this computer:

```powershell
./deployment/local/Manage-LocalDocker.ps1 -Action Up -LanAddress 192.168.168.40
```

Use http://192.168.168.40:3000 on both the host and devices on the same network. Consultant test sign-in is `/auth/simulator/start?fixture=consultant`. This replaces localhost web access, so old browser sessions require sign-in on the new origin. The launcher sets both the Docker host binding and MATCHBASE_ORIGIN together; opening a port alone is insufficient for login and mutation origin checks. It rejects public, wildcard and unassigned addresses. It saves the successful non-secret choice in Windows User MATCHBASE_LOCAL_LAN_ADDRESS for subsequent Up commands. If DHCP changes this computer's IP, repeat Up with the current private address. To restore host-only mode, use `-Action Up -LanAddress ''`.

The host firewall must permit TCP3000 on the selected interface for intended LAN clients. The launcher does not change firewall policies or router forwarding. This is a trusted-LAN test profile with simulator sign-in, not public hosting or production authentication. No other service is exposed by this option. [Docker port binding documentation](https://docs.docker.com/engine/network/port-publishing/).

Next development resources admit only the configured origin hostname through allowedDevOrigins in the test/development profile. This is necessary for browser JavaScript, styles and HMR when using the LAN IP; an HTTP200 document alone does not establish browser readiness. Production configuration is unaffected.

PostgreSQL data resides in named volume matchbase_local_postgres_data; PDF cache resides in matchbase_local_pdf_cache. Stop/recreate preserves these volumes. Never use down --volumes or remove the database volume for routine maintenance. The old tmpfs test database in compose.yaml is not the persistent local runtime.

Secrets are read from the Windows User environment by the launcher, passed to Compose as environment-sourced secrets, and read from /run/secrets at runtime. Keys are not image layers, build arguments, checked-in configuration, or launcher command arguments. Docker administrators can access local container secrets; this is not an encrypted external secret manager. The dashboard receives no runtime secrets.

### Consultant model and provider settings (MB-UX-QUALITY-001 L07)

`C:/INNOBASE/MatchBASE/03_Implementation/INNOBASE-MatchBASE/deployment/local/Manage-LocalDocker.ps1` forwards these server-only settings from Windows User environment, falling back to the calling process when a User value is absent:

- `MATCHBASE_MODEL_GEMINI`, `MATCHBASE_MODEL_OPENAI`, `MATCHBASE_MODEL_PREPARATION`, `MATCHBASE_MODEL_SYNTHESIS` select the existing application model roles. Unset values retain application defaults; supported model IDs and provider capabilities are checked before execution.
- `MATCHBASE_PROVIDER_GOOGLE`, `MATCHBASE_PROVIDER_OPENAI`, `MATCHBASE_PROVIDER_ANTHROPIC`, `MATCHBASE_PROVIDER_DEEPSEEK`, `MATCHBASE_PROVIDER_XAI`, and `MATCHBASE_PROVIDER_ROUTES` select provider routes. These settings are route identifiers, not provider credentials. BYOK credentials remain configured in OpenRouter.

Changing an environment value requires `Up` to refresh the Compose runtime configuration once research is idle. The launcher never adds a provider key or changes an already approved model/billing plan. Extra families without an explicit BYOK route retain the existing separately quoted OpenRouter-credit policy. The model's search engine and actual billing mode remain subject to the approved estimate and response audit. `Build` strips inherited model overrides as well as database and provider settings before fixture qualification, then restores the invoking process environment.

Backups are written outside Git under %LOCALAPPDATA%/MatchBASE/backups with SHA256 sidecars. Restore only into an empty replacement database, check row counts and retained request/approval hashes, then switch runtime connections. Never restore over a working database without a separate backup. Root governance and authoritative sources remain in their local repository; the PM snapshot is mounted read-only rather than baked into the image.

Compose health checks verify HTTP readiness and worker queue access. The worker drains on SIGTERM; check active jobs before planned shutdown. Stop research in Section3 cancels a specific execution without stopping containers. Container readiness does not prove Live provider output or BYOK availability; no paid research should be started merely to test deployment.

References: [Compose secrets](https://docs.docker.com/reference/compose-file/secrets/), [PostgreSQL volume layout](https://docs.docker.com/guides/postgresql/).
