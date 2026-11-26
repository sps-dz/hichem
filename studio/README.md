# Plateforme studio — version gratuite (forfait Firebase Spark)

Site de réservation du studio, séparé du CRM, sur le projet Firebase
**sponsorhichem**. Il tourne **sans Cloud Functions** (donc sans forfait Blaze ni
carte bancaire) : les pages écrivent directement dans Firestore, et les règles
Firestore (`firestore.rules`) sont le garde-fou.

## Les trois pages (`web/`)

| Page | Pour qui | Ce qu'elle fait |
| --- | --- | --- |
| `web/index.html` | Clients (sans compte) | Location du studio (heures libres seulement, prix au forfait), shooting produit, vidéo, montage, pub sur devis ; panier ; envoi de la demande ; puis bouton **« Envoyer sur WhatsApp »** |
| `web/suivi.html?t=…` | Client qui a le lien | État de la demande (en attente, confirmée, annulée, terminée), montants, coordonnées de paiement, bouton WhatsApp |
| `web/admin/` | Équipe | Demandes, contrôle du prix, « Acompte reçu → confirmer », annulation, WhatsApp vers le client, encaissements, équipe, coordonnées, grille des tarifs, sauvegarde |

### WhatsApp sans API

Aucune API WhatsApp ni validation Meta : la page ouvre un lien `https://wa.me/213…?text=…`
avec le message déjà écrit, et **c'est la personne qui appuie sur Envoyer**.
- Client → studio : après sa demande (n° de demande, détail, total, acompte, lien de suivi).
- Équipe → client : bouton « WhatsApp client » sur chaque demande (reçue, confirmée, annulée…).

Le numéro WhatsApp du studio se règle dans la page Équipe (« Coordonnées affichées aux
clients »). Sans numéro, le bouton n'apparaît pas.

## Comment c'est protégé sans serveur

| Risque | Protection |
| --- | --- |
| Double réservation | Un document par jour, `days/{AAAA-MM-JJ}`, avec les tranches de 30 min occupées. Le client peut seulement **ajouter** des tranches absentes, exactement celles de la demande créée dans le même envoi. Si une seule est déjà prise (même par un envoi simultané), toute la demande est refusée. |
| Prix modifié dans le navigateur | Le prix envoyé est une estimation. La page Équipe le **recalcule** avec la version du tarif citée par la demande et affiche ⚠ en cas d'écart, avant de valider l'acompte (toujours vérifié à la main). La demande doit citer le tarif en vigueur. |
| Demande d'un autre client lue | Les demandes (nom, téléphone) ne sont lisibles que par l'équipe. Le client lit sa fiche de suivi grâce à un jeton secret de 32 caractères, sans téléphone ; la liste des fiches est interdite. |
| Faux membre de l'équipe | Rôle lu à chaque requête dans `staff/{uid}`, e-mail vérifié obligatoire, compte désactivé = accès coupé tout de suite. Premier admin : seulement **comptppl@gmail.com** (dans `firestore.rules`, et `BOOTSTRAP_EMAILS` dans `web/admin/index.html`). Les autres membres sont invités par l'admin. |
| Action de l'équipe non tracée | Chaque modification de l'équipe doit créer son entrée `auditLogs/` dans le même envoi (identité réelle, heure du serveur), sinon elle est refusée. Le journal ne se modifie ni ne s'efface. |
| Référence en double | `counters/orders-AAAA` n'avance que de 1, dans une transaction : STU-2026-000001, 000002… |

### Ce que le forfait gratuit ne fait pas tout seul

- **Délai de l'acompte dépassé** : pas de tâche automatique. La page Équipe affiche
  « N demande(s) n'ont pas versé l'acompte » et un bouton qui les annule et libère les
  créneaux. Le délai (24 h par défaut, 1 à 72 h) se règle dans les coordonnées.
- **Sauvegarde** : pas d'export automatique. Bouton « Télécharger une sauvegarde »
  (fichier JSON) dans la page Équipe, à faire régulièrement.
- **Preuves de paiement** : pas de dépôt de fichier (Storage demande Blaze sur les
  nouveaux projets). Le client envoie la capture sur WhatsApp.
- Quotas gratuits : 50 000 lectures et 20 000 écritures par jour, largement assez.

