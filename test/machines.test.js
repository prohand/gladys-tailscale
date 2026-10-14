import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ONLINE_WINDOW_MS,
  keyExpiresSoon,
  needsAttention,
  normalizeMachine,
  normalizeMachines,
} from '../src/tailscale/machines.js';
import { rawDevice } from './helpers/fakeTailscale.js';

const NOW = Date.parse('2026-10-14T12:00:00Z');

test('a device object becomes a machine', () => {
  const machine = normalizeMachine(rawDevice(), NOW);

  assert.equal(machine.nodeId, 'nAbC1CNTRL');
  assert.equal(machine.name, 'server', 'the MagicDNS name without the tailnet domain');
  assert.equal(machine.fqdn, 'server.tail1234.ts.net');
  assert.equal(machine.ipv4, '100.101.102.103');
  assert.equal(machine.ipv6, 'fd7a:115c:a1e0::1');
  assert.equal(machine.clientVersion, '1.76.1', 'without the build suffix');
  assert.equal(machine.online, true);
  assert.equal(machine.authorized, true);
  assert.equal(machine.keyExpiryDays, 78);
  assert.equal(machine.keyExpired, false);
});

test('connectedToControl decides, the last-seen date only without it', () => {
  assert.equal(normalizeMachine(rawDevice({ connectedToControl: false }), NOW).online, false);

  const recent = new Date(NOW - ONLINE_WINDOW_MS + 1000).toISOString();
  const old = new Date(NOW - ONLINE_WINDOW_MS - 1000).toISOString();
  const withoutFlag = (lastSeen) =>
    normalizeMachine(rawDevice({ connectedToControl: undefined, lastSeen }), NOW).online;
  assert.equal(withoutFlag(recent), true);
  assert.equal(withoutFlag(old), false);
  assert.equal(withoutFlag(undefined), false);
});

test('a disabled key expiry has no date, whatever the API sends', () => {
  const machine = normalizeMachine(
    rawDevice({ keyExpiryDisabled: true, expires: '0001-01-01T00:00:00Z' }),
    NOW,
  );
  assert.equal(machine.expires, null);
  assert.equal(machine.keyExpiryDays, null);
  assert.equal(keyExpiresSoon(machine, 14), false);
});

test('an expired key counts zero days and needs attention', () => {
  const machine = normalizeMachine(rawDevice({ expires: '2026-10-01T00:00:00Z' }), NOW);
  assert.equal(machine.keyExpiryDays, 0);
  assert.equal(machine.keyExpired, true);
  assert.equal(needsAttention(machine, 14), true);
});

test('a machine without MagicDNS name falls back to its hostname, then its id', () => {
  assert.equal(normalizeMachine(rawDevice({ name: '' }), NOW).name, 'server');
  assert.equal(normalizeMachine(rawDevice({ name: '', hostname: '' }), NOW).name, 'nAbC1CNTRL');
});

test('only the legacy id is enough; no id at all is dropped', () => {
  assert.equal(normalizeMachine(rawDevice({ nodeId: undefined }), NOW).nodeId, '92960230385');
  assert.equal(normalizeMachine(rawDevice({ nodeId: undefined, id: undefined }), NOW), null);
});

test('shared-in machines are hidden unless asked for, the list sorted by name', () => {
  const devices = [
    rawDevice({ nodeId: 'n3', name: 'zeta.ts.net' }),
    rawDevice({ nodeId: 'n1', name: 'alpha.ts.net' }),
    rawDevice({ nodeId: 'n2', name: 'shared.other.ts.net', isExternal: true }),
  ];
  assert.deepEqual(
    normalizeMachines(devices, { now: NOW }).map((m) => m.name),
    ['alpha', 'zeta'],
  );
  assert.deepEqual(
    normalizeMachines(devices, { includeExternal: true, now: NOW }).map((m) => m.name),
    ['alpha', 'shared', 'zeta'],
  );
});

test('a machine waiting for approval or with an update needs attention', () => {
  assert.equal(needsAttention(normalizeMachine(rawDevice(), NOW), 14), false);
  assert.equal(needsAttention(normalizeMachine(rawDevice({ authorized: false }), NOW), 14), true);
  assert.equal(
    needsAttention(normalizeMachine(rawDevice({ updateAvailable: true }), NOW), 14),
    true,
  );
});
