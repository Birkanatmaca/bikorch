# Bikorch — Spotify Playback Integration

**Date:** 2026-09-08  
**Status:** Implementation guide, not a completed integration  
**Target:** Current Electron + React + TypeScript repository

## 1. Objective

Make Spotify playback reliable without confusing catalog access, Spotify Connect controls, and actual in-app audio. Use official Spotify APIs and keep local Music Library functionality independent.

The recommended first milestone is **Spotify Connect control of a user-selected official Spotify device**. In-app playback through the Web Playback SDK is a separate, optional capability that depends on account, app access, runtime support and Spotify's commercial-use rules.

Do not bypass DRM, extract protected audio, remove ads, spoof access rights, or silently substitute a YouTube recording for a Spotify track.

## 2. Read the current repository first

Inspect the latest code, especially:

- `src/main/music/spotify-auth.ts`
- `src/main/music/spotify-api.ts`
- `src/main/music/spotify-youtube.ts`
- `src/renderer/lib/streaming/spotify-player.ts`
- `src/renderer/lib/streaming/youtube-player.ts`
- `src/renderer/stores/music-store.ts`
- `src/renderer/components/music/IntegrationsPanel.tsx`
- `src/renderer/components/music/WorkspacePlayerPanel.tsx`
- `src/main/index.ts`
- `src/renderer/index.html`

The reviewed version routed Spotify tracks through `resolvePlayback` to a YouTube search. It also contained a separate Spotify SDK implementation. This creates ambiguous playback behavior. Verify the latest code before changing it and preserve existing user libraries, playlists, downloaded files and local playback.

## 3. Access restrictions and prerequisites

Spotify's Development Mode has restricted access. The app owner must meet the current account requirements, only a limited number of authorized users may be supported, and some endpoints may be unavailable to new development apps. Do not assume a documented endpoint is available to this Client ID.

Check the current dashboard and official access-mode documentation before implementing an endpoint. Premium is required for the Web Playback SDK and relevant playback features. Premium alone does not guarantee that a new developer app can use every playback endpoint.

Spotify's platform terms restrict commercial streaming integrations; obtain any required prior written approval before distributing a commercial in-app player. Electron may lack the protected-media/DRM support required for Web Playback SDK audio. User-Agent spoofing and disabled autoplay restrictions do not solve DRM or authorization problems.

Official references:

- https://developer.spotify.com/documentation/web-api/concepts/apps
- https://developer.spotify.com/documentation/web-api/concepts/quota-modes
- https://developer.spotify.com/documentation/web-api/concepts/scopes
- https://developer.spotify.com/documentation/web-playback-sdk
- https://developer.spotify.com/policy

## 4. Spotify Dashboard setup

1. Open https://developer.spotify.com/dashboard.
2. Create or configure a Spotify app and copy its Client ID.
3. Do not embed a Client Secret in a distributed Electron application.
4. Register the exact redirect URI used by the application.
5. Add testing accounts to the app's allowlist when its access mode requires it.
6. Confirm that the account and app have the required playback access.

The previously reviewed Bikorch code uses:

```text
http://127.0.0.1:45893/callback
```

This is a repository-specific value, not a universal Spotify callback. The registered URI and the URI sent during OAuth/token exchange must match exactly. Follow Spotify's current loopback redirect rules.

## 5. Authorization Code with PKCE

Use Authorization Code with PKCE for the desktop app. Client Credentials is not a substitute for a user authorization token and cannot control a user's playback.

### Authorization endpoint

```http
GET https://accounts.spotify.com/authorize
```

| Parameter | Value |
| --- | --- |
| `client_id` | Spotify application Client ID |
| `response_type` | `code` |
| `redirect_uri` | Exact registered callback |
| `code_challenge_method` | `S256` |
| `code_challenge` | Base64url SHA-256 of the verifier |
| `state` | Cryptographically random CSRF value |
| `scope` | Minimum scopes required by enabled features |

Relevant scopes, subject to current API requirements:

- `user-read-private`: profile and subscription product where available.
- `user-read-email`: email, only if needed.
- `user-read-playback-state`: available devices and playback state.
- `user-modify-playback-state`: playback control.
- `user-read-currently-playing`: current track information where required.
- `streaming`: Web Playback SDK.
- `user-top-read`: top tracks, if supported by the app.
- `user-library-read`: saved library, if supported by the app.

