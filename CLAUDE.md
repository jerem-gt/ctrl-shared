# CLAUDE.md

## Rôle du dépôt

Fichiers communs à **cash-ctrl** et **shelf-ctrl** (`~/WebstormProjects/cash-ctrl`, `~/WebstormProjects/shelf-ctrl`), deux applis perso de même stack : monorepo npm (`client` React/Vite, `server` Express 5 + SQLite bundlé par tsup, `shared`), image Docker Alpine sur ghcr.io mise à jour par Watchtower sur un NAS Synology. Le README décrit l'utilisation côté projet ; ce fichier, la maintenance.

| Fichier                                             | Consommé par les projets via                                                                               | Publication           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------- |
| `.github/workflows/app.yml`                         | `uses:` épinglé par SHA (commentaire `# vX.Y.Z`) dans leur `.github/workflows/ci.yml`                      | tag                   |
| `bin/prepare-runtime-deps.mjs`, `docker/Dockerfile` | devDependency `github:jerem-gt/ctrl-shared#vX.Y.Z` (seuls `bin`, `docker` et `server` sont dans le paquet) | tag                   |
| `server/*.ts` (hors tests)                          | même devDependency : `import … from '@jerem-gt/ctrl-shared/server/<module>'`                               | tag                   |
| `default.json`                                      | preset Renovate `github>jerem-gt/ctrl-shared`, lu sur `main`                                               | **immédiate** au push |
| `renovate.json`                                     | config Renovate de ce dépôt seulement                                                                      | —                     |

## Règles

- **Tout changement touche les deux projets** : vérifier qu'il convient à l'un et à l'autre (cash-ctrl n'a pas `sharp` ni `ADMIN_PASSWORD` obligatoire, shelf-ctrl si). Ce qui est propre à un projet reste chez lui : `.github/smoke.env`, `.github/smoke-test.sh`, `server/runtime-externals.json`.
- **Code serveur partagé (`server/`)** : modules TypeScript livrés **en sources, sans build** (tsx, Vitest et tsc les lisent depuis `node_modules`, tsup les embarque dans le bundle des projets). Mailer SMTP, `sha256Hex`, jeton de premier démarrage, `FailureRateLimiter` et `SQLiteSessionStore` (chacun crée sa table si absente), fabrique `createHttpErrors<Code>(render)` (le registre de codes reste dans chaque projet). Dépendances en `peerDependencies` (les projets les fournissent), tests à côté de chaque module, vérifiés par `.github/workflows/check.yml` (types, tests avec couverture, Prettier, puis SonarCloud sur les PR et `main` : projet `jerem-gt_ctrl-shared`, secret `SONAR_TOKEN`, viser zéro issue comme dans les projets). Un module y entre quand il est **identique** dans les deux projets : ce qui diffère (format de log, 2FA…) se paramètre ou reste dans le projet. Ne pas importer un module de projet depuis `server/`.
- **Pas de CI pour le reste** : un changement du workflow, du script ou du Dockerfile (ou du code `server/` à valider dans les projets) se teste depuis un projet, sur une branche, en pointant le workflow (`@ma-branche`) **et** la devDependency (`#ma-branche`) sur la branche de ce dépôt. Le build Docker et le smoke test ne tournent que si le run publie une release (commit `feat`/`fix`).
- **Tags immuables** (ruleset « tags de release ») : `vX.Y.Z` en semver, jamais déplacé ni supprimé ; une correction est un nouveau tag. Majeure si le contrat change pour les projets (scripts npm attendus, chemins, fichiers à fournir, noms de jobs).
- **Le preset `default.json` s'applique sans relecture** aux deux projets dès le push sur `main` : le valider avant (`npx --package renovate -- renovate-config-validator default.json`).
- **Noms des jobs du workflow** : les checks des projets s'appellent `app / <nom du job>` et les rulesets exigent `app / 🧪 CI & Tests` (plus `SonarCloud Code Analysis` sur `main`). Renommer ce job impose de mettre à jour les rulesets des deux projets et les valeurs par défaut de `~/.config/gh/harden.sh`.
- **Actions épinglées par SHA** (`@<sha> # vX`), obligatoire dans les dépôts : toute action ajoutée au workflow l'est aussi.
- `prepare-runtime-deps` s'exécute depuis la racine du projet (`process.cwd()`), cible figée linux/x64/musl (aucun argument : Sonar S8707). Un module natif avec prebuilds par plateforme ajouté dans un projet demande ici son filtrage.

## Conventions

- Commits conventionnels en français (`feat:`, `fix:`, `docs:`, `ci:`…), fins de ligne LF, Prettier (`npm run format:check`).
- `server/` : `npm run typecheck` et `npm test` avant de pousser ; mêmes règles TypeScript que les projets (strict, pas de `any`, ni ternaires imbriqués).
- `main` exige une PR (ruleset « main ») ; le push direct passe par le contournement admin.
- Publier : `git tag vX.Y.Z && git push origin vX.Y.Z`, puis Renovate ouvre dans chaque projet une PR groupée (workflow + devDependency).
