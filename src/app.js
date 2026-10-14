// -----------------------------------------------------------------------------
// The integration, wired to the SDK.
//
// Everything Gladys can ask for is registered here, on the client it is given
// (the real one in index.js, the SDK's fake Gladys in the tests):
//
//   - the configuration, read on every (re)connection and on every save;
//   - one timer reading the whole tailnet every `poll_frequency` seconds (one
//     API call, whatever the number of machines), then publishing what moved:
//     the machine list (Discovery tab), the states of the machines created in
//     Gladys, the transport badge, the connection status, the scene events and
//     a widget nudge;
//   - the "Test the connection" button, the key-expiry switch, the scene
//     actions and the dashboard widget.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { missingCredentials, normalizeConfig } from './config.js';
import { localize, pick } from './i18n.js';
import { createTailscaleClient } from './tailscale/client.js';
import { Tailnet } from './tailscale/tailnet.js';
import {
  FEATURES,
  buildMachineDevice,
  featureKeyOf,
  machineIds,
  machineStates,
  nodeIdOf,
} from './devices/machine.js';
import { SCENE_ACTIONS, publishSceneEvents, sceneActionHandlers } from './capabilities/scenes.js';
import {
  TAILNET_WIDGET,
  WIDGET_ACTIONS,
  buildTailnetWidget,
  errorMessage,
  refreshToast,
} from './capabilities/widget.js';

const logger = createLogger({ name: 'tailscale' });

/** Keys of the manifest `actions`. Never renamed. */
export const ACTIONS = { TEST_CONNECTION: 'test_connection' };

/** A scene asking for one machine reuses a snapshot younger than this. */
export const FRESH_ENOUGH_MS = 30_000;

/** The settings that change which machines the integration sees. */
const WATCHED_KEYS = [
  'auth_method',
  'api_key',
  'oauth_client_id',
  'oauth_client_secret',
  'tailnet',
  'include_external',
];

/** An unchanged state is re-sent this often, so it stays recently dated in Gladys. */
const STATE_HEARTBEAT_MS = 30 * 60 * 1000;

/**
 * Register every handler on `gladys`.
 *
 * @param {object} gladys a GladysIntegration (or the SDK's fake one)
 * @param {object} [options] injected by the tests
 * @param {typeof fetch} [options.fetch]
 * @param {() => number} [options.now]
 * @param {{ setInterval: Function, clearInterval: Function }} [options.timers]
 */
