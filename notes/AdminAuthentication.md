# Local administrator authentication

The default runtime uses one application-owned administrator. This is independent
of the macOS account; UTM commands still run as the Mac user running the service.
No host password is requested. Existing VM and job response shapes are unchanged.

## First launch and normal use

1. Start the API (`npm run dev`) or the production one-origin runtime.
2. Open the UI. If no administrator exists, it shows setup. Copy the latest
   `UTM Web initial setup code` from the API terminal or installed service log.
3. Choose a username (1–64 ASCII letters/numbers/dots/underscores/hyphens,
   starting with a letter/number) and password (12–128 characters). The UI also
   requires password confirmation. Setup creates exactly one administrator.
4. Log in. Reloads and API restarts preserve the session until its eight-hour
   absolute expiry. Log out from the dashboard to revoke that session.

The setup code is generated anew on every unconfigured server start, is not
returned by the API, and stops working after setup. Setup is a transaction with
an enforced singleton key, so racing requests or processes cannot create two
administrators. There is no public signup or API to reopen setup.

## Storage and configuration

`UTM_DATABASE_PATH` defaults to
`~/Library/Application Support/UTM Web/utm.sqlite`. Use an absolute path outside
the repository. The default directory is created mode 0700 and the database is
mode 0600. SQLite DELETE journaling avoids persistent WAL sidecars. Keep the
database when restarting/upgrading; back it up with the service stopped (or a
SQLite backup tool). Authentication tables use an `auth_` prefix, leaving the
same database available for future application tables.

Passwords use asynchronous scrypt (N=32768, r=8, p=1, 64-byte output), with a
random 32-byte salt. Only password hashes and SHA-256 hashes of random 32-byte
session tokens persist. Sessions include a separate random CSRF token. Expired
sessions are pruned on startup/login; a maximum of 20 sessions is retained.
The cookie is HttpOnly, SameSite=Strict, Path=/, with an eight-hour max age.
Local HTTP is supported; Secure is set when the request uses TLS. Remote access
and proxy/TLS configuration remain outside this milestone.

`UTM_AUTH_MODE=session` is the default. An existing `UTM_API_KEY` does not bypass
session authentication for REST or consoles. Explicit `UTM_AUTH_MODE=api-key`
retains the former shared-key interface for existing scripts and fake suites;
it requires `UTM_API_KEY`. Unknown modes fail startup. The installer retains its
owner-only health key for `/auth/installation`, which proves service identity
without granting VM access. The release includes the native SQLite dependency.

## HTTP and console contract

All auth responses use `Cache-Control: no-store`.

| Endpoint | Contract |
| --- | --- |
| `GET /auth/status` | `{mode:"session", setupRequired, authenticated, username?, csrf?}`; legacy mode returns `{mode:"api-key"}` |
| `POST /auth/setup` | `{username,password,setupCode}` → 201; once configured → 409 |
| `POST /auth/login` | `{username,password}` → session cookie and `{username,csrf}` |
| `POST /auth/logout` | Valid session and `X-UTM-CSRF` → revoke session, clear cookie |
| `GET /auth/installation` | Installation key → `{service:"utm-web",ready:true}`; otherwise 401 |

Setup/login/logout require the configured browser Origin (exact listener origin
in production) and `X-UTM-Request: 1`. Cookie-authenticated API mutations also
require the session's `X-UTM-CSRF` value and trusted Origin. Auth and protected
API requests validate loopback Host names/ports to reject DNS rebinding. CORS
allows credentials only for configured local development origins. Development
UI and API must use the same hostname for SameSite cookies. Production uses
relative URLs on one origin.

The browser keeps only the CSRF token in memory. It clears the former API key
from sessionStorage when entering session mode. A 401, reload, or window focus
rechecks authentication. VM pending-job metadata is retained for recovery after
logging back in. Logout errors remain visible rather than pretending the
session was revoked.

Console upgrades authenticate the cookie and check the browser Origin before
resolving a target. Logout closes active consoles for that session immediately;
expiry or eviction closes them on the next one-second check. Restart loses
active transports but retains unexpired authentication sessions. Session mode
never sends credentials in WebSocket protocols or URLs.

Setup and login share a five-attempt/minute in-memory limit, with at most one
password derivation in flight per runtime. Success resets the failure counter;
429 includes Retry-After. This is a local single-admin application, not a
multi-user identity service. Multiple users, roles, MFA, password-change and
password-recovery UI/commands, remote access, and scoped automation tokens are
future work. Do not delete the database casually to reset a password: future
application features may share it.

## Verification

`npm run test:browser` includes the real production API + Next UI with isolated
SQLite storage and a deterministic fake UTM adapter. It covers fresh launch,
confirmation mismatch, rejected setup code, first admin creation, restart before
login, rejected password, successful login, HttpOnly cookie, authenticated
inventory, reload, console upgrade, CSRF rejection, logout and rejected cookie
replay, blocked repeated setup, direct console login gate, restart with a live
session, expiry, re-login/logout, and teardown of the browser, runtime, and
temporary database. No live UTM mutations are used.

API tests separately cover concurrent setup across database connections, file
permissions and hashed secrets, trusted hosts/origins, legacy-key rejection,
CSRF on VM jobs, rate limiting/cooldown, restart/expiry/logout persistence,
unreadable database failure, and active-console revocation. The previous
API-key browser acceptance and console suite remains enabled as explicit
compatibility-mode coverage.

### Implementation acceptance (2026-10-26)

Branch `codex/admin-auth` starts from main `fab7309`. On this Apple Silicon Mac:

- `npm run build`: 4/4 tasks passed.
- `npm run lint`: 7/7 tasks passed.
- `npm test`: 112 tests passed (logger 1, adapter 22, API 57, web 32).
- `npm run test:browser`: 10 browser scenarios passed (11 Node test results
  including the parent suite), covering both explicit API-key compatibility and
  the default admin flow.
- `npm test --workspace=api -- --runInBand --testPathPattern=adminAuth`: all
  seven auth cases passed after adding installation-health credential checks.
- `bash -n install.sh scripts/build-release.sh scripts/package-smoke.sh` and
  `git diff --check`: passed.
- `SKIP_QUALITY=1 VERSION=admin-auth-test ./scripts/build-release.sh`: passed;
  arm64 archive includes and successfully loads SQLite with bundled Node 22.14.0.
- The extracted archive's `runtime/node/node --test
  tests/browser/admin-auth.test.mjs`, with `BROWSER_RUNTIME_ROOT` pointing to
  the extracted `runtime` and an isolated `BROWSER_WEB_PORT`, passed the full
  admin browser scenario, including repeated restart and teardown.

No personal database or VM was used. The full LaunchAgent install/uninstall
smoke was not run locally because it manages the user's service label and port
3000; the package workflow retains that check on isolated macOS runners. Intel
package assembly likewise remains a CI check. No archive was published or
service installed as part of this change.
