import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { API_ERRORS, createTailscaleClient } from '../src/tailscale/client.js';
import { API_KEY, OAUTH_CLIENT, createFakeTailscale } from './helpers/fakeTailscale.js';

const apiKeyConfig = normalizeConfig({ api_key: API_KEY });
const oauthConfig = normalizeConfig({
  auth_method: 'oauth',
  oauth_client_id: OAUTH_CLIENT.id,
  oauth_client_secret: OAUTH_CLIENT.secret,
});

test('the device list is read with every field, signed with the API token', async () => {
  const api = createFakeTailscale();
  const client = createTailscaleClient({ config: apiKeyConfig, fetch: api.fetch });

  const devices = await client.listDevices();

  assert.equal(devices.length, 1);
  const [request] = api.state.requests;
  assert.equal(request.path, '/api/v2/tailnet/-/devices');
  assert.deepEqual(request.query, { fields: 'all' });
  assert.equal(request.headers.Authorization, `Bearer ${API_KEY}`);
});

test('an OAuth client is traded for a token, reused until it nearly expires', async () => {
  const api = createFakeTailscale();
  let clock = 0;
  const client = createTailscaleClient({ config: oauthConfig, fetch: api.fetch, now: () => clock });

  await client.listDevices();
  await client.listDevices();
  assert.equal(api.state.tokens, 1, 'one token for two calls');

  clock += 3600 * 1000 - 30_000; // inside the renewal margin
  await client.listDevices();
  assert.equal(api.state.tokens, 2);
  const tokenRequest = api.state.requests.find((r) => r.path === '/api/v2/oauth/token');
  assert.match(tokenRequest.body, /grant_type=client_credentials/);
});

test('an OAuth token refused by the API is renewed once', async () => {
  const api = createFakeTailscale();
  const client = createTailscaleClient({ config: oauthConfig, fetch: api.fetch });
  await client.listDevices();

  api.state.validTokens.clear(); // revoked server-side
  await client.listDevices();

  assert.equal(api.state.tokens, 2);
});

test('a wrong OAuth client is an authentication error', async () => {
  const api = createFakeTailscale();
  const config = normalizeConfig({ ...oauthConfig, oauth_client_secret: 'wrong' });
  const client = createTailscaleClient({ config, fetch: api.fetch });

  await assert.rejects(client.listDevices(), { kind: API_ERRORS.AUTH });
});

test('API failures map to the error kinds the messages are built from', async () => {
  const cases = [
    [401, API_ERRORS.AUTH],
    [403, API_ERRORS.FORBIDDEN],
    [404, API_ERRORS.NOT_FOUND],
    [429, API_ERRORS.RATE_LIMITED],
    [500, API_ERRORS.HTTP],
  ];
  for (const [status, kind] of cases) {
    const api = createFakeTailscale();
    api.state.failWith = status;
    const client = createTailscaleClient({ config: apiKeyConfig, fetch: api.fetch });
    await assert.rejects(client.listDevices(), { kind, status }, `HTTP ${status}`);
  }
});

test('an unknown tailnet is "not found"', async () => {
  const api = createFakeTailscale();
  const config = normalizeConfig({ api_key: API_KEY, tailnet: 'other.org' });
  const client = createTailscaleClient({ config, fetch: api.fetch });

  await assert.rejects(client.listDevices(), { kind: API_ERRORS.NOT_FOUND });
  assert.equal(api.state.requests[0].path, '/api/v2/tailnet/other.org/devices');
});

test('a network failure is a network error that never carries the token', async () => {
  const api = createFakeTailscale();
  api.state.offline = true;
  const client = createTailscaleClient({ config: apiKeyConfig, fetch: api.fetch });

  const err = await client.listDevices().catch((e) => e);
  assert.equal(err.kind, API_ERRORS.NETWORK);
  assert.match(err.message, /ENOTFOUND/);
  assert.doesNotMatch(err.message, /tskey/);
});

test('no credentials means no request at all', async () => {
  const api = createFakeTailscale();
  const client = createTailscaleClient({ config: normalizeConfig({}), fetch: api.fetch });

  await assert.rejects(client.listDevices(), { kind: API_ERRORS.NOT_CONFIGURED });
  assert.equal(api.state.requests.length, 0);
});

test('the key expiry change posts the documented body', async () => {
  const api = createFakeTailscale();
  const client = createTailscaleClient({ config: apiKeyConfig, fetch: api.fetch });

  await client.setKeyExpiryDisabled('nAbC1CNTRL', true);

  const request = api.state.requests.at(-1);
  assert.equal(request.method, 'POST');
  assert.equal(request.path, '/api/v2/device/nAbC1CNTRL/key');
  assert.deepEqual(JSON.parse(request.body), { keyExpiryDisabled: true });
  assert.equal(api.state.devices[0].keyExpiryDisabled, true);
});
