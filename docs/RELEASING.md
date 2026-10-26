# Releasing Bikorch

## macOS: signing and notarization

An unsigned `.dmg` downloaded from the internet is blocked by Gatekeeper, so
first-time users cannot open it without a right-click → Open workaround. Sign and
notarize every public build.

electron-builder signs and notarizes automatically when these are present; no
config change is needed:

| Purpose | Environment |
|---|---|
| Signing certificate (Developer ID Application) | `CSC_LINK` (path or base64 .p12), `CSC_KEY_PASSWORD` — or the identity in the login keychain |
| Notarization (App Store Connect API key, preferred) | `APPLE_API_KEY` (path to .p8), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` |
| Notarization (Apple ID alternative) | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |

Without them the build log says `skipped macOS notarization` — treat that build
as internal only.

## macOS: Apple Silicon and Intel

`node-pty` is a native module compiled for the machine that ran `npm ci`
(`build/Release/pty.node`). Adding `x64` to the arm64 build would ship an arm64
binary to Intel Macs and break every terminal. Build each architecture on a
matching machine:

- Apple Silicon: `macos-latest` runner → `npm ci && npm run dist:mac`
- Intel: `macos-13` runner → `npm ci && npm run dist:mac`

Rename the artifacts (for example `Bikorch-arm64.dmg`, `Bikorch-x64.dmg`) before
publishing so the download page can offer both.

## Before publishing

```bash
npm run typecheck
npm test
npm run test:smoke:cli
npm run test:smoke:pty
```

Then install the signed build on a clean user account and walk through the
setup panel: install one CLI, sign in, update it, sign out.
