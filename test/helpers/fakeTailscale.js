// -----------------------------------------------------------------------------
// An in-memory Tailscale API, served through an injected `fetch`.
//
// It answers the three endpoints the integration calls — the device list, the
// key expiry change and the OAuth token exchange — records every request, and
// can be told to fail. No network is ever touched.
// -----------------------------------------------------------------------------

export const API_KEY = 'tskey-api-test-secret';
export const OAUTH_CLIENT = { id: 'k123CNTRL', secret: 'tskey-client-test-secret' };

/** A raw device object, as GET /tailnet/-/devices?fields=all returns it. */
export function rawDevice(overrides = {}) {
  return {
    addresses: ['100.101.102.103', 'fd7a:115c:a1e0::1'],
    id: '92960230385',
    nodeId: 'nAbC1CNTRL',
    user: 'admin@example.com',
    name: 'server.tail1234.ts.net',
    hostname: 'server',
    clientVersion: '1.76.1-t1234abcd-g5678',
    updateAvailable: false,
    os: 'linux',
    created: '2025-01-01T00:00:00Z',
    lastSeen: '2026-10-14T11:59:00Z',
    keyExpiryDisabled: false,
    expires: '2027-01-01T00:00:00Z',
    authorized: true,
    isExternal: false,
    tags: [],
    connectedToControl: true,
    ...overrides,
  };
}

export function createFakeTailscale({ devices = [rawDevice()] } = {}) {
  const state = {
    devices,
    requests: [],
    /** Status to answer the next requests with, instead of the normal answer. */
    failWith: null,
    /** Throw a network error instead of answering. */
    offline: false,
    tokens: 0,
    validTokens: new Set([API_KEY]),
  };

  function json(status, body) {
    return new Response(body === undefined ? '' : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async function fetch(url, init = {}) {
    const { pathname, searchParams } = new URL(url);
    const request = {
      method: init.method ?? 'GET',
      path: pathname,
      query: Object.fromEntries(searchParams),
      headers: init.headers ?? {},
      body: init.body,
    };
    state.requests.push(request);
    if (state.offline) {
      throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    }

    if (pathname === '/api/v2/oauth/token') {
      const form = new URLSearchParams(init.body);
      if (
        form.get('client_id') !== OAUTH_CLIENT.id ||
        form.get('client_secret') !== OAUTH_CLIENT.secret
      ) {
        return json(401, { message: 'invalid client' });
      }
      state.tokens += 1;
      const token = `oauth-token-${state.tokens}`;
      state.validTokens.add(token);
      return json(200, { access_token: token, token_type: 'Bearer', expires_in: 3600 });
    }

    if (state.failWith) {
      return json(state.failWith, { message: `failure ${state.failWith}` });
    }
    const token = String(request.headers.Authorization ?? '').replace(/^Bearer /, '');
    if (!state.validTokens.has(token)) {
      return json(401, { message: 'API token invalid' });
    }

    const list = pathname.match(/^\/api\/v2\/tailnet\/([^/]+)\/devices$/);
    if (list && request.method === 'GET') {
      if (decodeURIComponent(list[1]) !== '-' && decodeURIComponent(list[1]) !== 'example.com') {
        return json(404, { message: 'tailnet not found' });
      }
      return json(200, { devices: state.devices });
    }

    const key = pathname.match(/^\/api\/v2\/device\/([^/]+)\/key$/);
    if (key && request.method === 'POST') {
      const nodeId = decodeURIComponent(key[1]);
      const device = state.devices.find((entry) => entry.nodeId === nodeId);
      if (!device) {
        return json(404, { message: 'device not found' });
      }
      const { keyExpiryDisabled } = JSON.parse(init.body);
      device.keyExpiryDisabled = keyExpiryDisabled;
      if (keyExpiryDisabled) {
        device.expires = '0001-01-01T00:00:00Z';
      }
      return json(200);
    }

    return json(404, { message: 'not found' });
  }

  return { state, fetch };
}
