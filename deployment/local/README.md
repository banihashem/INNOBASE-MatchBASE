# Local Docker runtime — MB-UX-OPS-002 L07

This profile runs the Consultant workspace, schema migrator, durable research worker, PostgreSQL18 and read-only PM dashboard on Docker Desktop. It retains local simulator authentication. The existing production Dockerfile and production identity controls are separate. No registry push is required.

## Commands (PowerShell, repository root)

```powershell
./deployment/local/Manage-LocalDocker.ps1 -Action Build
./deployment/local/Manage-LocalDocker.ps1 -Action Up
./deployment/local/Manage-LocalDocker.ps1 -Action Status
./deployment/local/Manage-LocalDocker.ps1 -Action Backup
./deployment/local/Manage-LocalDocker.ps1 -Action Stop
```

Build creates a disposable PostgreSQL container on a random loopback port and runs the complete workspace unit command, including database-dependent tests, before sending application source to Docker. It removes only that disposable test container afterward. The Dockerfile repeats unit tests on Linux; its build stage has no database or runtime credentials, so database cases are separately covered by the first gate. Any test failure prevents the final image. No tests are disabled to permit a build. The disposable database contains test data only and accepts trusted local connections; it is never used as the runtime database. `Up` runs the one-shot `migrate` service and the web and worker wait for successful schema migration and additive private-category backfill.

The permanent host address is http://localhost:3000, including after Wi-Fi/DHCP changes or when disconnected from a network. Docker Desktop and the containers must be running. The PM dashboard is at http://localhost:3001 and preserves its snapshot freshness warnings. Host database access is on127.0.0.1:55433; containers use postgres:5432. All Docker host ports bind to loopback. The optional LAN gateway below exposes only the application. Web uses Next development mode intentionally to preserve this project's local test identity policy; it is not a production deployment. Source changes require another validated Build followed by Up. The image contains the locked development workspace and Chromium for Consultant PDF rendering.

## Portable private LAN access

After Build, start the permanent loopback application and explicitly select the physical adapter allowed to provide LAN access:

```powershell
./deployment/local/Manage-LocalDocker.ps1 -Action Up
./deployment/local/Manage-LocalDocker.ps1 -Action InstallPortableAccess -InterfaceAlias 'Wi-Fi'
./deployment/local/Manage-LocalDocker.ps1 -Action AccessStatus
```

Continue using localhost on this computer. `AccessStatus` reports the current LAN address for other devices. Consultant test sign-in is `/auth/simulator/start?fixture=consultant`. A LAN IP change creates a different browser origin and requires sign-in again; localhost sessions keep the same origin. Bookmark localhost on the host rather than a DHCP address. A stable LAN hostname/DNS service is not provided by this mechanism.

Installation creates a current-user, limited-privilege logon task named `MatchBASE-PortableAccess-<user-SID>`. It starts immediately and runs hidden, with no provider/database credentials in its arguments or environment. It stores only adapter GUID/port and transport status under `%LOCALAPPDATA%/MatchBASE/access`. Every fifteen seconds it discovers the selected physical adapter's preferred private IPv4 address. It closes the old listener before binding the new address. Virtual/VPN adapters, public IPs, wildcard bindings and ambiguous multiple private addresses are rejected. Switching from Wi-Fi to a different physical adapter requires selecting that adapter explicitly. No Docker/container restart, research retry, database write or paid call occurs during network movement.

The credential-free gateway binds only the selected LAN address on the configured web port and forwards to `127.0.0.1` on that port. It checks exact Host, same Origin for mutations/WebSockets and cross-site browser metadata, refuses spoofed forwarding headers and absolute request targets, then uses the canonical localhost application origin upstream. Host-only cookies remain host-only. Only exact localhost app redirects are mapped back to the LAN origin. Next's HMR WebSocket is admitted only on its known path with a matching Origin. The application's origin and production policies are unchanged; no public/wildcard origin is admitted. Request bodies are limited to4MiB, responses stream with backpressure, and transport state never includes headers, bodies or credentials.

The firewall must permit the web port only for intended local-subnet clients on this physical adapter. The launcher does not change firewall policies, network trust classifications or router forwarding. This follows an explicitly selected adapter across networks; use it only on trusted LANs. The simulator is not production authentication. Disable portable access before joining an untrusted network:

```powershell
./deployment/local/Manage-LocalDocker.ps1 -Action RemovePortableAccess
```

Removing portable access stops/unregisters only its own task and removes its own non-secret configuration/status files. Localhost, Docker containers and saved research remain available. Fixed `-LanAddress` startup is retired; stale `MATCHBASE_LOCAL_LAN_ADDRESS` is ignored and removed after successful `Up`. An occupied or unassigned LAN address is reported without falling back to another interface. If Docker is starting or stopped, the gateway returns502 and recovers when the loopback application returns. Docker Desktop must be configured to start when the user signs in; the gateway does not start Docker or auto-approve research. This is a logged-in Windows workstation profile, not an always-on production service.

If this workstation cannot launch even a minimal task action, select the explicit current-user Startup fallback:

```powershell
./deployment/local/Manage-LocalDocker.ps1 -Action InstallPortableAccess -InterfaceAlias 'Wi-Fi' -AccessStartupMode StartupShortcut
```