export function createTailscaleApp(gladys, options = {}) {
  const {
    fetch = globalThis.fetch,
    now = () => Date.now(),
    timers = { setInterval, clearInterval },
  } = options;

  let config = normalizeConfig();
  let client = createTailscaleClient({ config, fetch, now });
  const tailnet = new Tailnet({ now });
  let timer = null;
  // One refresh at a time: the timer, a button and a scene share the queue.
  let queue = Promise.resolve();
  // What was last told to Gladys, so only changes are sent again.
  const published = { devices: null, transports: null, status: null, widget: null };

  // --- Configuration ---------------------------------------------------------

  function applyConfig(raw) {
    const previous = config;
    config = normalizeConfig(raw);
    client = createTailscaleClient({ config, fetch, now });
    // Other credentials may see another tailnet, and the shared machines may
    // just have been shown: none of those machines is "new". A mere
    // reconnection to Gladys keeps the baseline, so what changed meanwhile is
    // still announced.
    if (WATCHED_KEYS.some((key) => previous[key] !== config[key])) {
      tailnet.baseline = null;
    }
    published.devices = null;
    published.status = null;
  }

  // --- Refresh ---------------------------------------------------------------

  /**
   * Read the tailnet and publish what changed. Queued behind any refresh in
   * progress. Scene events only fire from the timer (`detectChanges`).
   * @returns {Promise<{ machines: Array<object>, summary: object }>}
   */
  function refresh({ detectChanges = false } = {}) {
    const run = queue.then(() => runRefresh({ detectChanges }));
    queue = run.catch(() => {});
    return run;
  }

  async function runRefresh({ detectChanges }) {
    if (missingCredentials(config)) {
      await reportStatus(false, errorMessage({ kind: 'not_configured' }));
      nudgeWidget();
      const err = new Error('No Tailscale credentials configured');
      err.kind = 'not_configured';
      throw err;
    }
    let changes;
    try {
      ({ changes } = await tailnet.refresh(client, config, { detectChanges }));
    } catch (err) {
      logger.warn(`Refresh failed: ${err.message}`);
      await publishTransports().catch((e) => logger.error('publishTransports failed', e));
      await reportStatus(false, errorMessage(err));
      nudgeWidget();
      throw err;
    }
    logger.debug(`Refresh: ${tailnet.machines.length} machines`);
    await publishDevices();
    await publishStates();
    await publishTransports();
    await reportStatus(true);
    if (changes.length > 0) {
      await publishSceneEvents(gladys, changes);
    }
    nudgeWidget();
    return { machines: tailnet.machines, summary: tailnet.summary(config.key_expiry_warning_days) };
  }

  /** The timer's refresh: errors are already reported, never thrown. */
  async function periodicRefresh() {
    try {
      await refresh({ detectChanges: true });
    } catch {
      // Reported through the connection status, the badge and the widget.
    }
  }

  function startTimer() {
    stopTimer();
    timer = timers.setInterval(periodicRefresh, config.poll_frequency * 1000);
  }

  function stopTimer() {
    if (timer !== null) {
      timers.clearInterval(timer);
      timer = null;
    }
  }

  // --- Publication -----------------------------------------------------------

  /** The machine list of the Discovery tab, sent again only when it changed. */
  async function publishDevices({ force = false } = {}) {
    const devices = tailnet.machines.map((machine) => buildMachineDevice(gladys, machine));
    const signature = JSON.stringify(devices.map((device) => [device.external_id, device.name]));
    if (!force && signature === published.devices) {
      return;
    }
    await gladys.publishDiscoveredDevices(devices);
    published.devices = signature;
  }

  /** The machines the user created in Gladys: the only ones whose states count. */
  function createdMachines() {
    const created = new Set((gladys.devices ?? []).map((device) => device.external_id));
    return tailnet.machines.filter((machine) =>
      created.has(machineIds(gladys, machine.nodeId).device),
    );
  }

  async function publishStates(machines = createdMachines()) {
    const states = machines.flatMap((machine) => machineStates(gladys, machine));
    if (states.length > 0) {
      await gladys.publishChangedStates(states, { heartbeat: STATE_HEARTBEAT_MS });
    }
  }

  /**
   * The badge of every created machine: `cloud` while the API answers,
   * `unreachable` when it does not — the data shown is then out of date.
   */
  async function publishTransports({ force = false } = {}) {
    const transport = tailnet.error ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.CLOUD;
    const entries = createdMachines().map((machine) => ({
      external_id: machineIds(gladys, machine.nodeId).device,
      transport,
    }));
    const signature = JSON.stringify(entries);
    if (entries.length === 0 || (!force && signature === published.transports)) {
      return;
    }
    await gladys.publishTransports(entries);
    published.transports = signature;
  }

  async function reportStatus(connected, message) {
    const signature = JSON.stringify([connected, message ?? null]);
    if (signature === published.status) {
      return;
    }
    try {
      await (message === undefined
        ? gladys.setConnectionStatus(connected)
        : gladys.setConnectionStatus(connected, message));
      published.status = signature;
    } catch (err) {
      logger.error('setConnectionStatus failed', err);
    }
  }

  /** Ask open dashboards to re-pull the widget, when what it shows changed. */
  function nudgeWidget() {
    const signature = JSON.stringify([
      tailnet.error?.kind ?? null,
      tailnet.machines.map((machine) => [
        machine.nodeId,
        machine.online,
        machine.updateAvailable,
        machine.keyExpiryDays,
        machine.keyExpiryDisabled,
        machine.authorized,
      ]),
    ]);
    if (signature === published.widget) {
      return;
    }
    published.widget = signature;
    gladys.requestWidgetRefresh(TAILNET_WIDGET);
  }

  // --- Operations shared by the buttons, the switch and the scenes -----------

  async function refreshNow() {
    return refresh({ detectChanges: false });
  }

  /** The machine behind a Gladys device external id, refreshed when asked. */
  async function machineOf(externalId, { fresh = false } = {}) {
    const nodeId = nodeIdOf(gladys, externalId);
    if (!nodeId) {
      throw new Error(`Not a Tailscale machine: ${externalId}`);
    }
    const stale = tailnet.refreshedAt === null || now() - tailnet.refreshedAt > FRESH_ENOUGH_MS;
    if (stale && (fresh || !tailnet.find(nodeId))) {
      await refreshNow();
    }
    const machine = tailnet.find(nodeId);
    if (!machine) {
      throw new Error(`Machine ${nodeId} is not in the tailnet any more`);
    }
    return machine;
  }

  async function setKeyExpiry(externalId, disabled) {
    const nodeId = nodeIdOf(gladys, externalId);
    if (!nodeId) {
      throw new Error(`Not a Tailscale machine: ${externalId}`);
    }
    logger.info(`Key expiry of ${nodeId} -> ${disabled ? 'disabled' : 'enabled'}`);
    await client.setKeyExpiryDisabled(nodeId, disabled);
    // Shown at once; the expiry date that comes back with it is only known
    // after the next read, done in the background so the command acks fast.
    tailnet.patch(
      nodeId,
      disabled
        ? { keyExpiryDisabled: true, expires: null, keyExpiryDays: null, keyExpired: false }
        : { keyExpiryDisabled: false },
    );
    const machine = tailnet.find(nodeId) ?? {
      nodeId,
      online: false,
      updateAvailable: false,
      keyExpiryDisabled: disabled,
      keyExpiryDays: null,
    };
    await publishStates([machine]);
    refreshNow().catch((err) => logger.debug(`Refresh after the key change: ${err.message}`));
    return machine;
  }

  async function testConnection() {
    try {
      const { summary } = await refreshNow();
      await publishDevices({ force: true });
      return localize((language) =>
        pick(language, {
          en: `Connected to the tailnet: ${summary.total} machines, ${summary.online} online. Add them from the Discovery tab.`,
          fr: `Connecté au tailnet : ${summary.total} machines, dont ${summary.online} en ligne. Ajoutez-les depuis l'onglet Découverte.`,
          de: `Mit dem Tailnet verbunden: ${summary.total} Geräte, ${summary.online} online. Füge sie im Tab „Entdecken“ hinzu.`,
          es: `Conectado a la tailnet: ${summary.total} máquinas, ${summary.online} en línea. Añádalas desde la pestaña Descubrimiento.`,
        }),
      );
    } catch (err) {
      return errorMessage(err);
    }
  }

  // --- Handlers ----------------------------------------------------------------

  gladys.onScanRequest(async () => {
    try {
      await refreshNow();
    } catch {
      // Reported already: publish the machines known so far.
    }
    await publishDevices({ force: true });
  });

  gladys.onSetValue(async (device, feature, value) => {
    if (featureKeyOf(feature.external_id) !== FEATURES.KEY_EXPIRY_DISABLED) {
      throw new Error(`Feature ${feature.external_id} is read-only`);
    }
    await setKeyExpiry(device.external_id, Number(value) === 1);
  });

  gladys.onDeviceCreated(async (device) => {
    // The SDK forgot the states of the new device: send them now rather than
    // at the next refresh, and give it its badge.
    const machine = tailnet.find(nodeIdOf(gladys, device.external_id));
    if (machine) {
      await publishStates([machine]);
      await publishTransports({ force: true });
    }
  });

  gladys.onAction(ACTIONS.TEST_CONNECTION, () => testConnection());

  const sceneHandlers = sceneActionHandlers({ refreshNow, machineOf, setKeyExpiry });
  for (const key of Object.values(SCENE_ACTIONS)) {
    gladys.onSceneAction(key, (fields) => sceneHandlers[key](fields ?? {}));
  }

  gladys.onWidgetGet(TAILNET_WIDGET, async ({ settings } = {}) =>
    buildTailnetWidget({ config, tailnet, settings, now: now() }),
  );
  gladys.onWidgetAction(TAILNET_WIDGET, async (actionKey) => {
    if (actionKey !== WIDGET_ACTIONS.REFRESH) {
      throw new Error(`Unknown widget action: ${actionKey}`);
    }
    try {
      const { summary } = await refreshNow();
      return refreshToast(summary);
    } catch (err) {
      // Throwing acks the action as failed: the message reaches the user.
      throw new Error(errorMessage(err).en, { cause: err });
    }
  });

  gladys.onConfigUpdated(async (newConfig) => {
    logger.info('Configuration updated');
    applyConfig(newConfig);
    startTimer();
    await periodicRefresh();
  });

  gladys.on('connected', async () => {
    try {
      applyConfig(await gladys.getConfig());
      // The badge and the device list are re-sent on every (re)connection:
      // Gladys may have restarted in between.
      published.transports = null;
      startTimer();
      await periodicRefresh();
    } catch (err) {
      logger.error('Post-connection initialization failed', err);
      await reportStatus(false, {
        en: 'Initialization failed, check the integration logs.',
        fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
        de: 'Die Initialisierung ist fehlgeschlagen, sieh in den Protokollen nach.',
        es: 'La inicialización falló, revise los registros de la integración.',
      });
    }
  });

  gladys.on('disconnected', () => stopTimer());

  return {
    get config() {
      return config;
    },
    tailnet,
    refresh,
    periodicRefresh,
    stop: stopTimer,
  };
}