Le code des Cloud Functions (`functions/src/*.ts` hors `web/` et `pricing/`) reste
dans le dépôt, non déployé, pour un éventuel passage à Blaze plus tard.

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `firestore.rules` | Toutes les protections ci-dessus |
| `firestore.indexes.json` | Index de la liste des demandes par état |
| `functions/src/pricing/` | Catalogue, moteur de prix (forfait par tranche), grille d'administration |
| `functions/src/web/studio-core.ts` | Code partagé par les pages : prix, téléphone, liens WhatsApp, contrôle de l'équipe |
| `web/lib/studio-core.js` | Le même, compilé pour le navigateur (`cd functions && npm run build:web`) — ne pas modifier à la main |
| `web/lib/firebase.js` | Configuration Firebase (sponsorhichem) ; `?emulateur=1` en local pour les essais |
| `tests/rules/` | Tests des règles sur l'émulateur Firebase |
| `functions/test/` | Tests du moteur de prix et du code partagé |

## Tarifs provisoires (moyenne du marché, à ajuster)

| Service | Tarif |
| --- | --- |
| Location studio | Forfait par tranche selon le jour (grille ci-dessous), réservation de 1 h minimum par pas de 30 min, tous les jours 8 h – 22 h |
| Options studio (cases à cocher) | iPhone 15 Pro Max +800 DA · Mannequin +1 000 DA **par heure** · Voix off +2 000 DA · Montage après la séance +3 500 DA — prix provisoires de mannequin, voix off et montage à fixer dans la page Équipe |
| Shooting produit | Pack 5 produits 12 000 DA · 10 produits 22 000 DA · 20 produits 40 000 DA (3 photos par produit) ; photo en plus 1 000 DA |
| Shooting vidéo | 8 000 DA par vidéo (9:16 ou 16:9) ; −10 % dès 3 vidéos, −15 % dès 5 |
| Montage vidéo | Jusqu'à 1 min 3 500 DA · 3 min 6 000 DA · 10 min 12 000 DA ; sous-titres +1 500 DA ; 2 révisions incluses, puis 1 000 DA |
| Production publicitaire | Sur devis |
| Remises de combinaison | Aucune pour l'instant (le moteur les gère dès qu'elles sont créées) |