Request only needed scopes. Reauthorize when adding new permissions.

### Token exchange

```http
POST https://accounts.spotify.com/api/token
Content-Type: application/x-www-form-urlencoded
```

```text
grant_type=authorization_code
client_id=CLIENT_ID
code=AUTHORIZATION_CODE
redirect_uri=http://127.0.0.1:45893/callback
code_verifier=ORIGINAL_PKCE_VERIFIER
```

### Refresh token

```http
POST https://accounts.spotify.com/api/token
Content-Type: application/x-www-form-urlencoded
```

```text
grant_type=refresh_token
client_id=CLIENT_ID
refresh_token=REFRESH_TOKEN
```

Preserve the previous refresh token if the response omits a replacement. Refresh before expiry, coordinate concurrent refresh requests and never log tokens.

Reference: https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow

## 6. Endpoint reference

Base URL:

```text
https://api.spotify.com/v1
```

Every user endpoint requires the appropriate Bearer token, scopes, subscription permissions and app access tier. Endpoint availability must be verified for the actual Client ID.

### Account and catalog

| Method | Endpoint | Purpose | Typical scope |
| --- | --- | --- | --- |
| GET | `/me` | Connected account/profile | `user-read-private` |
| GET | `/tracks/{id}` | Track metadata | App access requirements |
| GET | `/search?q={query}&type=track&limit=10` | Catalog search | App access requirements |
| GET | `/me/top/tracks?time_range=medium_term&limit=20` | Top tracks | `user-top-read` |
| GET | `/me/tracks` | Saved tracks, if available | `user-library-read` |

Do not use catalog access as proof of playback entitlement. Some catalog/library endpoints may have changed or be restricted under newer access modes; check current docs and the actual response.

### Devices and playback state

| Method | Endpoint | Purpose | Typical scope |
| --- | --- | --- | --- |
| GET | `/me/player/devices` | List Spotify Connect devices | `user-read-playback-state` |
| GET | `/me/player` | Current playback and device | `user-read-playback-state` |
| GET | `/me/player/currently-playing` | Current track/progress | `user-read-currently-playing` where required |

### Playback control

| Method | Endpoint | Purpose |
| --- | --- | --- |
| PUT | `/me/player/play?device_id={id}` | Start/resume playback |
| PUT | `/me/player/pause?device_id={id}` | Pause |
| POST | `/me/player/next?device_id={id}` | Next |
| POST | `/me/player/previous?device_id={id}` | Previous |
| PUT | `/me/player/seek?position_ms={ms}&device_id={id}` | Seek |
| PUT | `/me/player/volume?volume_percent={0..100}&device_id={id}` | Volume |
| PUT | `/me/player` | Transfer playback |

These controls normally require `user-modify-playback-state`, plus the applicable account and app access permissions. Check each endpoint's current reference and supported-device restrictions.

Example start request:

```http
PUT https://api.spotify.com/v1/me/player/play?device_id=SELECTED_DEVICE_ID
Authorization: Bearer ACCESS_TOKEN
Content-Type: application/json
```

```json
{
  "uris": ["spotify:track:TRACK_ID"]
}
```

Example transfer request:

```http
PUT https://api.spotify.com/v1/me/player
Authorization: Bearer ACCESS_TOKEN
Content-Type: application/json
```

```json
{
  "device_ids": ["SELECTED_DEVICE_ID"],
  "play": false
}
```

Do not silently transfer playback away from another device. A successful HTTP response is not proof that audio is actually playing; confirm through subsequent playback state.

Official references:

- https://developer.spotify.com/documentation/web-api/reference/get-a-users-available-devices
- https://developer.spotify.com/documentation/web-api/reference/get-information-about-the-users-current-playback
- https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback
- https://developer.spotify.com/documentation/web-api/reference/pause-a-users-playback
- https://developer.spotify.com/documentation/web-api/reference/transfer-a-users-playback
- https://developer.spotify.com/documentation/web-api/reference/skip-users-playback-to-next-track
- https://developer.spotify.com/documentation/web-api/reference/skip-users-playback-to-previous-track
- https://developer.spotify.com/documentation/web-api/reference/seek-to-position-in-currently-playing-track
- https://developer.spotify.com/documentation/web-api/reference/set-volume-for-users-playback

## 7. First working milestone: Spotify Connect

