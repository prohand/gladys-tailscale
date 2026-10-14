import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { createTailscaleClient } from '../src/tailscale/client.js';
import { CHANGES, Tailnet } from '../src/tailscale/tailnet.js';
import { API_KEY, createFakeTailscale, rawDevice } from './helpers/fakeTailscale.js';

const NOW = Date.parse('2026-10-14T12:00:00Z');
const config = normalizeConfig({ api_key: API_KEY });

function setup(devices) {
  const api = createFakeTailscale({ devices });
  const client = createTailscaleClient({ config, fetch: api.fetch });
  const tailnet = new Tailnet({ now: () => NOW });
  return { api, client, tailnet };
}

test('the first periodic refresh only sets the baseline', async () => {
  const { client, tailnet } = setup([rawDevice()]);

  const { machines, changes } = await tailnet.refresh(client, config, { detectChanges: true });

  assert.equal(machines.length, 1);
  assert.deepEqual(changes, []);
  assert.equal(tailnet.refreshedAt, NOW);
});

test('each transition is reported once, against the previous periodic refresh', async () => {
  const { api, client, tailnet } = setup([rawDevice()]);
  await tailnet.refresh(client, config, { detectChanges: true });

  api.state.devices = [
    rawDevice({
      connectedToControl: false,
      updateAvailable: true,
      expires: '2026-10-20T00:00:00Z',
    }),
    rawDevice({ nodeId: 'nNew', name: 'laptop.tail1234.ts.net', authorized: false }),
  ];
  const { changes } = await tailnet.refresh(client, config, { detectChanges: true });

  assert.deepEqual(
    changes.map((change) => [change.kind, change.machine.nodeId]),
    [
      // Machines in name order: "laptop" before "server".
      [CHANGES.ADDED, 'nNew'],
      [CHANGES.OFFLINE, 'nAbC1CNTRL'],
      [CHANGES.UPDATE_AVAILABLE, 'nAbC1CNTRL'],
      [CHANGES.KEY_EXPIRING, 'nAbC1CNTRL'],
    ],
  );

  const again = await tailnet.refresh(client, config, { detectChanges: true });
  assert.deepEqual(again.changes, [], 'nothing new the second time');
});

test('an on-demand refresh fires nothing and keeps the transition for the timer', async () => {
  const { api, client, tailnet } = setup([rawDevice()]);
  await tailnet.refresh(client, config, { detectChanges: true });

  api.state.devices = [rawDevice({ connectedToControl: false })];
  const onDemand = await tailnet.refresh(client, config);
  assert.deepEqual(onDemand.changes, []);
  assert.equal(tailnet.machines[0].online, false, 'the snapshot is up to date');

  const periodic = await tailnet.refresh(client, config, { detectChanges: true });
  assert.deepEqual(
    periodic.changes.map((change) => change.kind),
    [CHANGES.OFFLINE],
  );
});

test('a failed refresh keeps the last snapshot and remembers the error', async () => {
  const { api, client, tailnet } = setup([rawDevice()]);
  await tailnet.refresh(client, config);

  api.state.failWith = 500;
  await assert.rejects(tailnet.refresh(client, config));

  assert.equal(tailnet.machines.length, 1);
  assert.equal(tailnet.error.status, 500);
});

test('the summary counts what the widget shows', async () => {
  const { client, tailnet } = setup([
    rawDevice(),
    rawDevice({ nodeId: 'n2', connectedToControl: false, updateAvailable: true }),
    rawDevice({ nodeId: 'n3', authorized: false, expires: '2026-10-16T00:00:00Z' }),
  ]);
  await tailnet.refresh(client, config);

  assert.deepEqual(tailnet.summary(14), {
    total: 3,
    online: 2,
    offline: 1,
    updates: 1,
    expiring: 1,
    pending: 1,
  });
});
