# Plateforme studio — phases 2 et 3 : base, comptes, catalogue et prix

Projet Firebase séparé du CRM. Cette phase pose les fondations : la base, les
règles d'accès, les comptes de l'équipe, le blocage des créneaux sans
chevauchement, le journal d'audit et la sauvegarde quotidienne. Les prix, le site
client, les commandes et les paiements viennent dans les phases suivantes.

## Contenu

| Fichier | Rôle |
| --- | --- |
| `firestore.rules` | Règles d'accès. Personne n'écrit depuis un navigateur ; chaque rôle ne lit que ce qui le concerne |
| `storage.rules` | Fichiers privés (preuves de paiement, justificatifs) fermés ; seules les photos `public/` sont lisibles |
| `firestore.indexes.json` | Index nécessaires au nettoyage des blocages et au contrôle des admins |
| `functions/src/lib/slots.ts` | Anti-chevauchement : une tranche de 30 min = un document, réservé en transaction |
| `functions/src/lib/money.ts` | Montants en dinars entiers ; acompte arrondi au dinar sans virgule flottante |
| `functions/src/lib/phone.ts` | Numéros algériens normalisés (+213…) : un numéro = une seule fiche client |
| `functions/src/lib/access.ts` | Liens privés des clients (jeton aléatoire, seule l'empreinte est stockée) |
| `functions/src/lib/counters.ts` | Références STU-2026-000123 sans doublon |
| `functions/src/lib/audit.ts` | Journal d'audit écrit dans la même transaction que la modification |
| `functions/src/staff.ts` | Premier admin, création de compte, rôle, désactivation |
| `functions/src/backup.ts` | Export complet de la base chaque nuit |
| `web/admin/index.html` | Page « Équipe » pour devenir admin et gérer les comptes |
| `tests/rules/` | Tests des règles, à lancer sur l'émulateur Firebase officiel |
| `../.github/workflows/studio-tests.yml` | Lance tous les tests sur GitHub à chaque envoi qui touche `studio/` |

## Phase 3 : catalogue et moteur de prix

Le prix est toujours calculé par le serveur (`functions/src/pricing/engine.ts`), en
dinars entiers : prix de chaque ligne → sous-total → meilleure remise (une seule,
sans cumul, jamais sous le prix minimum) → total → acompte 20 % → reste. Le
résultat complet sert d'instantané figé dans la commande (phase 6).

| Fichier | Rôle |
| --- | --- |
| `functions/src/pricing/catalog.ts` | Structure du catalogue, vérification avant publication, tarifs provisoires |
| `functions/src/pricing/engine.ts` | Calcul de chaque service, des remises et des totaux |
| `functions/src/pricing/studioGrid.ts` | Grille jours × tranches de la page d'administration ↔ catalogue |
| `functions/src/catalogAdmin.ts` | Publication versionnée du catalogue (admin), grille du studio et calcul public `pricingQuote` |

### Tarifs provisoires (moyenne du marché, à ajuster)

| Service | Tarif |
| --- | --- |
| Location studio | Forfait par tranche selon le jour (grille ci-dessous), réservation de 1 h minimum par pas de 30 min, tous les jours 8 h – 22 h |
| Option studio | iPhone 15 Pro Max : +800 DA par réservation |
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

**Modifier les tarifs sans toucher au code** : page Équipe → « Tarifs du studio ».
On y change chaque case du tableau, les heures des tranches (ajout / retrait), les
options et leurs prix, la durée minimale, le pas, le temps entre deux réservations
et le prix minimum, puis « Publier les nouveaux tarifs ». Le serveur vérifie la
grille, publie une nouvelle version datée et journalisée ; les commandes déjà
passées gardent leur prix.

Repères utilisés pour les autres services : 3 000 – 6 000 DA/h pour un studio et 500 – 1 500 DA par photo produit
(JOBSdz, 2026), reels à partir de 5 000 DA chez les créateurs (Profilia), montage
à partir de 3 500 DA par publication (Helpyotek).

Après le déploiement : page Équipe → « Publier les tarifs provisoires ».

## Rôles proposés (à valider)

| Rôle | Lit | Écrit |
| --- | --- | --- |
| Visiteur / client | Catalogue, promotions, disponibilités (sans aucun nom) | Rien (passera par les fonctions) |
| Employé | + clients, commandes, réservations, devis, tranches, notifications | Rien en direct |
| Comptable | + clients, commandes, paiements, preuves, dépenses | Rien en direct |
| Admin | Tout, sauf les liens privés des clients | Rien en direct |

Toutes les modifications passent par les fonctions, qui vérifient le rôle,
recalculent les montants et écrivent le journal d'audit.

## Mise en place (une seule fois)

1. **Créer le projet** sur https://console.firebase.google.com, par exemple
   `studio-hichem`. Passer au forfait **Blaze** (carte bancaire).
2. **Plafond de dépenses** : Google Cloud → Facturation → Budgets et alertes →
   créer un budget (par exemple 10 $/mois) avec alerte par e-mail.
3. **Firestore** : créer la base en mode production, emplacement
   **europe-west1 (Belgique)**. Cet emplacement ne peut plus être changé ensuite.
4. **Authentication** → Méthodes de connexion : activer **Google** et
   **E-mail/Mot de passe**.
5. **Storage** : créer le bucket par défaut.
6. **Bucket de sauvegarde** : Google Cloud → Cloud Storage → créer un bucket
   privé `studio-hichem-backups` en `europe-west1`. Puis donner au compte de
   service des fonctions (`NUMERO-DU-PROJET-compute@developer.gserviceaccount.com`, visible dans IAM) les rôles
   « Administrateur d'import/export Cloud Datastore » (sur le projet) et
   « Administrateur des objets de l'espace de stockage » (sur ce bucket).
7. **Sur ton ordinateur** (Node 22 et `npm i -g firebase-tools`) :
   ```sh
   firebase login
   # remplacer REMPLACER-PAR-ID-DU-PROJET-STUDIO dans .firebaserc
   cd functions && npm ci && cd ..
   ```
8. **Paramètres** : créer `functions/.env.<ID-DU-PROJET>` :
   ```
   ADMIN_EMAILS=ton.email@gmail.com
   BACKUP_BUCKET=studio-hichem-backups
   ```
9. **Page Équipe** : dans `web/admin/index.html`, remplacer `firebaseConfig`
   par la configuration de l'application Web (Paramètres du projet → Vos
   applications → ajouter une application Web).
