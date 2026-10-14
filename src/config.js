// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys, from the `config_schema` of
// `gladys-assistant-integration.json`. This module provides the defaults and
// normalizes what Gladys sends (numbers may arrive as strings, an untouched
// field as undefined), so the rest of the code never deals with either.
// -----------------------------------------------------------------------------

/** How the integration signs in to the Tailscale API. Stored by users: never renamed. */
export const AUTH_METHODS = {
  API_KEY: 'api_key',
  OAUTH: 'oauth',
};

/** "-" is the Tailscale API alias of the tailnet the credentials belong to. */
export const DEFAULT_TAILNET = '-';

// Defaults: they MUST stay consistent with the `default` values declared in
// the manifest `config_schema` (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  auth_method: AUTH_METHODS.API_KEY,
  api_key: '',
  oauth_client_id: '',
  oauth_client_secret: '',
  tailnet: DEFAULT_TAILNET,
  // Seconds between two reads of the machine list. One API call per refresh,
  // whatever the size of the tailnet.
  poll_frequency: 60,
  // A machine whose node key expires within this many days fires the
  // `key_expiring` scene trigger and shows up in the widget.
  key_expiry_warning_days: 14,
  // Machines shared INTO the tailnet by another one (`isExternal`): not yours
  // to manage, hidden unless asked for.
  include_external: false,
};

export const POLL_FREQUENCY = { MIN: 30, MAX: 3600 };
export const KEY_EXPIRY_WARNING = { MIN: 1, MAX: 90 };

/**
 * Merge the user config with the defaults and force the types.
 * @param {Record<string, unknown>} [raw] config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw ?? {};
  const authMethod = Object.values(AUTH_METHODS).includes(source.auth_method)
    ? source.auth_method
    : DEFAULT_CONFIG.auth_method;
  return {
    ...DEFAULT_CONFIG,
    auth_method: authMethod,
    api_key: text(source.api_key),
    oauth_client_id: text(source.oauth_client_id),
    oauth_client_secret: text(source.oauth_client_secret),
    tailnet: text(source.tailnet) || DEFAULT_TAILNET,
    poll_frequency: bounded(
      source.poll_frequency,
      DEFAULT_CONFIG.poll_frequency,
      POLL_FREQUENCY.MIN,
      POLL_FREQUENCY.MAX,
    ),
    key_expiry_warning_days: bounded(
      source.key_expiry_warning_days,
      DEFAULT_CONFIG.key_expiry_warning_days,
      KEY_EXPIRY_WARNING.MIN,
      KEY_EXPIRY_WARNING.MAX,
    ),
    include_external: source.include_external === true || source.include_external === 'true',
  };
}

/**
 * What is missing before the integration can call the API, as a short code:
 * null when the credentials of the chosen method are filled in.
 * @param {ReturnType<typeof normalizeConfig>} config
 * @returns {'missing_api_key' | 'missing_oauth_client' | null}
 */
export function missingCredentials(config) {
  if (config.auth_method === AUTH_METHODS.OAUTH) {
    return config.oauth_client_id && config.oauth_client_secret ? null : 'missing_oauth_client';
  }
  return config.api_key ? null : 'missing_api_key';
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function bounded(value, fallback, min, max) {
  const number = Number(value);
  if (value === undefined || value === null || value === '' || !Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}
