# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, secrets, Tailscale IPs and machine
  names first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes —
in particular how it stores, sends and logs the Tailscale credentials (API
access token, OAuth client secret, the OAuth access tokens it obtains).

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and Tailscale (see [tailscale.com/security](https://tailscale.com/security)).

## What the integration does with your credentials

- They are stored by Gladys as `secret` configuration fields, never sent back
  to the browser.
- They are only ever sent to `https://api.tailscale.com`, over HTTPS.
- They never appear in the logs nor in an error message.
- The OAuth access token lives in memory only, and expires after an hour.

Give the integration the least it needs: an OAuth client with the
**Devices → Core: Read** scope is enough to watch the machines; add **Write**
only if you want to change the key expiry from Gladys.
