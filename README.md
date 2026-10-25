# Tailscale — Gladys Assistant integration

External integration connecting [Gladys Assistant](https://gladysassistant.com)
to a [Tailscale](https://tailscale.com) network: every machine of the tailnet
becomes a Gladys device that says whether it is online, whether a Tailscale
update is waiting and when its key expires.

Built on the official
[JavaScript integration template](https://github.com/GladysAssistant/integration-template-js)
and the SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

User documentation: [English](./docs/en.md) · [Français](./docs/fr.md) ·
[Deutsch](./docs/de.md) · [Español](./docs/es.md).

Requires **Gladys 5.3.0** or later.

## What it does

| Gladys feature      | Source (Tailscale API)                       | Read / write |
| ------------------- | -------------------------------------------- | ------------ |
| Online              | `connectedToControl` (else `lastSeen`)       | read         |
| Update available    | `updateAvailable`                            | read         |
| Key expiry (days)   | `expires`                                    | read         |
| Key expiry disabled | `keyExpiryDisabled`, `POST /device/{id}/key` | read + write |

**Transport: cloud only.** The integration reads the tailnet through the
Tailscale API (`api.tailscale.com`); the Gladys container is not itself on the
tailnet, so there is no local channel. The manifest declares
`"transports": ["cloud"]`, and each machine shows a `cloud` badge while the API
answers, `unreachable` when it does not.

Sign-in with an **API access token** (`tskey-api-…`, expires after 90 days at
most) or an **OAuth client** with the `devices:core` scope (never expires,
recommended).

Since Gladys 5.1 it also extends the scene editor and the dashboard
([`src/capabilities/`](./src/capabilities)):

| Capability    | Key                  | What                                                    |
| ------------- | -------------------- | ------------------------------------------------------- |
| Scene trigger | `connection_changed` | a machine went online or offline                        |
| Scene trigger | `machine_added`      | a machine joined the tailnet (approved or pending)      |
| Scene trigger | `update_available`   | a newer Tailscale client exists for a machine           |
| Scene trigger | `key_expiring`       | a machine's key entered the warning window              |
| Scene action  | `refresh_tailnet`    | read the tailnet now → `machine_count`, `online_count`… |
| Scene action  | `get_machine_status` | read one machine → `online`, `ip`, `key_expiry_days`…   |
| Scene action  | `set_key_expiry`     | turn a machine's key expiry off or back on              |
| Widget        | `tailnet`            | counts, API status, machines that need attention        |

## Project structure

```
.
├─ index.js                          # SDK bootstrap (no logic)
├─ src/
│  ├─ app.js                         # handlers, refresh timer, what gets published
│  ├─ config.js                      # config defaults + normalization
│  ├─ i18n.js                        # en / fr / de / es helpers
│  ├─ tailscale/
│  │  ├─ client.js                   # Tailscale API v2 (API token or OAuth client)
│  │  ├─ machines.js                 # API device object -> machine
│  │  └─ tailnet.js                  # snapshot + change detection (scene triggers)
│  ├─ devices/machine.js             # Gladys device payload and states
│  └─ capabilities/
│     ├─ scenes.js                   # scene triggers and actions (Gladys 5.1+)
│     └─ widget.js                   # dashboard widget (Gladys 5.1+)
├─ docs/{en,fr,de,es}.md             # user documentation (re-hosted by Gladys)
├─ test/                             # node --test, fake Gladys + fake Tailscale API
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, read-only rootfs ready
├─ CHANGELOG.md                      # Keep a Changelog, rolled by the Release workflow
├─ CLAUDE.md                         # project rules for contributors & coding assistants
├─ SECURITY.md                       # how to report a vulnerability privately
└─ .github/
   ├─ workflows/ci.yml               # format, lint, tests (Node 22 + 24), store checks, Docker build
   ├─ workflows/release.yml          # UI-driven release: bump + changelog + tag + build
   ├─ workflows/build.yml            # multi-arch build (tag, manual or called by release)
   ├─ workflows/github-release.yml   # GitHub Release of every version tag
   ├─ scripts/changelog-release.mjs  # rolls [Unreleased] at release time
   └─ dependabot.yml                 # npm weekly, Actions and Docker monthly
```

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="tailscale" \
LOG_LEVEL=debug \
npm start
```

The three `GLADYS_*` variables are injected by the Gladys supervisor when the
integration runs inside its sandboxed container.

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test
npx github:GladysAssistant/integration-store --skip-image-check .   # store checks
```

The same checks run in CI on every push to `main` and every pull request, on
Node 22 and 24; pull requests also run the store admission checks (image
skipped: the Release workflow runs the full check once the image is published)
and build the Docker image. Tests never touch the network: the Tailscale API is faked
in [`test/helpers/fakeTailscale.js`](./test/helpers/fakeTailscale.js) and
Gladys by the SDK's `createFakeGladys()`.

## Publish

1. Add the GitHub topic `gladys-assistant-integration` to the repository.
2. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
3. **Actions → Release → Run workflow**, pick `patch`, `minor` or `major`: the
   workflow bumps the version everywhere, rolls the changelog, pushes the
   `vX.Y.Z` tag, builds the `linux/amd64` + `linux/arm64` image to `ghcr.io`
   and publishes the GitHub Release.

First version: `1.0.0` is already written in `package.json`, the manifest and
the changelog. Publish it by pushing its tag, which runs the same build and
GitHub Release:

```bash
git tag v1.0.0 && git push origin v1.0.0
```

Then make the `ghcr.io/prohand/gladys-tailscale` package **public** (GitHub →
Packages → Package settings), and turn on **Private vulnerability reporting**
in the repository's security settings: [`SECURITY.md`](SECURITY.md) sends
reporters there.

## License

Apache-2.0