Grille de location du studio (fixée par l'admin le 25/11/2026, forfait de chaque tranche) :

| Jour | 08h–12h | 12h–17h | 17h–22h |
| --- | --- | --- | --- |
| Dimanche à mercredi | 1 500 DA | 2 000 DA | 2 500 DA |
| Jeudi | 2 000 DA | 2 000 DA | 3 000 DA |
| Vendredi et samedi | 2 500 DA | 3 000 DA | 3 500 DA |

Chaque tranche touchée par la réservation est due en entier, même utilisée en partie :
dimanche 9h → 11h = 1 500 DA ; 11h30 → 12h30 = 1 500 + 2 000 = 3 500 DA ;
lundi 16h → 18h = 2 000 + 2 500 = 4 500 DA ; journée 8h → 22h = 6 000 DA.
Les dates spéciales « tarif du jour » remplacent le forfait de chaque tranche ; les
majorations ou remises en % s'appliquent à chaque forfait.

**Options à cocher** : le client coche ou décoche chaque option (mannequin, voix off,
montage, iPhone…) et le détail du prix se met à jour à chaque case. Dans la page Équipe,
« Options par réservation » permet d'en ajouter autant que voulu : nom, prix, « par
réservation » (ajouté une fois) ou « par heure » (multiplié par la durée), et une courte
description affichée au client.

**Modifier les tarifs sans toucher au code** : page Équipe → « Tarifs du studio ».
On y change chaque case du tableau, les heures des tranches (ajout / retrait), les
options et leurs prix, la durée minimale, le pas, le temps entre deux réservations
et le prix minimum, puis « Publier les nouveaux tarifs ». La page vérifie la
grille, publie une nouvelle version datée et journalisée ; les demandes déjà
envoyées gardent leur prix.

Repères utilisés pour les autres services : 3 000 – 6 000 DA/h pour un studio et 500 – 1 500 DA par photo produit
(JOBSdz, 2026), reels à partir de 5 000 DA chez les créateurs (Profilia), montage
à partir de 3 500 DA par publication (Helpyotek).

Après le déploiement : page Équipe → « Publier les tarifs provisoires ».

## Rôles

| Rôle | Peut |
| --- | --- |
| Client (sans compte) | Créer une demande et bloquer ses créneaux ; lire sa fiche de suivi |
| Employé | Voir les demandes ; fixer le prix d'un devis ; confirmer un acompte ; annuler ; marquer terminée |
| Comptable | Voir les demandes et tous les encaissements (sans les modifier) |
| Admin | Tout, plus l'équipe, les coordonnées, les tarifs, le journal d'audit et la sauvegarde |

## Mise en ligne sur sponsorhichem (une seule fois)

0. **Vérifier le projet** dans la console Firebase de sponsorhichem :
   - Firestore → Données : quelles collections existent déjà ? Les nouvelles règles
     **ferment tout ce qui n'est pas au studio** : si une ancienne application utilise
     encore ces données, elle ne pourra plus les lire.
   - Firestore → emplacement de la base (de préférence europe-west1) ; s'il n'y a pas
     encore de base, la créer en mode production en **europe-west1**.
   - Utilisation récente (Firestore → Utilisation).
1. **Authentication** → Méthodes de connexion : activer **Google** et **E-mail/Mot de passe**.
   Paramètres → Domaines autorisés : ajouter `sps-dz.github.io` (déjà présents :
   `sponsorhichem.web.app` et `sponsorhichem.firebaseapp.com`).
2. **Sur l'ordinateur** (Node 22) : `npm i -g firebase-tools`, puis `firebase login`.
3. **Déployer** depuis le dossier `studio/` :
   ```sh
   firebase deploy --only firestore,hosting
   ```
   (règles + index + les pages sur `https://sponsorhichem.web.app/`). Les pages marchent
   aussi depuis GitHub Pages : `https://sps-dz.github.io/hichem/studio/web/`.
4. **Page Équipe** (`…/admin/`) : se connecter avec Google (comptppl@gmail.com) →
   « Devenir administrateur » → « Publier les tarifs provisoires » → remplir
   « Coordonnées affichées aux clients » (numéro WhatsApp, BaridiMob, CCP, délai).
5. **Inviter l'équipe** : « Inviter un membre » (e-mail + rôle). La personne ouvre la
   page Équipe, se connecte avec cette adresse, puis « Rejoindre l'équipe ».
6. **Index** : le premier affichage d'une liste filtrée peut demander de créer un index ;
   `firebase deploy --only firestore` le crée (il est dans `firestore.indexes.json`).

## Tests

```sh
cd functions && npm ci && npm test        # 56 tests : prix, forfait, code partagé, WhatsApp
cd tests/rules && npm ci && npm run test:emulator   # 23 tests des règles (Java 21 conseillé)
```

Essai complet en local, sans toucher à la vraie base :
```sh
cd tests/rules && npx firebase-tools --config ../../firebase.json emulators:start --only firestore,auth,hosting --project demo-studio
# puis ouvrir http://localhost:5000/?emulateur=1 et http://localhost:5000/admin/?emulateur=1
```

Les tests tournent aussi sur GitHub à chaque envoi qui touche `studio/`
(`.github/workflows/studio-tests.yml`), et vérifient que `web/lib/studio-core.js` est à jour.

## Décisions encore ouvertes

- Délai pour verser l'acompte (24 h par défaut), annulation et remboursement.
- Coordonnées BaridiMob / CCP, numéro WhatsApp du studio, nom et logo.
- Tranches de 30 minutes.

## Photos de la page d'accueil

La page client (habillage « Plateau ») affiche des images d'attente tant que les vraies photos
ne sont pas fournies. Pour en mettre une : déposer le fichier dans `studio/web/img/`
(par exemple `hero.jpg`), puis indiquer son chemin dans `PHOTOS` en haut de
`studio/web/lib/vitrine.js` (`hero`, `product`, `editing`, `video`, `ad`).

## Site client modifiable par l'admin

Page Équipe → « Site client » (rôle admin) : photos de la page d'accueil, textes dans les
3 langues (case vide = texte d'origine) et catalogues en carrousel. Tout est publié d'un coup
avec « Enregistrer et publier » dans `publicSettings/site`. Les photos sont réduites dans le
navigateur (1600 px, JPEG) et rangées dans `siteMedia/{id}` (moins de 1 Mo chacune) : le forfait
gratuit n'a pas de stockage de fichiers. Une photo retirée est supprimée de la base à
l'enregistrement. Ordre d'affichage d'une photo : choisie par l'admin, sinon fichier `img/`,
sinon image dessinée.
