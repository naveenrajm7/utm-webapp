# macOS packaging and operations

See the installation section in the repository README for the one-line release installer and service commands. Releases are versioned tar.gz archives with adjacent SHA-256 files per architecture. The pull request workflow performs a clean build and local archive install; tag pushes run the same matrix and publish those validated archives. A PR must not publish a release.

Application versions are retained under `~/Applications/UTM Web/versions`; `current` points at the active version. User key, job journal, and log live under `~/Library/Application Support/UTM Web`. The installer creates the key with OpenSSL randomness and mode 0600, starts the per-user LaunchAgent, and checks an authenticated API response on loopback before considering activation successful. This prevents an unrelated service on port 3000 from passing the readiness check. Failed activation restores the previous symlink. Normal uninstall removes the LaunchAgent and active link but preserves user data; `--purge-data` explicitly removes it.

Apple Silicon (`arm64`) and Intel (`x86_64`) bundles have both passed the package build and install smoke on standard GitHub-hosted macOS runners. The Apple Silicon bundle was also built and smoke-tested locally. Both use bundled Node 22.14.0 and a native `node-pty` module compiled for the corresponding architecture.

The target application must be installed at `/Applications/UTM.app`. The adapter selects that app by its full path so another copy of UTM running on the Mac cannot redirect VM operations. The service binds only to loopback port 3000. Logs are written to `server.log`; API keys are not included in launch arguments or release files.
