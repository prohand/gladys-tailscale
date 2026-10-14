# Tailscale

Cette intégration connecte Gladys à votre réseau **Tailscale** (votre
« tailnet ») : chaque machine du tailnet — un serveur, un NAS, un téléphone,
un routeur de sous-réseau — devient un appareil Gladys qui indique si elle est
en ligne, si une mise à jour de Tailscale l'attend et quand sa clé expire.

Elle lit le tailnet via l'**API Tailscale, dans le cloud**
(`api.tailscale.com`). Rien à installer sur vos machines, et Gladys n'a pas
besoin d'être lui-même sur le tailnet.

Nécessite Gladys 5.1 ou plus récent.

## Avant de commencer

Il faut être **administrateur** du tailnet (rôle Owner, Admin ou IT admin)
pour créer les identifiants ci-dessous.

L'intégration se connecte avec l'un de ces deux moyens :

| Méthode           | Où le créer                                                                  | Expiration          |
| ----------------- | ---------------------------------------------------------------------------- | ------------------- |
| Jeton d'accès API | [Settings → Keys](https://login.tailscale.com/admin/settings/keys)           | après 1 à 90 jours  |
| Client OAuth      | [Settings → OAuth clients](https://login.tailscale.com/admin/settings/oauth) | jamais (recommandé) |

### Jeton d'accès API

1. Ouvrez [Settings → Keys](https://login.tailscale.com/admin/settings/keys)
   dans la console d'administration Tailscale.
2. Sous **API access tokens**, cliquez sur **Generate access token**, donnez
   une description (« Gladys ») et une durée de validité.
3. Copiez le jeton (`tskey-api-…`) : Tailscale ne l'affiche qu'une fois.

Quand le jeton expire, l'intégration affiche « Tailscale refuse les
identifiants » et les appareils passent **injoignables** : générez-en un
nouveau et collez-le dans la configuration.

### Client OAuth (recommandé)

Un client OAuth n'expire jamais, et vous choisissez précisément ce qu'il peut
faire.

1. Ouvrez [Settings → OAuth clients](https://login.tailscale.com/admin/settings/oauth).
2. Cliquez sur **Generate OAuth client**.
3. Cochez le droit **Devices → Core** :
   - **Read** suffit pour surveiller les machines ;
   - **Write** est aussi nécessaire pour activer ou désactiver l'expiration de
     la clé d'une machine depuis Gladys.
4. Copiez le **Client ID** et le **Client secret** (`tskey-client-…`) : le
   secret n'est affiché qu'une fois.

## Configuration

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. Choisissez la **Méthode de connexion** et remplissez ses champs :
   - jeton d'accès API : collez-le dans **Jeton d'accès API** ;
   - client OAuth : collez **ID du client OAuth** et **Secret du client OAuth**.
3. **Tailnet** : laissez `-`, le tailnet des identifiants. Ne le changez que si
   votre jeton peut atteindre plusieurs tailnets : mettez l'ID du tailnet
   affiché dans **Settings → General** de la console d'administration.
4. **Intervalle de rafraîchissement** : fréquence de lecture du tailnet, toutes
   les 60 secondes par défaut (30 secondes minimum). Chaque lecture est une
   seule requête, quel que soit le nombre de machines.
5. **Alerte d'expiration des clés** : combien de jours avant l'expiration d'une
   clé la machine est signalée (14 par défaut).
6. **Inclure les machines partagées avec vous** : les machines qu'un autre
   tailnet partage avec le vôtre sont masquées par défaut, puisque vous ne les
   gérez pas.
7. Enregistrez, puis cliquez sur **Tester la connexion** : le message indique
   combien de machines l'intégration voit.
8. Ouvrez l'onglet **Découverte** et ajoutez les machines à suivre.

## Ce que vous obtenez

Chaque machine devient un appareil avec quatre fonctionnalités :

| Fonctionnalité                 | Signification                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| En ligne (Online)              | La machine est connectée au tailnet en ce moment                                           |
| Mise à jour (Update available) | Une version plus récente de Tailscale existe pour cette machine                            |
| Expiration (Key expiry)        | Jours restants avant l'expiration de sa clé (pas mis à jour quand l'expiration est coupée) |
| Expiration désactivée          | L'interrupteur du menu **Disable key expiry** de la console — vous pouvez le changer       |

Activer **Key expiry disabled** depuis Gladys revient à cliquer sur **Disable
key expiry** dans la console d'administration : la machine n'aura plus jamais
à se reconnecter. Il faut un jeton d'accès API, ou un client OAuth avec le
droit **Devices → Core : Write**.

Chaque appareil porte un badge **cloud** tant que l'API Tailscale répond, et
**injoignable** sinon : les valeurs affichées sont alors les dernières lues.

Les machines sont reconnues par leur identifiant Tailscale : renommer une
machine dans la console garde son appareil et son historique dans Gladys.

## Scènes

L'intégration ajoute ses propres cartes à l'éditeur de scènes, dans la
catégorie **Intégrations**.

### Déclencheurs

- **Machine en ligne ou hors ligne** — une machine s'est connectée au tailnet
  ou s'en est déconnectée. Choisissez si besoin la machine et le nouvel état ;
  laissés vides, toute machine et tout changement conviennent. Variables :
  `device_name`, `state` (`online` ou `offline`), `ip`, `last_seen`.
- **Nouvelle machine dans le tailnet** — une machine a rejoint le tailnet.
  Filtrez sur **Approbation** pour n'être prévenu que des machines en attente
  d'approbation (si l'approbation des appareils est activée). Variables :
  `device_name`, `authorization` (`authorized` ou `pending`), `os`, `user`,
  `ip`.
- **Mise à jour Tailscale disponible** — une version plus récente de
  Tailscale est disponible pour une machine. Variables : `device_name`,
  `client_version`.
- **Clé bientôt expirée** — la clé d'une machine entre dans le délai d'alerte
  de la configuration. Variables : `device_name`, `days_left`, `expires`.

Les actions suivantes de la scène lisent une variable sous la forme
`{{triggerEvent.data.device_name}}`.

Chaque déclencheur se produit **une fois par changement**, quand l'intégration
le remarque (à l'intervalle de rafraîchissement). Le démarrage de
l'intégration ne déclenche rien : elle prend d'abord note du tailnet tel qu'il
est.

Exemple : _quand une machine passe hors ligne, m'envoyer le message
« {{triggerEvent.data.device_name}} est hors ligne »_.

### Actions

- **Actualiser le tailnet** — lit toutes les machines maintenant. Renvoie
  `machine_count`, `online_count` et `offline_count`.
- **Lire l'état d'une machine** — renvoie `name`, `online`, `ip`,
  `last_seen`, `os`, `client_version`, `update_available`,
  `key_expiry_disabled` et `key_expiry_days` (`-1` quand la clé n'expire
  jamais), pour les conditions et messages qui suivent.
- **Modifier l'expiration de la clé** — désactive l'expiration de la clé d'une
  machine, ou la réactive. Renvoie `key_expiry_disabled`.

## Tableau de bord

Ajoutez le widget **Réseau Tailscale** à un tableau de bord. Il affiche :

- le nombre de machines en ligne et hors ligne ;
- si l'API répond, la dernière lecture du tailnet, le nombre de machines avec
  une mise à jour en attente, une clé qui expire bientôt ou en attente
  d'approbation ;
- une liste de machines, avec un badge pour le problème le plus urgent.
  Touchez une machine pour voir ses adresses, son propriétaire, ses tags et la
  date d'expiration de sa clé, avec un lien vers sa page dans la console.

Réglages de chaque widget :

- **Machines listées** : celles à traiter (par défaut), seulement celles hors
  ligne, ou toutes ;
- **Lignes** : nombre de machines affichées (0 à 8).

Le bouton **Actualiser** lit le tailnet tout de suite ; **Console d'admin**
ouvre la console d'administration Tailscale.

## Dépannage

| Message                                                | Que faire                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Aucun identifiant Tailscale                            | Remplissez les champs de la méthode de connexion choisie                              |
| Tailscale refuse les identifiants                      | Le jeton a expiré ou a été révoqué, ou le client OAuth est faux : créez-en un nouveau |
| Accès refusé : il manque au jeton le droit « devices » | Donnez au client OAuth le droit **Devices → Core**                                    |
| Tailnet introuvable                                    | Remettez `-` dans **Tailnet**, ou l'ID exact de **Settings → General**                |
| Tailscale limite les requêtes                          | Augmentez l'intervalle de rafraîchissement                                            |
| L'API Tailscale est injoignable depuis Gladys          | Vérifiez l'accès internet de la machine Gladys (`api.tailscale.com`, HTTPS)           |

Une machine apparaît **hors ligne** alors qu'elle fonctionne ? Elle est hors
ligne pour Tailscale : le client est arrêté, déconnecté, ou sa clé a expiré.
La console d'administration affiche la même chose.

L'intégration journalise tout ce qu'elle fait : ouvrez les logs de
l'intégration dans Gladys. Elle n'écrit jamais un jeton ni un secret dans les
logs.
