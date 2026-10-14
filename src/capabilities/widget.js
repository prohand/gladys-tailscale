// -----------------------------------------------------------------------------
// Dashboard widget (Gladys 5.1+): the tailnet, at a glance.
//
// Is the API reachable, how many machines are online, which ones need the
// administrator (offline, waiting for approval, an update to install, a key
// about to expire) — and a button to read the tailnet again now.
//
// The content is declarative (the core renders it, no HTML): see the
// "Dashboard widgets" section of the SDK README for the vocabulary and the
// budget — at most 1 status list, 6 tiles, 1 focal component and 4 buttons.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { missingCredentials } from '../config.js';
import { localize, pick } from '../i18n.js';
import { API_ERRORS } from '../tailscale/client.js';
import { keyExpiresSoon, needsAttention } from '../tailscale/machines.js';

/** Key of the manifest widget. Never renamed: dashboards store it. */
export const TAILNET_WIDGET = 'tailnet';

/** The widget button actions. */
export const WIDGET_ACTIONS = { REFRESH: 'refresh' };

/** Values of the `filter` setting: which machines the list shows. */
export const WIDGET_FILTERS = { ATTENTION: 'attention', OFFLINE: 'offline', ALL: 'all' };

/** Rows of the list when the instance says nothing; the list holds 8 at most. */
export const DEFAULT_ROWS = 6;
const MAX_ROWS = 8;

export const ADMIN_CONSOLE_URL = 'https://login.tailscale.com/admin/machines';

/**
 * The content of the `tailnet` widget.
 *
 * @param {object} state
 * @param {object} state.config normalized configuration
 * @param {object} state.tailnet see src/tailscale/tailnet.js
 * @param {object} [state.settings] the instance settings of the widget
 * @param {number} [state.now] clock
 */
export function buildTailnetWidget({ config, tailnet, settings = {}, now = Date.now() }) {
  const components = [];
  const warningDays = config.key_expiry_warning_days;
  const summary = tailnet.summary(warningDays);

  const notice = setupNotice(config, tailnet);
  if (notice) {
    components.push({ type: 'text', variant: 'caption', text: notice });
  }

  components.push(
    {
      type: 'value',
      value: summary.online,
      label: { en: 'Online', fr: 'En ligne', de: 'Online', es: 'En línea' },
      icon: 'wifi',
      color: summary.online > 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      value: summary.offline,
      label: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
      icon: 'wifi-off',
      color: summary.offline > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    },
  );

  components.push({
    type: 'status',
    items: [
      apiItem(config, tailnet),
      lastRefreshItem(tailnet, now),
      {
        label: {
          en: 'Updates available',
          fr: 'Mises à jour disponibles',
          de: 'Updates verfügbar',
          es: 'Actualizaciones disponibles',
        },
        icon: 'download',
        value: summary.updates,
        color: summary.updates > 0 ? WIDGET_COLORS.INFO : WIDGET_COLORS.NEUTRAL,
      },
      {
        label: {
          en: `Keys expiring (${warningDays} d)`,
          fr: `Clés expirant (${warningDays} j)`,
          de: `Ablaufende Schlüssel (${warningDays} T)`,
          es: `Claves que caducan (${warningDays} d)`,
        },
        icon: 'key',
        value: summary.expiring,
        color: summary.expiring > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
      },
      ...(summary.pending > 0
        ? [
            {
              label: {
                en: 'Waiting for approval',
                fr: "En attente d'approbation",
                de: 'Warten auf Freigabe',
                es: 'Pendientes de aprobación',
              },
              icon: 'user-check',
              value: summary.pending,
              color: WIDGET_COLORS.DANGER,
            },
          ]
        : []),
    ],
  });

  const rows = rowsShown(settings);
  const shown = machinesShown(tailnet.machines, settings, warningDays).slice(0, rows);
  if (shown.length > 0) {
    components.push({
      type: 'card-list',
      display: 'list',
      items: shown.map((machine) => machineItem(machine, warningDays, now)),
    });
  } else if (tailnet.refreshedAt !== null && rows > 0) {
    components.push({
      type: 'text',
      variant: 'caption',
      text: {
        en: 'Nothing needs your attention.',
        fr: 'Rien ne demande votre attention.',
        de: 'Nichts braucht deine Aufmerksamkeit.',
        es: 'Nada requiere su atención.',
      },
    });
  }

  components.push(
    {
      type: 'button',
      label: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
      icon: 'refresh-cw',
      style: 'primary',
      action: { key: WIDGET_ACTIONS.REFRESH },
    },
    {
      type: 'button',
      label: {
        en: 'Admin console',
        fr: "Console d'admin",
        de: 'Admin-Konsole',
        es: 'Consola de admin',
      },
      icon: 'external-link',
      style: 'secondary',
      link: { url: ADMIN_CONSOLE_URL },
    },
  );

  return { ttl_seconds: 60, components };
}

