import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, missingCredentials, normalizeConfig } from '../src/config.js';

test('an empty configuration gets the defaults', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  assert.deepEqual(normalizeConfig(null), DEFAULT_CONFIG);
});

test('numbers sent as text are read, and kept within bounds', () => {
  const config = normalizeConfig({ poll_frequency: '120', key_expiry_warning_days: '200' });
  assert.equal(config.poll_frequency, 120);
  assert.equal(config.key_expiry_warning_days, 90);
  assert.equal(normalizeConfig({ poll_frequency: 5 }).poll_frequency, 30);
  assert.equal(normalizeConfig({ poll_frequency: 'abc' }).poll_frequency, 60);
});

test('an empty tailnet means the tailnet of the credentials', () => {
  assert.equal(normalizeConfig({ tailnet: '  ' }).tailnet, '-');
  assert.equal(normalizeConfig({ tailnet: ' example.com ' }).tailnet, 'example.com');
});

test('the credentials needed depend on the sign-in method', () => {
  assert.equal(missingCredentials(normalizeConfig({})), 'missing_api_key');
  assert.equal(missingCredentials(normalizeConfig({ api_key: ' tskey-api-x ' })), null);
  assert.equal(
    missingCredentials(normalizeConfig({ auth_method: 'oauth', oauth_client_id: 'id' })),
    'missing_oauth_client',
  );
  assert.equal(
    missingCredentials(
      normalizeConfig({ auth_method: 'oauth', oauth_client_id: 'id', oauth_client_secret: 's' }),
    ),
    null,
  );
  assert.equal(normalizeConfig({ auth_method: 'nonsense' }).auth_method, 'api_key');
});

test('the shared machines switch only turns on when asked', () => {
  assert.equal(normalizeConfig({ include_external: true }).include_external, true);
  assert.equal(normalizeConfig({ include_external: 'true' }).include_external, true);
  assert.equal(normalizeConfig({ include_external: 1 }).include_external, false);
});