Build this before attempting protected in-app streaming.

1. Authenticate through PKCE.
2. Fetch `/me` and display the available account information.
3. Fetch `/me/player/devices`.
4. Ask the user to open Spotify Desktop or another official compatible device.
5. Let the user explicitly select a device in Bikorch.
6. Select a Spotify track.
7. Call the start-playback endpoint with that device ID.
8. Confirm the intended track and playing state using the playback-state API.
9. Synchronize pause, resume, progress and supported controls.
10. If no device or playback entitlement is available, show the real reason and offer Open in Spotify.

This is remote control: the audio plays on the selected Spotify device, not necessarily inside Bikorch. Do not promise that this works for every new Development Mode app; verify endpoint access first.

Do not automatically choose the first device. Device IDs can become stale. Refresh the list when a request fails or devices change.

## 8. Optional in-app Web Playback SDK

Official documentation: https://developer.spotify.com/documentation/web-playback-sdk

SDK script:

```text
https://sdk.scdn.co/spotify-player.js
```

Use the official SDK-ready callback and construct `Spotify.Player` with a name, OAuth token callback and initial volume.

Handle:

- `ready`
- `not_ready`
- `initialization_error`
- `authentication_error`
- `account_error`
- `playback_error`
- `player_state_changed`
- `autoplay_failed` where supported

Only transfer playback after receiving a valid device ID from `ready`. Report actual SDK error messages and confirm real playback state.

### Electron limitations

Test protected playback in the actual development and packaged runtime. Do not assume standard Electron includes the necessary DRM components. Do not install unofficial Widevine packages, patch DRM, spoof browsers or disable security to work around a denial.

If the supported runtime cannot play Spotify audio, disable the in-app mode and use an authorized Spotify Connect device or Open in Spotify.

### Official embeds

Spotify embeds are a separate supported integration:

```text
https://open.spotify.com/embed/track/TRACK_ID
```

Follow official embed requirements and keep required player UI and attribution visible. Do not assume autoplay works or that the embed provides a fully custom player API. Do not hide it as an audio-extraction workaround.

Reference: https://developer.spotify.com/documentation/embeds

## 9. Fix the current source routing

Refactor the music store to distinguish the actual playback provider:

```text
MusicTrack
├── local   → LocalAudioProvider
├── spotify → SpotifyProvider
└── youtube → YouTubeProvider
```

For a Spotify track:

1. Use a verified local file only if explicitly associated with the track and selected by the user.
2. Otherwise use the selected Spotify playback mode.
3. If unavailable, return a typed error and offer Open in Spotify.
4. Offer YouTube search only as a separate user action with explicit source attribution.

Remove automatic Spotify-to-YouTube substitution. Do not store a YouTube match as if it were the original Spotify recording. Do not automatically download it.

Preserve existing playlists, history and local-library records through a versioned migration if necessary.

## 10. Error handling

Do not map every HTTP 403 to “Premium required.”

Suggested error codes:

```ts
type SpotifyErrorCode =
  | 'NOT_CONNECTED'
  | 'TOKEN_EXPIRED'
  | 'INSUFFICIENT_SCOPE'
  | 'APP_ACCESS_RESTRICTED'
  | 'PREMIUM_REQUIRED'
  | 'NO_ACTIVE_DEVICE'
  | 'DEVICE_NOT_READY'
  | 'PLAYBACK_RESTRICTED'
  | 'DRM_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'UNKNOWN'
```

| Response/event | Handling |
| --- | --- |
| 400 | Preserve request-validation/provider error |
| 401 | Refresh once, then reconnect if necessary |
| 403 | Inspect actual provider reason; distinguish scope, app tier, Premium and restrictions |
| 404 | Check device/active playback and endpoint response |
| 429 | Respect `Retry-After`; bounded backoff |
| SDK `account_error` | Surface account-related error |
| SDK `authentication_error` | Refresh/reconnect |
| SDK `initialization_error` | Report SDK/runtime initialization problem |
| SDK `playback_error` | Preserve error and stop false playing state |

Safe diagnostics may include endpoint name, status, redacted provider error code/message, selected mode, device type and state transitions.

Never log access tokens, refresh tokens, authorization codes, cookies, Client Secrets or full private API responses. Do not silently swallow failures or return `playing` just because a command was sent.