/** The toast of the Refresh button. */
export function refreshToast(summary) {
  return localize((language) =>
    pick(language, {
      en: `${summary.online} of ${summary.total} machines online.`,
      fr: `${summary.online} machines en ligne sur ${summary.total}.`,
      de: `${summary.online} von ${summary.total} Geräten online.`,
      es: `${summary.online} de ${summary.total} máquinas en línea.`,
    }),
  );
}

/** What is missing before anything can work, or null when nothing is. */
function setupNotice(config, tailnet) {
  const missing = missingCredentials(config);
  if (missing === 'missing_api_key') {
    return {
      en: 'Paste a Tailscale API access token in the configuration.',
      fr: "Collez un jeton d'accès API Tailscale dans la configuration.",
      de: 'Füge in der Konfiguration ein Tailscale-API-Zugriffstoken ein.',
      es: 'Pegue un token de acceso API de Tailscale en la configuración.',
    };
  }
  if (missing === 'missing_oauth_client') {
    return {
      en: 'Fill in the OAuth client ID and secret in the configuration.',
      fr: "Renseignez l'ID et le secret du client OAuth dans la configuration.",
      de: 'Trage Client-ID und Secret des OAuth-Clients in der Konfiguration ein.',
      es: 'Complete el ID y el secreto del cliente OAuth en la configuración.',
    };
  }
  if (tailnet.error) {
    return errorMessage(tailnet.error);
  }
  return null;
}

/**
 * One sentence per API failure, for the widget, the connection status and the
 * "Test the connection" button alike.
 */
export function errorMessage(err) {
  switch (err?.kind) {
    case API_ERRORS.NOT_CONFIGURED:
      return {
        en: 'No Tailscale credentials: fill in the configuration.',
        fr: 'Aucun identifiant Tailscale : complétez la configuration.',
        de: 'Keine Tailscale-Zugangsdaten: Vervollständige die Konfiguration.',
        es: 'Sin credenciales de Tailscale: complete la configuración.',
      };
    case API_ERRORS.AUTH:
      return {
        en: 'Tailscale refused the credentials: the token may have expired.',
        fr: 'Tailscale refuse les identifiants : le jeton a peut-être expiré.',
        de: 'Tailscale lehnt die Zugangsdaten ab: Das Token ist evtl. abgelaufen.',
        es: 'Tailscale rechaza las credenciales: el token puede haber caducado.',
      };
    case API_ERRORS.FORBIDDEN:
      return {
        en: 'Access denied: the token lacks the "devices" scope.',
        fr: 'Accès refusé : il manque au jeton le droit « devices ».',
        de: 'Zugriff verweigert: Dem Token fehlt der Bereich „devices“.',
        es: 'Acceso denegado: al token le falta el permiso «devices».',
      };
    case API_ERRORS.NOT_FOUND:
      return {
        en: 'Tailnet not found: check its name, or leave "-".',
        fr: 'Tailnet introuvable : vérifiez son nom, ou laissez « - ».',
        de: 'Tailnet nicht gefunden: Prüfe den Namen oder lass „-“ stehen.',
        es: 'Tailnet no encontrada: revise su nombre o deje «-».',
      };
    case API_ERRORS.RATE_LIMITED:
      return {
        en: 'Tailscale limits the requests: raise the refresh interval.',
        fr: "Tailscale limite les requêtes : augmentez l'intervalle.",
        de: 'Tailscale begrenzt die Anfragen: Erhöhe das Intervall.',
        es: 'Tailscale limita las peticiones: aumente el intervalo.',
      };
    case API_ERRORS.NETWORK:
      return {
        en: 'The Tailscale API cannot be reached from Gladys.',
        fr: "L'API Tailscale est injoignable depuis Gladys.",
        de: 'Die Tailscale-API ist von Gladys aus nicht erreichbar.',
        es: 'La API de Tailscale no es accesible desde Gladys.',
      };
    default:
      return {
        en: 'The Tailscale API answered with an error: see the logs.',
        fr: "L'API Tailscale a répondu par une erreur : voir les logs.",
        de: 'Die Tailscale-API meldet einen Fehler: siehe Protokolle.',
        es: 'La API de Tailscale respondió con un error: vea los registros.',
      };
  }
}