This removes the same user's MatchBASE task and creates `MatchBASE Portable Access.lnk` in that user's Windows Startup folder. The shortcut invokes the same hidden wrapper with absolute executable/configuration paths and an explicit working directory; installation also starts it immediately. It does not change execution policies, elevation, firewall rules or authentication. A per-configuration named mutex admits one wrapper per interactive session. `RemovePortableAccess` removes either startup mechanism and stops only its exact matching wrapper/supervisor process tree. The wrapper stores only startup stage, process ID, exception type, exit code and timestamp in the non-secret startup status file. A configured shortcut does not prove a completed reboot/login test. Unlike Task Scheduler's bounded retries, this fallback starts at sign-in and does not independently restart a fatal process exit during the session.

A locked or unavailable status file does not stop network discovery: status publication retries on each poll, including when the address has not changed. Its last timestamp can therefore be stale; task state and actual HTTP reachability are separate observations. Shutdown cancels discovery/waiting and closes a candidate that finishes binding after stop was requested. Every supervisor exit releases its listener so a fatal failure cannot leave a running task with permanently stopped discovery.

References: [Docker port bindings](https://docs.docker.com/engine/network/port-publishing/), [Node HTTP and upgrade handling](https://nodejs.org/api/http.html), [Windows task principals](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtaskprincipal).

PostgreSQL data resides in named volume matchbase_local_postgres_data; PDF cache resides in matchbase_local_pdf_cache. Stop/recreate preserves these volumes. Never use down --volumes or remove the database volume for routine maintenance. The old tmpfs test database in compose.yaml is not the persistent local runtime.

Secrets are read from the Windows User environment by the launcher, passed to Compose as environment-sourced secrets, and read from /run/secrets at runtime. Keys are not image layers, build arguments, checked-in configuration, or launcher command arguments. Docker administrators can access local container secrets; this is not an encrypted external secret manager. The dashboard receives no runtime secrets.

The optional shared public-evidence reader uses `MATCHBASE_PUBLIC_READER_DATABASE_URL`. Its PostgreSQL LOGIN role must be non-superuser, non-bypass, unable to read private observations and bound to the exact Consultant account/profile through `bindPublicCorpusReader()`. Provision it with `pnpm run provision:public-reader` after setting the documented server-only inputs. This local binding does not qualify production identity. Public acquisition and release remain separate operator capabilities; private research output is never promoted automatically.

Provisioning requires `MATCHBASE_DATABASE_URL`, `MATCHBASE_PUBLIC_READER_ROLE`, `MATCHBASE_PUBLIC_READER_DATABASE_PASSWORD`, `MATCHBASE_PUBLIC_READER_ACCOUNT_ID`, `MATCHBASE_PUBLIC_READER_PROFILE_ID` and `MATCHBASE_PUBLIC_READER_IDENTITY_REFERENCE` in the operator process. Persist only `MATCHBASE_PUBLIC_READER_DATABASE_URL` in the Windows User environment for runtime use. The role password must be a generated 32–128 character URL-safe value. The provisioning command reports status without printing the password or connection URL.

### Consultant model and provider settings (MB-UX-QUALITY-001 L07)

`C:/INNOBASE/MatchBASE/03_Implementation/INNOBASE-MatchBASE/deployment/local/Manage-LocalDocker.ps1` forwards these server-only settings from Windows User environment, falling back to the calling process when a User value is absent:

- `MATCHBASE_MODEL_GEMINI`, `MATCHBASE_MODEL_OPENAI`, `MATCHBASE_MODEL_PREPARATION`, `MATCHBASE_MODEL_SYNTHESIS` select the existing application model roles. Unset values retain application defaults; supported model IDs and provider capabilities are checked before execution.
- `MATCHBASE_PROVIDER_GOOGLE`, `MATCHBASE_PROVIDER_OPENAI`, `MATCHBASE_PROVIDER_ANTHROPIC`, `MATCHBASE_PROVIDER_DEEPSEEK`, `MATCHBASE_PROVIDER_XAI`, and `MATCHBASE_PROVIDER_ROUTES` select provider routes. These settings are route identifiers, not provider credentials. BYOK credentials remain configured in OpenRouter.

Changing an environment value requires `Up` to refresh the Compose runtime configuration once research is idle. The launcher never adds a provider key or changes an already approved model/billing plan. Extra families without an explicit BYOK route retain the existing separately quoted OpenRouter-credit policy. The model's search engine and actual billing mode remain subject to the approved estimate and response audit. `Build` strips inherited model overrides as well as database and provider settings before fixture qualification, then restores the invoking process environment.

Backups are written outside Git under %LOCALAPPDATA%/MatchBASE/backups with SHA256 sidecars. Restore only into an empty replacement database, check row counts and retained request/approval hashes, then switch runtime connections. Never restore over a working database without a separate backup. Root governance and authoritative sources remain in their local repository; the PM snapshot is mounted read-only rather than baked into the image.

Compose health checks verify HTTP readiness and worker queue access. The worker drains on SIGTERM; check active jobs before planned shutdown. Stop research in Section3 cancels a specific execution without stopping containers. Container readiness does not prove Live provider output or BYOK availability; no paid research should be started merely to test deployment.

References: [Compose secrets](https://docs.docker.com/reference/compose-file/secrets/), [PostgreSQL volume layout](https://docs.docker.com/guides/postgresql/).
