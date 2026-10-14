// -----------------------------------------------------------------------------
// The tailnet as the integration last saw it, and what changed since.
//
// One API call reads every machine; the snapshot it gives feeds the devices,
// the widget and the scene actions. The CHANGES feed the scene triggers, and
// they are measured against a separate baseline that only the periodic refresh
// moves forward:
//   - the first periodic refresh only sets the baseline: a restart must not
//     announce every machine of the tailnet as "new" or "went online";
//   - a refresh asked by a scene action, a widget button or the "Test the
//     connection" button updates the snapshot but fires nothing, so a scene
//     can never trigger itself through the integration — and the transition
//     it saw first is still announced by the next periodic refresh.
// -----------------------------------------------------------------------------

import { keyExpiresSoon, normalizeMachines } from './machines.js';

/** The kinds of change a refresh can report, one scene trigger each. */
export const CHANGES = {
  ONLINE: 'online',
  OFFLINE: 'offline',
  ADDED: 'added',
  UPDATE_AVAILABLE: 'update_available',
  KEY_EXPIRING: 'key_expiring',
};

export class Tailnet {
  /**
   * @param {object} options
   * @param {() => number} [options.now] clock
   */
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    /** @type {Array<object>} latest machines, sorted by name */
    this.machines = [];
    /** When the snapshot was last read successfully (ms), null before. */
    this.refreshedAt = null;
    /** The error of the last refresh, null when it succeeded. */
    this.error = null;
    /** @type {Map<string, object>|null} what the scene triggers compare to */
    this.baseline = null;
  }

  /**
   * Read the machine list and compute what changed.
   *
   * @param {object} client see createTailscaleClient
   * @param {object} config normalized configuration
   * @param {object} [options]
   * @param {boolean} [options.detectChanges] true for the periodic refresh only
   * @returns {Promise<{ machines: Array<object>, changes: Array<object> }>}
   * @throws {Error} the API error, also kept in `this.error`
   */
  async refresh(client, config, { detectChanges = false } = {}) {
    let devices;
    try {
      devices = await client.listDevices();
    } catch (err) {
      this.error = err;
      throw err;
    }
    const now = this.now();
    const machines = normalizeMachines(devices, {
      includeExternal: config.include_external,
      now,
    });
    this.machines = machines;
    this.refreshedAt = now;
    this.error = null;

    let changes = [];
    if (detectChanges) {
      if (this.baseline) {
        changes = diffMachines(this.baseline, machines, config.key_expiry_warning_days);
      }
      this.baseline = new Map(machines.map((machine) => [machine.nodeId, machine]));
    }
    return { machines, changes };
  }

  /** The machine of a node id, undefined when unknown. */
  find(nodeId) {
    return this.machines.find((machine) => machine.nodeId === nodeId);
  }

  /** Apply a change Gladys just made, until the next refresh confirms it. */
  patch(nodeId, values) {
    this.machines = this.machines.map((machine) =>
      machine.nodeId === nodeId ? { ...machine, ...values } : machine,
    );
  }

  /** Counts for the widget and the scene actions. */
  summary(warningDays) {
    const online = this.machines.filter((machine) => machine.online).length;
    return {
      total: this.machines.length,
      online,
      offline: this.machines.length - online,
      updates: this.machines.filter((machine) => machine.updateAvailable).length,
      expiring: this.machines.filter((machine) => keyExpiresSoon(machine, warningDays)).length,
      pending: this.machines.filter((machine) => !machine.authorized).length,
    };
  }
}

/**
 * The transitions between two snapshots, one entry per machine and kind.
 *
 * @param {Map<string, object>} before machines by node id
 * @param {Array<object>} after
 * @param {number} warningDays see `key_expiry_warning_days`
 */
export function diffMachines(before, after, warningDays) {
  const changes = [];
  for (const machine of after) {
    const previous = before.get(machine.nodeId);
    if (!previous) {
      changes.push({ kind: CHANGES.ADDED, machine });
      continue;
    }
    if (machine.online !== previous.online) {
      changes.push({ kind: machine.online ? CHANGES.ONLINE : CHANGES.OFFLINE, machine });
    }
    if (machine.updateAvailable && !previous.updateAvailable) {
      changes.push({ kind: CHANGES.UPDATE_AVAILABLE, machine });
    }
    // Entering the window, once: a key renewed then expiring again re-enters it.
    if (keyExpiresSoon(machine, warningDays) && !keyExpiresSoon(previous, warningDays)) {
      changes.push({ kind: CHANGES.KEY_EXPIRING, machine });
    }
  }
  return changes;
}