function apiItem(config, tailnet) {
  const label = {
    en: 'Tailscale API',
    fr: 'API Tailscale',
    de: 'Tailscale-API',
    es: 'API Tailscale',
  };
  if (missingCredentials(config)) {
    return {
      label,
      icon: 'cloud',
      value: {
        en: 'not configured',
        fr: 'non configurée',
        de: 'nicht konfiguriert',
        es: 'sin configurar',
      },
      color: WIDGET_COLORS.WARNING,
    };
  }
  if (tailnet.error) {
    return {
      label,
      icon: 'cloud-off',
      value: { en: 'error', fr: 'erreur', de: 'Fehler', es: 'error' },
      color: WIDGET_COLORS.DANGER,
    };
  }
  if (tailnet.refreshedAt === null) {
    return {
      label,
      icon: 'cloud',
      value: { en: 'waiting', fr: 'en attente', de: 'wartet', es: 'en espera' },
      color: WIDGET_COLORS.NEUTRAL,
    };
  }
  return {
    label,
    icon: 'cloud',
    value: { en: 'connected', fr: 'connectée', de: 'verbunden', es: 'conectada' },
    color: WIDGET_COLORS.SUCCESS,
  };
}

function lastRefreshItem(tailnet, now) {
  const label = {
    en: 'Last refresh',
    fr: 'Dernière lecture',
    de: 'Letzte Abfrage',
    es: 'Última lectura',
  };
  if (tailnet.refreshedAt === null) {
    return {
      label,
      icon: 'clock',
      value: { en: 'never', fr: 'jamais', de: 'nie', es: 'nunca' },
      color: WIDGET_COLORS.NEUTRAL,
    };
  }
  return {
    label,
    icon: 'clock',
    value: localize((language) => describeAgo(now - tailnet.refreshedAt, language)),
    color: tailnet.error ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
  };
}

/** One machine, as a row of the list. */
function machineItem(machine, warningDays, now) {
  const details = [machine.ipv4, machine.os, machine.clientVersion && `v${machine.clientVersion}`]
    .filter(Boolean)
    .join(' · ');
  return {
    title: clip(machine.name, 60),
    subtitle: details || undefined,
    date: machine.lastSeen === null ? undefined : new Date(machine.lastSeen).toISOString(),
    badge: badgeOf(machine, warningDays),
    description: localize((language) => clip(describeMachine(machine, now, language), 2000)),
    links: machine.ipv4
      ? [
          {
            url: `${ADMIN_CONSOLE_URL}/${machine.ipv4}`,
            label: {
              en: 'Admin console',
              fr: "Console d'admin",
              de: 'Admin-Konsole',
              es: 'Consola de admin',
            },
          },
        ]
      : undefined,
  };
}

/** The most pressing state of a machine, as a short colored badge. */
function badgeOf(machine, warningDays) {
  if (!machine.authorized) {
    return {
      text: { en: 'to approve', fr: 'à approuver', de: 'freigeben', es: 'por aprobar' },
      color: WIDGET_COLORS.DANGER,
    };
  }
  if (machine.keyExpired) {
    return {
      text: { en: 'key expired', fr: 'clé expirée', de: 'abgelaufen', es: 'clave caducada' },
      color: WIDGET_COLORS.DANGER,
    };
  }
  if (!machine.online) {
    return {
      text: { en: 'offline', fr: 'hors ligne', de: 'offline', es: 'sin conexión' },
      color: WIDGET_COLORS.WARNING,
    };
  }
  if (keyExpiresSoon(machine, warningDays)) {
    return {
      text: {
        en: `key: ${machine.keyExpiryDays} d`,
        fr: `clé : ${machine.keyExpiryDays} j`,
        de: `Schlüssel: ${machine.keyExpiryDays} T`,
        es: `clave: ${machine.keyExpiryDays} d`,
      },
      color: WIDGET_COLORS.WARNING,
    };
  }
  if (machine.updateAvailable) {
    return {
      text: { en: 'update', fr: 'mise à jour', de: 'Update', es: 'actualizar' },
      color: WIDGET_COLORS.INFO,
    };
  }
  return {
    text: { en: 'online', fr: 'en ligne', de: 'online', es: 'en línea' },
    color: WIDGET_COLORS.SUCCESS,
  };
}

