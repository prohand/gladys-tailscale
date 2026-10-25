# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and to human contributors working on
this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime dependency:
`@gladysassistant/integration-sdk`) for **Tailscale**. It reads a tailnet through the Tailscale
API v2 (`https://api.tailscale.com`, cloud only — the Gladys container is not on the tailnet) and
turns every machine into a Gladys device. Gladys 5.1+ adds scene triggers (machine online/offline,
new machine, update available, key expiring), scene actions (refresh, read a machine, change its key
expiry) and a "Tailscale network" dashboard widget.

Started from the official
[JavaScript integration template](https://github.com/GladysAssistant/integration-template-js);
the workflows are the same as [gladys-devmel](https://github.com/prohand/gladys-devmel).

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/app.test.js                # one file
node --test --test-name-pattern "widget"    # tests whose name matches
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store --skip-image-check .   # store checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on Node 22 and 24, and on
pull requests the store checks (image skipped: the Release workflow re-runs them in full once the
image is published) and a Docker build: run the three commands before pushing.

Releases: **Actions → Release** only (bumps `package.json`, manifest `version` + `docker_image`,
rolls `CHANGELOG.md`, re-runs Prettier, tags, builds the multi-arch image, publishes the GitHub
Release).

## Architecture

```
index.js                     SDK bootstrap only: createTailscaleApp(gladys), connect, shutdown
src/app.js                   every handler + the refresh timer and what each refresh publishes
src/config.js                DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/i18n.js                  LANGUAGES (en, fr, de, es), pick(), localize()
src/tailscale/client.js      API v2 client: API token or OAuth client, errors as API_ERRORS kinds
src/tailscale/machines.js    API device object -> machine (online, key expiry days, ...)
src/tailscale/tailnet.js     last snapshot + change detection for the scene triggers
src/devices/machine.js       Gladys device payload and states of one machine
src/capabilities/scenes.js   scene triggers (events) and scene actions (Gladys 5.1+)
src/capabilities/widget.js   the `tailnet` dashboard widget + the user-facing error messages
gladys-assistant-integration.json  manifest
docs/{en,fr,de,es}.md        user documentation, re-hosted by Gladys (mandatory)
test/                        node --test, SDK fake Gladys + test/helpers/fakeTailscale.js
.github/scripts/changelog-release.mjs  rolls [Unreleased] at release time (tested)
```

### Invariants worth knowing

- **One API call per refresh**: `GET /tailnet/{tailnet}/devices?fields=all`, driven by the
  integration's own timer (`poll_frequency` seconds). Devices are published with
  `should_poll: false`; Gladys never polls them.
- **States only for created devices** (`gladys.devices`), through `publishChangedStates` (300
  states/minute limit). A device just created gets its states from `onDeviceCreated`.
- **Scene events only from the periodic refresh.** `Tailnet.refresh({ detectChanges: true })`
  compares with a baseline only the timer moves; the first periodic refresh (start, new config)
  only sets it. Refreshes asked by a button, the widget or a scene action never fire an event (no
  loops), and the transition they saw is still announced by the next periodic refresh.
- **Transport badge**: `cloud` while the API answers, `unreachable` when it fails. The manifest
  declares `"transports": ["cloud"]` only: there is no local channel.
- **Online** comes from `connectedToControl`; without it (older answers), `lastSeen` within 5
  minutes.
- **Secrets** (`api_key`, `oauth_client_secret`, OAuth access tokens) never reach a log line or an
  error message. OAuth tokens live in memory and are renewed a minute before they expire, or once
  on a 401.

## Rules

- **External ids are forever.** Machines are keyed on the Tailscale `nodeId`
  (`gladys.externalIds('machine', nodeId)`), never on a name. Feature keys (`online`,
  `update_available`, `key_expiry_days`, `key_expiry_disabled`), config keys, action, scene trigger,
  scene action and widget keys are stored by users: never rename them.
- **The container rootfs is read-only.** Write only under `/data`. Never log tokens or secrets.
- **Versions belong to the Release workflow.** Never edit `version` in `package.json` or the
  manifest, nor the `docker_image` tag, by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]` in `CHANGELOG.md`
  (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`). Never write a version heading.
- **Manifest.** Every text is `{ en, fr, de, es }` (`label`, `description`, `placeholder`). The
  catalog `description` holds 10 to 100 characters per language, a widget label 3 to 30.
  `scene_triggers`, `scene_actions` and `widgets` need `gladys_version >=5.1.0`, the catalog
  `keywords` `>=5.3.0` (the floor today); no `countries`, the integration is worldwide.
  `test/manifest.test.js` ties the manifest to the code: change both sides together.
- **Widget content** must pass `validateWidgetContent` with `[]` (see `test/app.test.js`): mind the
  length caps (button and link labels 24, badge 16, status label/value 40, caption 80).
- **User-facing text** is `{ en, fr, de, es }`, built with `src/i18n.js`; user docs in
  `docs/en.md`, `docs/fr.md`, `docs/de.md` and `docs/es.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why, in English. Tests
  never touch the network.
