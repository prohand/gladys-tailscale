# Tailscale

Diese Integration verbindet Gladys mit deinem **Tailscale**-Netz (deinem
„Tailnet“): Jedes Gerät des Tailnets — ein Server, ein NAS, ein Handy, ein
Subnet-Router — wird zu einem Gladys-Gerät, das zeigt, ob es online ist, ob
ein Tailscale-Update wartet und wann sein Schlüssel abläuft.

Sie liest das Tailnet über die **Tailscale-API in der Cloud**
(`api.tailscale.com`). Auf deinen Geräten muss nichts installiert werden, und
Gladys selbst muss nicht im Tailnet sein.

Erfordert Gladys 5.3 oder neuer.

## Bevor du beginnst

Du musst **Administrator** des Tailnets sein (Rolle Owner, Admin oder IT
admin), um die folgenden Zugangsdaten zu erstellen.

Die Integration meldet sich mit einer dieser Methoden an:

| Methode           | Wo erstellen                                                                 | Ablauf              |
| ----------------- | ---------------------------------------------------------------------------- | ------------------- |
| API-Zugriffstoken | [Settings → Keys](https://login.tailscale.com/admin/settings/keys)           | nach 1 bis 90 Tagen |
| OAuth-Client      | [Settings → OAuth clients](https://login.tailscale.com/admin/settings/oauth) | nie (empfohlen)     |

### API-Zugriffstoken

1. Öffne [Settings → Keys](https://login.tailscale.com/admin/settings/keys) in
   der Tailscale-Admin-Konsole.
2. Klicke unter **API access tokens** auf **Generate access token**, gib eine
   Beschreibung („Gladys“) und eine Gültigkeitsdauer an.
3. Kopiere das Token (`tskey-api-…`): Tailscale zeigt es nur einmal an.

Wenn das Token abläuft, zeigt die Integration „Tailscale lehnt die
Zugangsdaten ab“ und die Geräte werden **nicht erreichbar**: Erstelle ein
neues und füge es in der Konfiguration ein.

### OAuth-Client (empfohlen)

Ein OAuth-Client läuft nie ab, und du legst genau fest, was er darf.

1. Öffne [Settings → OAuth clients](https://login.tailscale.com/admin/settings/oauth).
2. Klicke auf **Generate OAuth client**.
3. Aktiviere den Bereich **Devices → Core**:
   - **Read** reicht, um die Geräte zu überwachen;
   - **Write** wird zusätzlich gebraucht, um den Schlüsselablauf eines Geräts
     aus Gladys ein- oder auszuschalten.
4. Kopiere die **Client ID** und das **Client secret** (`tskey-client-…`): Das
   Secret wird nur einmal angezeigt.

## Konfiguration

1. Öffne den Tab **Konfiguration** der Integration.
2. Wähle die **Anmeldemethode** und fülle ihre Felder aus:
   - API-Zugriffstoken: Füge es in **API-Zugriffstoken** ein;
   - OAuth-Client: Füge **Client-ID des OAuth-Clients** und **Secret des
     OAuth-Clients** ein.
3. **Tailnet**: Lass `-` stehen, das Tailnet der Zugangsdaten. Ändere es nur,
   wenn dein Token mehrere Tailnets erreicht: Trage die Tailnet-ID aus
   **Settings → General** der Admin-Konsole ein.
4. **Aktualisierungsintervall**: Wie oft das Tailnet gelesen wird, standardmäßig
   alle 60 Sekunden (mindestens 30 Sekunden). Jede Abfrage ist eine einzige
   Anfrage, egal wie viele Geräte es gibt.
5. **Warnung vor Schlüsselablauf**: Wie viele Tage vor dem Ablauf eines
   Schlüssels das Gerät markiert wird (standardmäßig 14).
6. **Mit dir geteilte Geräte einbeziehen**: Geräte, die ein anderes Tailnet
   mit deinem teilt, sind standardmäßig ausgeblendet, da du sie nicht
   verwaltest.
7. Speichere und klicke dann auf **Verbindung testen**: Die Meldung sagt, wie
   viele Geräte die Integration sieht.
8. Öffne den Tab **Entdecken** und füge die Geräte hinzu, die du verfolgen
   möchtest.

## Was du bekommst

Jedes Gerät wird zu einem Gladys-Gerät mit vier Funktionen:

| Funktion            | Bedeutung                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Online              | Das Gerät ist gerade mit dem Tailnet verbunden                                                  |
| Update available    | Für dieses Gerät gibt es eine neuere Tailscale-Version                                          |
| Key expiry          | Verbleibende Tage bis zum Ablauf seines Schlüssels (nicht aktualisiert, solange er nie abläuft) |
| Key expiry disabled | Der Schalter des Menüs **Disable key expiry** der Admin-Konsole — du kannst ihn ändern          |

**Key expiry disabled** in Gladys einzuschalten entspricht **Disable key
expiry** in der Admin-Konsole: Das Gerät muss sich nie wieder anmelden. Dafür
braucht es ein API-Zugriffstoken oder einen OAuth-Client mit dem Bereich
**Devices → Core: Write**.

Jedes Gerät trägt ein **Cloud**-Abzeichen, solange die Tailscale-API
antwortet, und **nicht erreichbar**, wenn nicht: Die angezeigten Werte sind
dann die zuletzt gelesenen.

Die Geräte werden über ihre Tailscale-ID erkannt: Ein in der Admin-Konsole
umbenanntes Gerät behält sein Gladys-Gerät und seinen Verlauf.

## Szenen

Die Integration fügt dem Szenen-Editor eigene Karten in der Kategorie
**Integrationen** hinzu.

### Auslöser

- **Gerät online oder offline** — ein Gerät hat sich mit dem Tailnet verbunden
  oder getrennt. Wähle bei Bedarf das Gerät und den neuen Zustand; leer
  gelassen passt jedes Gerät und jede Änderung. Variablen: `device_name`,
  `state` (`online` oder `offline`), `ip`, `last_seen`.
- **Neues Gerät im Tailnet** — ein Gerät ist dem Tailnet beigetreten. Filtere
  nach **Freigabe**, um nur über Geräte informiert zu werden, die auf Freigabe
  warten (wenn die Gerätefreigabe aktiv ist). Variablen: `device_name`,
  `authorization` (`authorized` oder `pending`), `os`, `user`, `ip`.
- **Tailscale-Update verfügbar** — für ein Gerät ist eine neuere
  Tailscale-Version verfügbar. Variablen: `device_name`, `client_version`.
- **Schlüssel läuft bald ab** — der Schlüssel eines Geräts tritt in die
  Warnfrist der Konfiguration ein. Variablen: `device_name`, `days_left`,
  `expires`.

Die folgenden Aktionen der Szene lesen eine Variable als
`{{triggerEvent.data.device_name}}`.

Jeder Auslöser feuert **einmal pro Änderung**, sobald die Integration sie
bemerkt (im Aktualisierungsintervall). Der Start der Integration löst nichts
aus: Sie nimmt zuerst den aktuellen Zustand des Tailnets auf.

Beispiel: _Wenn ein Gerät offline geht, schicke mir die Nachricht
„{{triggerEvent.data.device_name}} ist offline“_.

### Aktionen

- **Tailnet aktualisieren** — liest sofort alle Geräte. Gibt `machine_count`,
  `online_count` und `offline_count` zurück.
- **Gerätestatus lesen** — gibt `name`, `online`, `ip`, `last_seen`, `os`,
  `client_version`, `update_available`, `key_expiry_disabled` und
  `key_expiry_days` (`-1`, wenn der Schlüssel nie abläuft) für die folgenden
  Bedingungen und Nachrichten zurück.
- **Schlüsselablauf ändern** — schaltet den Schlüsselablauf eines Geräts aus
  oder wieder ein. Gibt `key_expiry_disabled` zurück.

## Dashboard

Füge das Widget **Tailscale-Netz** zu einem Dashboard hinzu. Es zeigt:

- wie viele Geräte online und offline sind;
- ob die API antwortet, wann das Tailnet zuletzt gelesen wurde, wie viele
  Geräte ein wartendes Update, einen bald ablaufenden Schlüssel haben oder auf
  Freigabe warten;
- eine Geräteliste mit einem Abzeichen für das dringendste Problem. Tippe auf
  ein Gerät, um Adressen, Besitzer, Tags und Ablaufdatum des Schlüssels zu
  sehen, mit einem Link zu seiner Seite in der Admin-Konsole.

Einstellungen jedes Widgets:

- **Angezeigte Geräte**: die Aufmerksamkeit brauchen (Standard), nur die
  offline sind, oder alle;
- **Zeilen**: wie viele Geräte die Liste zeigt (0 bis 8).

Die Schaltfläche **Aktualisieren** liest das Tailnet sofort; **Admin-Konsole**
öffnet die Tailscale-Admin-Konsole.

## Fehlerbehebung

| Meldung                                                   | Was tun                                                                                        |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Keine Tailscale-Zugangsdaten                              | Fülle die Felder der gewählten Anmeldemethode aus                                              |
| Tailscale lehnt die Zugangsdaten ab                       | Das Token ist abgelaufen oder widerrufen, oder der OAuth-Client ist falsch: Erstelle ein neues |
| Zugriff verweigert: Dem Token fehlt der Bereich „devices“ | Gib dem OAuth-Client den Bereich **Devices → Core**                                            |
| Tailnet nicht gefunden                                    | Trage wieder `-` in **Tailnet** ein oder die genaue ID aus **Settings → General**              |
| Tailscale begrenzt die Anfragen                           | Erhöhe das Aktualisierungsintervall                                                            |
| Die Tailscale-API ist von Gladys aus nicht erreichbar     | Prüfe den Internetzugang des Gladys-Rechners (`api.tailscale.com`, HTTPS)                      |

Ein Gerät wird **offline** angezeigt, obwohl es läuft? Für Tailscale ist es
offline: Der Client ist gestoppt, abgemeldet oder sein Schlüssel ist
abgelaufen. Die Admin-Konsole zeigt dasselbe.

Die Integration protokolliert alles, was sie tut: Öffne die Protokolle der
Integration in Gladys. Sie schreibt nie ein Token oder ein Secret ins
Protokoll.
