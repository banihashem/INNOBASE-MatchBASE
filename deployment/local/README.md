# Local Docker runtime — MB-UX-OPS-002 L01

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

The application stays at http://localhost:3000. The PM dashboard is at http://localhost:3001 and preserves its snapshot freshness warnings. Host database access is on127.0.0.1:55433; containers use postgres:5432. All published ports bind only to loopback. Web uses Next development mode intentionally to preserve this project's local test identity policy; it is not a production deployment. Source changes require another validated Build followed by Up. The image contains the locked development workspace and Chromium for Consultant PDF rendering.

PostgreSQL data resides in named volume matchbase_local_postgres_data; PDF cache resides in matchbase_local_pdf_cache. Stop/recreate preserves these volumes. Never use down --volumes or remove the database volume for routine maintenance. The old tmpfs test database in compose.yaml is not the persistent local runtime.

Secrets are read from the Windows User environment by the launcher, passed to Compose as environment-sourced secrets, and read from /run/secrets at runtime. Keys are not image layers, build arguments, checked-in configuration, or launcher command arguments. Docker administrators can access local container secrets; this is not an encrypted external secret manager. The dashboard receives no runtime secrets.

Backups are written outside Git under %LOCALAPPDATA%/MatchBASE/backups with SHA256 sidecars. Restore only into an empty replacement database, check row counts and retained request/approval hashes, then switch runtime connections. Never restore over a working database without a separate backup. Root governance and authoritative sources remain in their local repository; the PM snapshot is mounted read-only rather than baked into the image.

Compose health checks verify HTTP readiness and worker queue access. The worker drains on SIGTERM; check active jobs before planned shutdown. Stop research in Section3 cancels a specific execution without stopping containers. Container readiness does not prove Live provider output or BYOK availability; no paid research should be started merely to test deployment.

References: [Compose secrets](https://docs.docker.com/reference/compose-file/secrets/), [PostgreSQL volume layout](https://docs.docker.com/guides/postgresql/).
