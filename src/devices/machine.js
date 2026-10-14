// -----------------------------------------------------------------------------
// Device type: one Tailscale MACHINE.
//
// Every machine of the tailnet (a server, a phone, a subnet router…) becomes a
// Gladys device, keyed on its Tailscale `nodeId`: renaming the machine in the
// admin console renames nothing here, and its history stays attached.
//
// Features (their keys are stored by Gladys: never renamed):
//   online               connected to the tailnet right now (read-only)
//   update_available     a newer Tailscale client exists for it (read-only)
//   key_expiry_days      days left before its node key expires (read-only)
//   key_expiry_disabled  key expiry turned off — the one thing Gladys can
//                        change, as in the "Disable key expiry" menu of the
//                        admin console
//
// The machines are refreshed by the integration's own timer (one API call for
// the whole tailnet, see src/app.js), not by Gladys polling each device.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

export const DEVICE_TYPE = 'machine';

export const FEATURES = {
  ONLINE: 'online',
  UPDATE_AVAILABLE: 'update_available',
  KEY_EXPIRY_DAYS: 'key_expiry_days',
  KEY_EXPIRY_DISABLED: 'key_expiry_disabled',
};

/** Node keys last 180 days at most: the bound of the "days left" feature. */
export const MAX_KEY_EXPIRY_DAYS = 365;

/** The external ids of one machine. */
export function machineIds(gladys, nodeId) {
  return gladys.externalIds(DEVICE_TYPE, nodeId);
}

/** The node id carried by a device external id, null when it is not a machine. */
export function nodeIdOf(gladys, externalId) {
  const prefix = machineIds(gladys, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const nodeId = externalId.slice(prefix.length).split(':')[0];
  return nodeId || null;
}

/** The discovery payload of one machine. */
export function buildMachineDevice(gladys, machine) {
  const ids = machineIds(gladys, machine.nodeId);
  return {
    name: machine.name,
    external_id: ids.device,
    // Refreshed by the integration's timer: Gladys has nothing to poll.
    should_poll: false,
    features: [
      {
        name: 'Online',
        external_id: ids.feature(FEATURES.ONLINE),
        category: DEVICE_FEATURE_CATEGORIES.PRESENCE_SENSOR,
        type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
        read_only: true,
        has_feedback: false,
        keep_history: true,
        min: 0,
        max: 1,
      },
      {
        name: 'Update available',
        external_id: ids.feature(FEATURES.UPDATE_AVAILABLE),
        category: DEVICE_FEATURE_CATEGORIES.UNKNOWN,
        type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
        read_only: true,
        has_feedback: false,
        keep_history: true,
        min: 0,
        max: 1,
      },
      {
        name: 'Key expiry',
        external_id: ids.feature(FEATURES.KEY_EXPIRY_DAYS),
        category: DEVICE_FEATURE_CATEGORIES.DURATION,
        type: DEVICE_FEATURE_TYPES.DURATION.INTEGER,
        unit: DEVICE_FEATURE_UNITS.DAYS,
        read_only: true,
        has_feedback: false,
        keep_history: true,
        min: 0,
        max: MAX_KEY_EXPIRY_DAYS,
      },
      {
        name: 'Key expiry disabled',
        external_id: ids.feature(FEATURES.KEY_EXPIRY_DISABLED),
        category: DEVICE_FEATURE_CATEGORIES.SWITCH,
        type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
        read_only: false,
        has_feedback: true,
        keep_history: true,
        min: 0,
        max: 1,
      },
    ],
  };
}

/**
 * The states of one machine, in the publishStates format. The days left are
 * left out while the expiry is off: there is no date to count down to, and the
 * `key_expiry_disabled` feature already says why.
 */
export function machineStates(gladys, machine) {
  const ids = machineIds(gladys, machine.nodeId);
  const states = [
    { device_feature_external_id: ids.feature(FEATURES.ONLINE), state: machine.online ? 1 : 0 },
    {
      device_feature_external_id: ids.feature(FEATURES.UPDATE_AVAILABLE),
      state: machine.updateAvailable ? 1 : 0,
    },
    {
      device_feature_external_id: ids.feature(FEATURES.KEY_EXPIRY_DISABLED),
      state: machine.keyExpiryDisabled ? 1 : 0,
    },
  ];
  if (machine.keyExpiryDays !== null) {
    states.push({
      device_feature_external_id: ids.feature(FEATURES.KEY_EXPIRY_DAYS),
      state: Math.min(MAX_KEY_EXPIRY_DAYS, machine.keyExpiryDays),
    });
  }
  return states;
}

/** The feature key of a feature external id (`…:machine:<nodeId>:<key>`). */
export function featureKeyOf(externalId) {
  return String(externalId).split(':').pop();
}
