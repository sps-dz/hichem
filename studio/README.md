# Plateforme studio — phase 2 : base de données et comptes

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
cd functions && npm test            # 29 tests : chevauchement, concurrence, rôles, audit, argent
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