10. **Déployer** :
    ```sh
    firebase deploy --only firestore,storage,functions,hosting
    ```

## Premier admin

Ouvrir `https://ID-DU-PROJET.web.app/admin/`, se connecter avec le compte Google
dont l'e-mail est dans `ADMIN_EMAILS`, cliquer « Devenir administrateur ». Un
e-mail non vérifié ou absent de la liste est refusé (c'est la faille du CRM
corrigée). Ensuite, « Ajouter un membre » crée un compte et donne un lien à
envoyer à la personne pour qu'elle choisisse son mot de passe.

Garde-fous : on ne peut pas changer son propre rôle ni se désactiver, et il
reste toujours au moins un admin actif. Un compte désactivé perd l'accès
immédiatement.

## Tests

```sh
cd functions && npm test            # 51 tests : chevauchement, concurrence, rôles, audit, argent, prix
cd tests/rules && npm ci && npm run test:emulator   # règles, avec Java 21 installé
```

Les tests des fonctions tournent sur une base Firestore en mémoire qui reproduit
les transactions (dont les conflits entre transactions simultanées). Les tests
des règles demandent l'émulateur officiel (Java) ; ils tournent aussi tout seuls
sur GitHub grâce au fichier `.github/workflows/studio-tests.yml` (à la racine du dépôt).

## Réglages techniques à confirmer

- Tranches du calendrier de **30 minutes** : une réservation de 10:15 à 11:00
  occupe 10:00 et 10:30.
- Durée de validité d'un lien client : **90 jours**, et l'admin peut le révoquer.
- Le tampon entre réservations est un réglage ; il vaut 0 tant que tu ne l'as
  pas fixé (décision « Tarifs de départ »).
