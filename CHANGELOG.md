# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-14

- Maintenance release, no functional change.

## [1.0.0] - 2026-10-14

### Added

- Every machine of the tailnet as a Gladys device: online, update available,
  days before its key expires, and a switch to turn its key expiry off.
- Sign-in with an API access token or an OAuth client (which never expires).
- One request to the Tailscale API per refresh, whatever the number of
  machines; the interval is set in the configuration (60 s by default).
- "Test the connection" button in the configuration screen.
- Cloud transport badge on every machine: `unreachable` when the API does not
  answer.
- Scene triggers (Gladys 5.1+): machine online or offline, new machine in the
  tailnet, Tailscale update available, key expiring soon.
- Scene actions (Gladys 5.1+): refresh the tailnet, read a machine's status,
  change a machine's key expiry.
- "Tailscale network" dashboard widget (Gladys 5.1+).
- English, French, German and Spanish translations (configuration screen,
  messages, widget, documentation).

[Unreleased]: https://github.com/prohand/gladys-tailscale/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/prohand/gladys-tailscale/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/prohand/gladys-tailscale/releases/tag/v1.0.0
