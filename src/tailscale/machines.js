// -----------------------------------------------------------------------------
// From the device objects of the Tailscale API to the machines this
// integration works with.
//
// The API object is large and has grown over the years; everything below reads
// it defensively, so a field Tailscale renames or drops degrades one value
// instead of the whole refresh.
// -----------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Without `connectedToControl` (older API answers), a machine seen by the
 * control plane within this window counts as online: a connected client talks
 * to it every minute or so.
 */
export const ONLINE_WINDOW_MS = 5 * 60 * 1000;

/**
 * One machine, as the rest of the code sees it.
 *
 * @param {object} raw a device object of GET /tailnet/{tailnet}/devices
 * @param {number} [now] clock
 * @returns {object|null} null when the object has no usable identifier
 */
export function normalizeMachine(raw, now = Date.now()) {
  // `nodeId` is the identifier the API recommends; the numeric `id` is the
  // legacy one. Either is stable for the life of the machine.
  const nodeId = stringOrNull(raw?.nodeId) ?? stringOrNull(raw?.id);
  if (!nodeId) {
    return null;
  }
  const fqdn = stringOrNull(raw.name) ?? '';
  const hostname = stringOrNull(raw.hostname) ?? '';
  const addresses = Array.isArray(raw.addresses) ? raw.addresses.filter(isString) : [];
  const lastSeen = dateOrNull(raw.lastSeen);
  const keyExpiryDisabled = raw.keyExpiryDisabled === true;
  // A machine whose expiry is off reports the zero date, `0001-01-01T00:00:00Z`.
  const expires = keyExpiryDisabled ? null : dateOrNull(raw.expires);

  return {
    nodeId,
    // The MagicDNS name, without the tailnet domain: what the admin console
    // shows first. The OS hostname when the machine has no MagicDNS name yet.
    name: fqdn.split('.')[0] || hostname || nodeId,
    fqdn,
    hostname,
    os: stringOrNull(raw.os) ?? '',
    user: stringOrNull(raw.user) ?? '',
    tags: Array.isArray(raw.tags) ? raw.tags.filter(isString) : [],
    addresses,
    ipv4: addresses.find((address) => !address.includes(':')) ?? null,
    ipv6: addresses.find((address) => address.includes(':')) ?? null,
    clientVersion: shortVersion(raw.clientVersion),
    updateAvailable: raw.updateAvailable === true,
    online: isOnline(raw, lastSeen, now),
    lastSeen,
    authorized: raw.authorized !== false,
    external: raw.isExternal === true,
    keyExpiryDisabled,
    expires,
    keyExpiryDays: expires === null ? null : Math.max(0, Math.floor((expires - now) / DAY_MS)),
    keyExpired: expires !== null && expires <= now,
  };
}

/**
 * The machines of an API answer, sorted by name, the shared-in ones dropped
 * unless asked for.
 *
 * @param {Array<object>} devices raw device objects
 * @param {object} options
 * @param {boolean} [options.includeExternal]
 * @param {number} [options.now]
 */
export function normalizeMachines(devices, { includeExternal = false, now = Date.now() } = {}) {
  const machines = new Map();
  for (const raw of devices ?? []) {
    const machine = normalizeMachine(raw, now);
    if (!machine || (machine.external && !includeExternal)) {
      continue;
    }
    machines.set(machine.nodeId, machine);
  }
  return [...machines.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Is the machine's key within the warning window (or already expired)? */
export function keyExpiresSoon(machine, warningDays) {
  return machine.keyExpiryDays !== null && machine.keyExpiryDays <= warningDays;
}

/** Does the machine need the administrator's attention? */
export function needsAttention(machine, warningDays) {
  return (
    !machine.online ||
    !machine.authorized ||
    machine.updateAvailable ||
    keyExpiresSoon(machine, warningDays)
  );
}

function isOnline(raw, lastSeen, now) {
  if (typeof raw.connectedToControl === 'boolean') {
    return raw.connectedToControl;
  }
  return lastSeen !== null && now - lastSeen <= ONLINE_WINDOW_MS;
}

/** `1.76.1-t2a3b4c5d-g1234` → `1.76.1`: the build suffix means nothing to a user. */
function shortVersion(value) {
  const version = stringOrNull(value);
  return version ? version.split('-')[0] : '';
}

/** A timestamp in ms, or null for a missing, invalid or zero date. */
function dateOrNull(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) && time > 0 ? time : null;
}

function stringOrNull(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function isString(value) {
  return typeof value === 'string' && value !== '';
}
