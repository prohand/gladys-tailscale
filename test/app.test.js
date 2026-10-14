// -----------------------------------------------------------------------------
// The whole integration against the SDK's fake Gladys and a fake Tailscale API.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { ACTIONS, createTailscaleApp } from '../src/app.js';
import { SCENE_ACTIONS, SCENE_TRIGGERS } from '../src/capabilities/scenes.js';
import { TAILNET_WIDGET, WIDGET_ACTIONS } from '../src/capabilities/widget.js';
import { API_KEY, createFakeTailscale, rawDevice } from './helpers/fakeTailscale.js';

const NOW = Date.parse('2026-10-14T12:00:00Z');
const DEVICE = 'ext:test-integration:machine:nAbC1CNTRL';
const feature = (key) => `${DEVICE}:${key}`;

function createdDevice(externalId = DEVICE) {
  return { name: 'server', external_id: externalId, features: [] };
}

async function start({ config = { api_key: API_KEY }, devices, created = [createdDevice()] } = {}) {
  const api = createFakeTailscale({ devices });
  const gladys = createFakeGladys({ config, devices: created });
  const timers = {
    intervals: [],
    setInterval(fn, ms) {
      this.intervals.push({ fn, ms });
      return this.intervals.length;
    },
    clearInterval() {},
  };
  const app = createTailscaleApp(gladys, { fetch: api.fetch, now: () => NOW, timers });
  await gladys.connect();
  return { api, gladys, app, timers };
}

test('on connection the machines are listed, and the created ones get their states', async () => {
  const { gladys, timers } = await start({
    devices: [rawDevice(), rawDevice({ nodeId: 'nOther', name: 'nas.tail1234.ts.net' })],
  });

  assert.deepEqual(
    gladys.fake.discoveredDevices.map((device) => device.name),
    ['nas', 'server'],
  );
  assert.equal(gladys.fake.lastState(feature('online')), 1);
  assert.equal(gladys.fake.lastState(feature('update_available')), 0);
  assert.equal(gladys.fake.lastState(feature('key_expiry_disabled')), 0);
  assert.equal(gladys.fake.lastState(feature('key_expiry_days')), 78);
  assert.equal(
    gladys.fake.lastState('ext:test-integration:machine:nOther:online'),
    undefined,
    'a machine not created in Gladys publishes no state',
  );
  assert.deepEqual(gladys.fake.transports, [{ device_external_id: DEVICE, transport: 'cloud' }]);
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  assert.deepEqual(
    timers.intervals.map((interval) => interval.ms),
    [60_000],
  );
  assert.deepEqual(gladys.fake.sceneEvents, [], 'a restart announces nothing');
});

test('the timer publishes what changed and fires the scene triggers', async () => {
  const { api, gladys, app } = await start();

  api.state.devices = [
    rawDevice({ connectedToControl: false, updateAvailable: true }),
    rawDevice({ nodeId: 'nNew', name: 'phone.tail1234.ts.net', authorized: false, os: 'iOS' }),
  ];
  await app.periodicRefresh();

  assert.equal(gladys.fake.lastState(feature('online')), 0);
  assert.equal(gladys.fake.lastState(feature('update_available')), 1);
  assert.deepEqual(gladys.fake.sceneEvents, [
    // Machines in name order: "phone" before "server".
    {
      key: SCENE_TRIGGERS.MACHINE_ADDED,
      data: {
        device: 'ext:test-integration:machine:nNew',
        device_name: 'phone',
        authorization: 'pending',
        os: 'iOS',
        user: 'admin@example.com',
        ip: '100.101.102.103',
      },
    },
    {
      key: SCENE_TRIGGERS.CONNECTION_CHANGED,
      data: {
        device: DEVICE,
        device_name: 'server',
        state: 'offline',
        ip: '100.101.102.103',
        last_seen: '2026-10-14T11:59:00.000Z',
      },
    },
    {
      key: SCENE_TRIGGERS.UPDATE_AVAILABLE,
      data: { device: DEVICE, device_name: 'server', client_version: '1.76.1' },
    },
  ]);
  assert.ok(gladys.fake.widgetRefreshes.includes(TAILNET_WIDGET));
});

test('an unchanged tailnet sends nothing again', async () => {
  const { gladys, app } = await start();
  const requests = gladys.fake.requests.length;

  await app.periodicRefresh();

  assert.equal(gladys.fake.requests.length, requests);
});

test('an API failure turns the badge unreachable and says why', async () => {
  const { api, gladys, app } = await start();

  api.state.failWith = 401;
  await app.periodicRefresh();

  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: DEVICE,
    transport: 'unreachable',
  });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refused the credentials/);
  assert.ok(gladys.fake.connectionStatus.message.de);
  assert.ok(gladys.fake.connectionStatus.message.es);

  api.state.failWith = null;
  await app.periodicRefresh();
  assert.equal(gladys.fake.transports.at(-1).transport, 'cloud');
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
});

test('without credentials nothing is called and the status says what is missing', async () => {
  const { api, gladys } = await start({ config: {} });

  assert.equal(api.state.requests.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /No Tailscale credentials/);
});

test('"Test the connection" reports the machines in every language', async () => {
  const { gladys } = await start();

  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);

  assert.equal(ack.success, true);
  assert.match(ack.data.message.en, /1 machines, 1 online/);
  assert.match(ack.data.message.fr, /Découverte/);
  assert.ok(ack.data.message.de && ack.data.message.es);
});

