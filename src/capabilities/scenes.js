// -----------------------------------------------------------------------------
// Scene triggers and actions (Gladys 5.1+).
//
// Triggers say what HAPPENED on the tailnet, one event per transition (see
// src/tailscale/tailnet.js for how transitions are measured):
//
//   connection_changed  a machine went online or offline. Its `online` feature
//                       already drives the standard "device state" trigger;
//                       this one also covers "ANY machine", and hands the scene
//                       its name and address.
//   machine_added       a machine joined the tailnet — the one a security-minded
//                       admin wants a notification for, authorized or not.
//   update_available    a newer Tailscale client exists for a machine.
//   key_expiring        a machine's node key entered the warning window: renew
//                       it (or turn its expiry off) before it drops off.
//
// Actions are operations a scene runs:
//
//   refresh_tailnet     read the tailnet now; outputs the counts.
//   get_machine_status  read one machine; outputs its state, for the following
//                       actions and conditions of the scene.
//   set_key_expiry      turn a machine's key expiry off, or back on.
//
// Two rules from the core: an event never fires as the consequence of an
// action (a scene would loop through the integration), and publishing an event
// must never fail the refresh it came from.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { CHANGES } from '../tailscale/tailnet.js';
import { machineIds } from '../devices/machine.js';

const logger = createLogger({ name: 'scenes' });

/** Keys of the manifest `scene_triggers`. Never renamed: scenes store them. */
export const SCENE_TRIGGERS = {
  CONNECTION_CHANGED: 'connection_changed',
  MACHINE_ADDED: 'machine_added',
  UPDATE_AVAILABLE: 'update_available',
  KEY_EXPIRING: 'key_expiring',
};

/** Keys of the manifest `scene_actions`. Same rule. */
export const SCENE_ACTIONS = {
  REFRESH_TAILNET: 'refresh_tailnet',
  GET_MACHINE_STATUS: 'get_machine_status',
  SET_KEY_EXPIRY: 'set_key_expiry',
};

/** Values of the `state` filter of `connection_changed`. */
export const CONNECTION_STATES = { ONLINE: 'online', OFFLINE: 'offline' };

/** Values of the `authorization` filter of `machine_added`. */
export const AUTHORIZATIONS = { AUTHORIZED: 'authorized', PENDING: 'pending' };

/**
 * The scene event of one change, as `{ key, data }`. `data` is flat and only
 * carries the keys the manifest declares (fields and variables).
 */
export function sceneEventOf(gladys, { kind, machine }) {
  const device = machineIds(gladys, machine.nodeId).device;
  switch (kind) {
    case CHANGES.ONLINE:
    case CHANGES.OFFLINE:
      return {
        key: SCENE_TRIGGERS.CONNECTION_CHANGED,
        data: {
          device,
          device_name: machine.name,
          state: kind === CHANGES.ONLINE ? CONNECTION_STATES.ONLINE : CONNECTION_STATES.OFFLINE,
          ip: machine.ipv4 ?? '',
          last_seen: isoOrEmpty(machine.lastSeen),
        },
      };
    case CHANGES.ADDED:
      return {
        key: SCENE_TRIGGERS.MACHINE_ADDED,
        data: {
          device,
          device_name: machine.name,
          authorization: machine.authorized ? AUTHORIZATIONS.AUTHORIZED : AUTHORIZATIONS.PENDING,
          os: machine.os,
          user: machine.user,
          ip: machine.ipv4 ?? '',
        },
      };
    case CHANGES.UPDATE_AVAILABLE:
      return {
        key: SCENE_TRIGGERS.UPDATE_AVAILABLE,
        data: { device, device_name: machine.name, client_version: machine.clientVersion },
      };
    case CHANGES.KEY_EXPIRING:
      return {
        key: SCENE_TRIGGERS.KEY_EXPIRING,
        data: {
          device,
          device_name: machine.name,
          days_left: machine.keyExpiryDays ?? 0,
          expires: isoOrEmpty(machine.expires),
        },
      };
    default:
      return null;
  }
}

/**
 * Fire the scene events of a refresh. Never throws: a Gladys too old for scene
 * triggers answers 404, a burst 429, and neither may cost the refresh.
 *
 * @returns {Promise<number>} how many events Gladys accepted
 */
export async function publishSceneEvents(gladys, changes) {
  let published = 0;
  for (const change of changes) {
    const event = sceneEventOf(gladys, change);
    if (!event) {
      continue;
    }
    try {
      await gladys.publishSceneEvent(event.key, event.data);
      published += 1;
      logger.info(`Scene event ${event.key} for ${change.machine.name}`);
    } catch (err) {
      logger.warn(`Could not publish the scene event ${event.key}: ${err.message}`);
    }
  }
  return published;
}

/**
 * The scene action handlers, keyed by action key.
 *
 * @param {object} app see src/app.js: `refreshNow`, `machineOf`, `setKeyExpiry`
 */
export function sceneActionHandlers(app) {
  return {
    async [SCENE_ACTIONS.REFRESH_TAILNET]() {
      const { summary } = await app.refreshNow();
      return {
        machine_count: summary.total,
        online_count: summary.online,
        offline_count: summary.offline,
      };
    },

    async [SCENE_ACTIONS.GET_MACHINE_STATUS](fields) {
      const machine = await app.machineOf(fields.device, { fresh: true });
      return {
        name: machine.name,
        online: machine.online,
        ip: machine.ipv4 ?? '',
        last_seen: isoOrEmpty(machine.lastSeen),
        os: machine.os,
        client_version: machine.clientVersion,
        update_available: machine.updateAvailable,
        key_expiry_disabled: machine.keyExpiryDisabled,
        // -1 when the key never expires: a scene condition can still compare it.
        key_expiry_days: machine.keyExpiryDays ?? -1,
      };
    },

    async [SCENE_ACTIONS.SET_KEY_EXPIRY](fields) {
      const disabled = fields.disabled !== false && fields.disabled !== 'false';
      const machine = await app.setKeyExpiry(fields.device, disabled);
      return { key_expiry_disabled: machine.keyExpiryDisabled };
    },
  };
}

function isoOrEmpty(timestamp) {
  return timestamp === null || timestamp === undefined ? '' : new Date(timestamp).toISOString();
}