/** The detail panel of a machine, in one language. */
function describeMachine(machine, now, language) {
  const lines = [];
  const ago = (lang) => describeAgo(machine.lastSeen === null ? NaN : now - machine.lastSeen, lang);
  lines.push(
    machine.online
      ? pick(language, {
          en: 'Connected to the tailnet.',
          fr: 'Connectée au tailnet.',
          de: 'Mit dem Tailnet verbunden.',
          es: 'Conectada a la tailnet.',
        })
      : pick(language, {
          en: `Offline, last seen ${ago('en')}.`,
          fr: `Hors ligne, vue pour la dernière fois ${ago('fr')}.`,
          de: `Offline, zuletzt gesehen ${ago('de')}.`,
          es: `Sin conexión, vista por última vez ${ago('es')}.`,
        }),
  );
  if (machine.fqdn) {
    lines.push(machine.fqdn);
  }
  if (machine.addresses.length > 0) {
    lines.push(machine.addresses.join(', '));
  }
  if (machine.user) {
    lines.push(
      `${pick(language, { en: 'Owner', fr: 'Propriétaire', de: 'Besitzer', es: 'Propietario' })}: ${machine.user}`,
    );
  }
  if (machine.tags.length > 0) {
    lines.push(`Tags: ${machine.tags.join(', ')}`);
  }
  if (machine.keyExpiryDisabled) {
    lines.push(
      pick(language, {
        en: 'Key expiry disabled.',
        fr: 'Expiration de la clé désactivée.',
        de: 'Schlüsselablauf deaktiviert.',
        es: 'Caducidad de la clave desactivada.',
      }),
    );
  } else if (machine.expires !== null) {
    const date = new Date(machine.expires).toISOString().slice(0, 10);
    lines.push(
      pick(language, {
        en: `Key expires on ${date} (${machine.keyExpiryDays} days).`,
        fr: `La clé expire le ${date} (${machine.keyExpiryDays} jours).`,
        de: `Der Schlüssel läuft am ${date} ab (${machine.keyExpiryDays} Tage).`,
        es: `La clave caduca el ${date} (${machine.keyExpiryDays} días).`,
      }),
    );
  }
  if (machine.updateAvailable) {
    lines.push(
      pick(language, {
        en: 'A newer Tailscale version is available.',
        fr: 'Une version plus récente de Tailscale est disponible.',
        de: 'Eine neuere Tailscale-Version ist verfügbar.',
        es: 'Hay una versión más reciente de Tailscale.',
      }),
    );
  }
  return lines.join('\n');
}

/** "3 min ago", in one language. */
export function describeAgo(elapsedMs, language) {
  if (!Number.isFinite(elapsedMs)) {
    return pick(language, { en: 'unknown', fr: 'inconnu', de: 'unbekannt', es: 'desconocido' });
  }
  const minutes = Math.max(0, Math.floor(elapsedMs / 60_000));
  if (minutes < 1) {
    return pick(language, {
      en: 'just now',
      fr: "à l'instant",
      de: 'gerade eben',
      es: 'ahora mismo',
    });
  }
  if (minutes < 60) {
    return pick(language, {
      en: `${minutes} min ago`,
      fr: `il y a ${minutes} min`,
      de: `vor ${minutes} Min.`,
      es: `hace ${minutes} min`,
    });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return pick(language, {
      en: `${hours} h ago`,
      fr: `il y a ${hours} h`,
      de: `vor ${hours} Std.`,
      es: `hace ${hours} h`,
    });
  }
  const days = Math.floor(hours / 24);
  return pick(language, {
    en: `${days} days ago`,
    fr: `il y a ${days} jours`,
    de: `vor ${days} Tagen`,
    es: `hace ${days} días`,
  });
}

function machinesShown(machines, settings, warningDays) {
  switch (settings?.filter) {
    case WIDGET_FILTERS.ALL:
      return machines;
    case WIDGET_FILTERS.OFFLINE:
      return machines.filter((machine) => !machine.online);
    default:
      return machines.filter((machine) => needsAttention(machine, warningDays));
  }
}

function rowsShown(settings) {
  const raw = settings?.rows;
  if (raw === undefined || raw === null || raw === '') {
    return DEFAULT_ROWS;
  }
  const number = Math.trunc(Number(raw));
  return Number.isFinite(number) ? Math.max(0, Math.min(MAX_ROWS, number)) : DEFAULT_ROWS;
}

function clip(text, length) {
  const value = String(text);
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}