## 11. Suggested architecture

```text
Renderer UI / Music Store
          ↓
Typed preload / validated IPC
          ↓
Main-process Spotify Service
├── OAuth / token manager
├── API client
├── Device service
├── Playback controller
└── Capability / error mapper

Optional isolated SDK context
          ↓
Official Web Playback SDK
```

Use the existing project conventions rather than duplicating services.

Suggested contracts:

```ts
type SpotifyPlaybackMode = 'connect' | 'sdk' | 'external'

interface SpotifyDevice {
  id: string
  name: string
  type: string
  isActive: boolean
  isRestricted?: boolean
  supportsVolume?: boolean
}

interface SpotifyPlaybackResult {
  ok: boolean
  mode: SpotifyPlaybackMode
  deviceId?: string
  error?: {
    code: SpotifyErrorCode
    message: string
    httpStatus?: number
  }
}

interface SpotifyPlaybackState {
  trackId: string | null
  deviceId: string | null
  isPlaying: boolean
  positionMs: number
  durationMs: number
  volume: number | null
}
```

## 12. Security requirements

- Keep OAuth/refresh-token handling in the main process.
- Expose only minimum necessary tokens to an SDK context, if used.
- No Client Secret in the desktop bundle.
- No unrestricted HTTP proxy or arbitrary shell execution exposed through IPC.
- Validate track IDs, device IDs, URLs and IPC sender permissions.
- Allowlist external URL schemes and hosts before opening them.
- Isolate untrusted web content from the privileged preload bridge.
- Do not broaden CSP, disable sandbox/web security or spoof User-Agent as a workaround.
- Store credentials securely; surface storage failures.
- Disconnect must clear local authorization state safely.
- Changing Client ID must invalidate/reconcile existing authorization.
- Review OAuth callback state, exact path, server errors, timeout cleanup and concurrent-login behavior.

## 13. UI requirements

Music → Integrations → Spotify should display:

- Connected account and available product information
- Current playback mode
- Available devices and selected device
- Refresh devices
- Playback capability/availability
- Connect / Disconnect
- Open Spotify
- Safe diagnostics

Example:

```text
Spotify connected
Mode: Spotify Connect
Device: Spotify Desktop
Status: Ready
```

When in-app playback is unavailable:

```text
Spotify connected
In-app playback is unavailable in this runtime.
Select an authorized Spotify Connect device or open Spotify.
```

Do not tell the user to buy Premium when the actual failure is app access or DRM.

## 14. Implementation sequence

### Phase A — Audit
Inspect latest code, dashboard access mode and current Spotify docs. Identify actual supported endpoints and remove assumptions.

### Phase B — OAuth/API client
Improve PKCE lifecycle, token refresh, typed errors, secure storage and diagnostics.

### Phase C — Spotify Connect
Device list, explicit selection, playback controls and real-state synchronization. Test with an official Spotify device.

### Phase D — Optional SDK
Evaluate policy and runtime requirements. Implement only if authorized and supported; otherwise retain a truthful fallback.

### Phase E — Store/UI cleanup
Remove automatic cross-provider substitution. Separate playback states and keep local playback unaffected.

### Phase F — Tests
Add tests for token refresh concurrency, API error parsing, device selection, state transitions, source routing and fallbacks. Include manual integration testing for actual playback.

## 15. Acceptance criteria

- PKCE login works.
- Account and capability information is accurate.
- Supported catalog tracks can be selected.
- Available devices can be listed and explicitly selected when endpoints permit it.
- Playback controls work on a compatible authorized device.
- Real playback state confirms success.
- Unsupported control operations are reported honestly.
- 403 and SDK errors preserve their true cause.
- In-app audio is not claimed when DRM or policy requirements are unmet.
- No automatic Spotify-to-YouTube substitution remains.
- Existing local music, playlists and downloads remain functional.
- Credentials are not leaked into logs.
- Typecheck/build/tests pass; untested runtime conditions are documented.

## 16. Final coding-agent instruction

Do not solve this by adding fallback chains, spoofing Chrome, disabling security or installing unofficial DRM components.

First make the supported Spotify Connect workflow reliable with explicit device selection and real state verification. Then evaluate official in-app playback as an optional capability. If the app's access tier or commercial-use status does not permit the required feature, report that limitation accurately and implement the supported alternative rather than pretending playback succeeded.
