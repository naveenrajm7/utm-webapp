# macOS packaging and operations

See the installation section in the repository README for the one-line release installer and service commands. Releases are versioned tar.gz archives with adjacent SHA-256 files per architecture. The pull request workflow performs a clean build and local archive install; tag pushes run the same matrix and publish those validated archives. A PR must not publish a release.

Application versions are retained under `~/Applications/UTM Web/versions`; `current` points at the active version. User key, job journal, and log live under `~/Library/Application Support/UTM Web`. The installer creates the key with OpenSSL randomness and mode 0600, starts the per-user LaunchAgent, and checks loopback readiness before considering activation successful. Failed activation restores the previous symlink. Normal uninstall removes the LaunchAgent and active link but preserves user data; `--purge-data` explicitly removes it.

Apple Silicon (`arm64`) is validated locally against the bundled Node 22.14.0 and native `node-pty` module. Intel (`x86_64`) remains unvalidated until its standard GitHub-hosted runner package job passes. Do not publish an Intel release artifact before that result.

The target application must be installed at `/Applications/UTM.app`. The service binds only to loopback port 3000. Logs are written to `server.log`; API keys are not included in launch arguments or release files.
