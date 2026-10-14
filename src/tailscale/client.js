// -----------------------------------------------------------------------------
// Tailscale API client (https://tailscale.com/api, v2).
//
// The only channel this integration has: the Tailscale control plane, in the
// cloud. Gladys runs in a sandboxed container that is not itself on the
// tailnet, so there is no local API to reach — hence `"transports": ["cloud"]`.
//
// Two ways to sign in, chosen in the configuration:
//   - an API access token (`tskey-api-…`), sent as a Bearer token. It expires
//     (90 days at most): the integration says so when the API refuses it;
//   - an OAuth client (`client_id` + `client_secret`), which never expires: it
//     is traded for a one-hour access token, cached and renewed here.
//
// Secrets never reach a log line or an error message.
// -----------------------------------------------------------------------------

import { AUTH_METHODS, missingCredentials } from '../config.js';

export const API_BASE_URL = 'https://api.tailscale.com/api/v2';
export const OAUTH_TOKEN_URL = `${API_BASE_URL}/oauth/token`;

/** Every request gives up after this long: a refresh must never pile up. */
export const REQUEST_TIMEOUT_MS = 15_000;

/** An OAuth access token is renewed this long before it expires. */
const TOKEN_MARGIN_MS = 60_000;

/** What went wrong, as a short code the messages and scenes are built from. */
export const API_ERRORS = {
  NOT_CONFIGURED: 'not_configured',
  AUTH: 'auth',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  RATE_LIMITED: 'rate_limited',
  NETWORK: 'network',
  HTTP: 'http',
};

export class TailscaleApiError extends Error {
  /**
   * @param {string} kind one of API_ERRORS
   * @param {string} message safe to log: never carries a secret
   * @param {number} [status] HTTP status, when the API answered
   */
  constructor(kind, message, status) {
    super(message);
    this.name = 'TailscaleApiError';
    this.kind = kind;
    this.status = status;
  }
}

/**
 * Create a client bound to one configuration.
 *
 * @param {object} options
 * @param {object} options.config normalized configuration (see src/config.js)
 * @param {typeof fetch} [options.fetch] injected by the tests
 * @param {() => number} [options.now] clock, for the OAuth token lifetime
 */
export function createTailscaleClient({ config, fetch = globalThis.fetch, now = Date.now }) {
  let oauthToken = null; // { value, expiresAt }

  async function accessToken({ renew = false } = {}) {
    if (config.auth_method !== AUTH_METHODS.OAUTH) {
      return config.api_key;
    }
    if (!renew && oauthToken && now() < oauthToken.expiresAt - TOKEN_MARGIN_MS) {
      return oauthToken.value;
    }
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.oauth_client_id,
      client_secret: config.oauth_client_secret,
    });
    const response = await send(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const payload = await readJson(response);
    if (!response.ok || typeof payload?.access_token !== 'string') {
      // The token endpoint answers 400/401 for a wrong client: both mean the
      // credentials, not the network.
      throw new TailscaleApiError(
        response.status === 429 ? API_ERRORS.RATE_LIMITED : API_ERRORS.AUTH,
        `OAuth client refused (HTTP ${response.status})`,
        response.status,
      );
    }
    const lifetimeS = Number(payload.expires_in);
    oauthToken = {
      value: payload.access_token,
      expiresAt: now() + (Number.isFinite(lifetimeS) && lifetimeS > 0 ? lifetimeS : 3600) * 1000,
    };
    return oauthToken.value;
  }

  async function send(url, init) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      const reason =
        err?.name === 'TimeoutError' ? 'timed out' : (err?.cause?.code ?? err?.message);
      throw new TailscaleApiError(API_ERRORS.NETWORK, `Tailscale API unreachable (${reason})`);
    }
  }

  /** One authenticated call; an OAuth token refused once is renewed and retried. */
  async function request(method, path, body) {
    if (missingCredentials(config)) {
      throw new TailscaleApiError(API_ERRORS.NOT_CONFIGURED, 'No Tailscale credentials configured');
    }
    let response;
    for (const renew of [false, true]) {
      const token = await accessToken({ renew });
      response = await send(`${API_BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.status !== 401 || config.auth_method !== AUTH_METHODS.OAUTH) {
        break;
      }
    }
    if (!response.ok) {
      throw errorFor(response.status, await readJson(response), `${method} ${path}`);
    }
    return readJson(response);
  }

  return {
    /**
     * Every machine of the tailnet, with all the fields the API knows
     * (`fields=all`: connection state, routes, client version…).
     * @returns {Promise<Array<object>>} raw device objects
     */
    async listDevices() {
      const tailnet = encodeURIComponent(config.tailnet);
      const payload = await request('GET', `/tailnet/${tailnet}/devices?fields=all`);
      return Array.isArray(payload?.devices) ? payload.devices : [];
    },

    /**
     * Turn the node key expiry of one machine off (true) or back on (false).
     * @param {string} nodeId the machine's `nodeId`
     * @param {boolean} disabled
     */
    async setKeyExpiryDisabled(nodeId, disabled) {
      await request('POST', `/device/${encodeURIComponent(nodeId)}/key`, {
        keyExpiryDisabled: Boolean(disabled),
      });
    },
  };
}

function errorFor(status, payload, what) {
  // The API explains itself in `message`: worth logging, never a secret.
  const detail = typeof payload?.message === 'string' ? `: ${payload.message.slice(0, 200)}` : '';
  const message = `${what} answered HTTP ${status}${detail}`;
  if (status === 401) {
    return new TailscaleApiError(API_ERRORS.AUTH, message, status);
  }
  if (status === 403) {
    return new TailscaleApiError(API_ERRORS.FORBIDDEN, message, status);
  }
  if (status === 404) {
    return new TailscaleApiError(API_ERRORS.NOT_FOUND, message, status);
  }
  if (status === 429) {
    return new TailscaleApiError(API_ERRORS.RATE_LIMITED, message, status);
  }
  return new TailscaleApiError(API_ERRORS.HTTP, message, status);
}

async function readJson(response) {
  const raw = await response.text().catch(() => '');
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