test('"Test the connection" explains a refused token instead of failing', async () => {
  const { api, gladys } = await start();
  api.state.failWith = 403;

  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);

  assert.equal(ack.success, true);
  assert.match(ack.data.message.en, /devices/);
});

test('the key expiry switch calls the API and publishes the new state', async () => {
  const { api, gladys } = await start();
  const [device] = gladys.fake.discoveredDevices;
  const switchFeature = device.features.find(
    (f) => f.external_id === feature('key_expiry_disabled'),
  );

  const ack = await gladys.fake.setValue(device, switchFeature, 1);

  assert.deepEqual(ack, { success: true });
  assert.equal(api.state.devices[0].keyExpiryDisabled, true);
  assert.equal(gladys.fake.lastState(feature('key_expiry_disabled')), 1);
});

test('the read-only features refuse a command', async () => {
  const { gladys } = await start();
  const [device] = gladys.fake.discoveredDevices;
  const online = device.features.find((f) => f.external_id === feature('online'));

  const ack = await gladys.fake.setValue(device, online, 0);

  assert.equal(ack.success, false);
  assert.match(ack.error, /read-only/);
});

test('scene actions return their declared outputs', async () => {
  const { api, gladys } = await start();

  const refreshed = await gladys.fake.sceneAction(SCENE_ACTIONS.REFRESH_TAILNET, {});
  assert.deepEqual(refreshed.data.outputs, { machine_count: 1, online_count: 1, offline_count: 0 });

  const status = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_MACHINE_STATUS, {
    device: DEVICE,
  });
  assert.deepEqual(status.data.outputs, {
    name: 'server',
    online: true,
    ip: '100.101.102.103',
    last_seen: '2026-10-14T11:59:00.000Z',
    os: 'linux',
    client_version: '1.76.1',
    update_available: false,
    key_expiry_disabled: false,
    key_expiry_days: 78,
  });

  const changed = await gladys.fake.sceneAction(SCENE_ACTIONS.SET_KEY_EXPIRY, {
    device: DEVICE,
    disabled: true,
  });
  assert.deepEqual(changed.data.outputs, { key_expiry_disabled: true });
  assert.equal(api.state.devices[0].keyExpiryDisabled, true);
  assert.deepEqual(gladys.fake.sceneEvents, [], 'an action never fires a trigger');
});

test('a scene action on an unknown machine fails that action only', async () => {
  const { gladys } = await start();

  const ack = await gladys.fake.sceneAction(SCENE_ACTIONS.GET_MACHINE_STATUS, {
    device: 'ext:test-integration:machine:gone',
  });

  assert.equal(ack.success, false);
  assert.match(ack.error, /not in the tailnet/);
});

test('the widget renders exactly as sent, and its button refreshes', async () => {
  const { gladys } = await start({
    devices: [
      rawDevice(),
      rawDevice({ nodeId: 'n2', name: 'nas.ts.net', connectedToControl: false }),
    ],
  });

  for (const filter of ['attention', 'offline', 'all']) {
    for (const language of ['en', 'fr', 'de', 'es']) {
      const ack = await gladys.fake.widgetGet(TAILNET_WIDGET, { settings: { filter }, language });
      assert.equal(ack.success, true);
      assert.deepEqual(validateWidgetContent(ack.data.content), [], `${filter}/${language}`);
    }
  }

  const tap = await gladys.fake.widgetAction(TAILNET_WIDGET, WIDGET_ACTIONS.REFRESH, {});
  assert.equal(tap.success, true);
  assert.match(tap.data.message.en, /1 of 2 machines online/);
});

test('a machine created in Gladys gets its states at once', async () => {
  const { gladys } = await start({ created: [] });
  assert.equal(gladys.fake.lastState(feature('online')), undefined);

  await gladys.fake.deviceCreated(createdDevice());

  assert.equal(gladys.fake.lastState(feature('online')), 1);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: DEVICE,
    transport: 'cloud',
  });
});

test('a change made while Gladys was unreachable is announced on reconnection', async () => {
  const { api, gladys } = await start();

  await gladys.disconnect();
  api.state.devices = [rawDevice({ connectedToControl: false })];
  await gladys.connect();

  assert.deepEqual(
    gladys.fake.sceneEvents.map((event) => [event.key, event.data.state]),
    [[SCENE_TRIGGERS.CONNECTION_CHANGED, 'offline']],
  );
});

test('a saved configuration restarts the timer at the new interval', async () => {
  const { gladys, timers } = await start();

  await gladys.fake.configUpdated({ api_key: API_KEY, poll_frequency: 300 });

  assert.equal(timers.intervals.at(-1).ms, 300_000);
  assert.deepEqual(gladys.fake.sceneEvents, [], 'new credentials do not announce every machine');
});

test('other credentials do not announce the machines they see as new', async () => {
  const { api, gladys } = await start();

  api.state.devices = [rawDevice(), rawDevice({ nodeId: 'nElse', name: 'other.ts.net' })];
  await gladys.fake.configUpdated({ api_key: API_KEY, tailnet: 'example.com' });

  assert.deepEqual(gladys.fake.sceneEvents, []);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
});
