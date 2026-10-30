# ctrl-shared

Fichiers communs à [cash-ctrl](https://github.com/jerem-gt/cash-ctrl) et [shelf-ctrl](https://github.com/jerem-gt/shelf-ctrl) : même stack (monorepo npm `client` / `server` / `shared`, Express + SQLite, image Docker Alpine sur ghcr.io mise à jour par Watchtower). Un changement fait ici profite aux deux projets, sans copie à maintenir.

| Fichier                        | Rôle                                                                                                                                                | Utilisé par le projet via                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `.github/workflows/app.yml`    | Workflow réutilisable : lint, types, tests, SonarCloud, semantic-release, image Docker allégée + smoke test, ménage des tags et images de dev       | `uses:` dans `.github/workflows/ci.yml`                                              |
| `bin/prepare-runtime-deps.mjs` | Extrait dans `deploy/node_modules` les seules deps runtime du serveur bundlé (binaires linux/x64/musl)                                              | devDependency `@jerem-gt/ctrl-shared` (le workflow lance `npx prepare-runtime-deps`) |
| `docker/Dockerfile`            | Image finale (Node Alpine, fuseau Europe/Paris seul, `deploy/node_modules` + dists)                                                                 | idem, copié dans `deploy/` par le workflow                                           |
| `server/*.ts`                  | Code serveur commun en sources TS : mailer SMTP, `sha256Hex`, jeton de premier démarrage, limiteur d'échecs, store de sessions SQLite, erreurs HTTP | devDependency : `import … from '@jerem-gt/ctrl-shared/server/<module>'`              |
| `default.json`                 | Preset Renovate                                                                                                                                     | `"extends": ["github>jerem-gt/ctrl-shared"]`                                         |

## Utilisation dans un projet

`.github/workflows/ci.yml` :

```yaml
name: Build, Release & Push

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

# Groupes séparés push / PR : seuls les runs de PR sont annulés (un run push peut être en pleine release)
concurrency:
  group: ${{ github.workflow }}-${{ github.event_name }}-${{ github.head_ref || github.ref_name }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

permissions:
  contents: read

jobs:
  app:
    uses: jerem-gt/ctrl-shared/.github/workflows/app.yml@v1.0.0
    # Maximum accordé au workflow commun ; chacun de ses jobs n'en demande qu'une partie
    permissions:
      contents: write
      issues: write
      pull-requests: write
      packages: write
    secrets: inherit
```

`package.json` (racine) : `"@jerem-gt/ctrl-shared": "github:jerem-gt/ctrl-shared#v1.0.0"` en devDependency, **même tag que le workflow**.

Ce que le projet doit fournir :

- scripts npm `lint`, `typecheck:test` (client), `typecheck`, `build`, `test:coverage` (client et serveur) ;
- `server/runtime-externals.json` : modules laissés hors du bundle tsup, livrés par `prepare-runtime-deps` (natifs, swagger-ui) ;
- `client/public/favicon.svg` (icône Dozzle), `sonar-project.properties` et le secret `SONAR_TOKEN` ;
- pour le smoke test de l'image, qui vérifie déjà `/api/health`, `/` et `/api/docs/` :
  - `.github/smoke.env` (facultatif) : variables du conteneur (`--env-file`, valeurs factices) ;
  - `.github/smoke-test.sh` (facultatif) : contrôles propres au projet, appelé avec l'URL de base et le nom du conteneur (`sh .github/smoke-test.sh http://localhost:3000 smoke`).

Les checks GitHub s'appellent `app / 🧪 CI & Tests`, etc. : c'est ce nom qu'attendent les règles de branche.

## Publier une version

Le code `server/` est vérifié ici (`.github/workflows/check.yml` : `npm run typecheck`, `npm run test:coverage`, Prettier, puis SonarCloud sur les PR et `main`). Le reste se teste depuis un projet en pointant le workflow **et** la devDependency sur la branche (`@ma-branche`, `#ma-branche`), puis :

```sh
git tag v1.1.0 && git push origin v1.1.0
```

Renovate propose ensuite la montée dans chaque projet (référence du workflow et devDependency, groupées dans une seule PR, toujours sur le même tag).

Seuls le workflow, `bin/`, `docker/` et `server/` demandent un tag. Le preset `default.json` est lu par Renovate sur `main`, sans tag : une modification s'applique aux deux projets dès qu'elle est poussée.
