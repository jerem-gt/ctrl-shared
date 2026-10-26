#!/usr/bin/env node
// Extrait dans deploy/node_modules les deps runtime du serveur bundlé (cible Docker linux/x64/musl).
// Lancé depuis la racine du projet (`npx prepare-runtime-deps`) : les différences entre projets
// passent par server/runtime-externals.json.
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { cwd, stdout } from 'node:process';

const root = resolve(cwd());
const outDir = join(root, 'deploy', 'node_modules');

// Cible figée (image Docker Alpine) : aucune entrée externe ne compose les chemins copiés ou supprimés
const target = { platform: 'linux', arch: 'x64', libc: 'musl' };

// Liste partagée avec server/tsup.config.ts (modules laissés hors du bundle)
const externals = JSON.parse(readFileSync(join(root, 'server', 'runtime-externals.json'), 'utf8'));

// Préfixe des binaires better-sqlite3 et sharp : linuxmusl sous Alpine, sinon la plateforme
const nativePlatform =
  target.platform === 'linux' && target.libc === 'musl' ? 'linuxmusl' : target.platform;

// sharp (si externe) charge son binaire depuis @img/sharp-<plateforme>-<arch>, qui tire libvips en optionalDependencies.
// npm n'installe que ceux de l'hôte : le script doit tourner sur la plateforme cible (CI Alpine).
const sharpBinary = `@img/sharp-${nativePlatform}-${target.arch}`;

// Paquets jamais require au runtime : headers C++ (node-gyp) et télémétrie postinstall
const BUILD_ONLY = new Set(['node-addon-api', '@scarf/scarf']);

// Résolution Node : <fromDir>/node_modules/<name>, puis dossiers parents jusqu'à la racine du repo
function findPackage(name, fromDir) {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dir === root || dir === dirname(dir))
      throw new Error(`Paquet introuvable : ${name} (depuis ${fromDir})`);
  }
}

// Parcours récursif des `dependencies`, des peers non optionnels et des optionnelles du binaire sharp
const packages = new Map();
function collect(name, fromDir) {
  if (BUILD_ONLY.has(name)) return;
  const dir = findPackage(name, fromDir);
  const known = packages.get(name);
  if (known === dir) return;
  if (known !== undefined) throw new Error(`Versions multiples de ${name} : ${known}, ${dir}`);
  packages.set(name, dir);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const peers = Object.keys(pkg.peerDependencies ?? {}).filter(
    (peer) => pkg.peerDependenciesMeta?.[peer]?.optional !== true,
  );
  const optionals = name === sharpBinary ? Object.keys(pkg.optionalDependencies ?? {}) : [];
  for (const dep of [...Object.keys(pkg.dependencies ?? {}), ...peers, ...optionals])
    collect(dep, dir);
}
externals.forEach((name) => collect(name, join(root, 'server')));
if (packages.has('sharp')) collect(sharpBinary, packages.get('sharp'));

// Parcours récursif : visit(cheminComplet) pour chaque fichier
function walkFiles(dir, visit) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, visit);
    else visit(full);
  }
}

rmSync(join(root, 'deploy'), { recursive: true, force: true });
for (const [name, dir] of packages) {
  const dest = join(outDir, name);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(dir, dest, { recursive: true });
}

function remove(rel) {
  rmSync(join(outDir, rel), { recursive: true, force: true });
}

// Sources de compilation inutiles avec les prebuilds
[
  'better-sqlite3/deps',
  'better-sqlite3/src',
  'bcrypt/src',
  'bcrypt/test',
  'bcrypt/examples',
  'sharp/src',
  'sharp/install',
].forEach(remove);
walkFiles(outDir, (file) => {
  if (file.endsWith('.map')) rmSync(file);
});

// better-sqlite3 (lib/binding.js) : prebuilds/<linuxmusl|platform>-<arch>.node
const sqliteKey = `${nativePlatform}-${target.arch}.node`;
const sqlitePrebuilds = join(outDir, 'better-sqlite3', 'prebuilds');
for (const file of readdirSync(sqlitePrebuilds)) {
  if (file !== sqliteKey) rmSync(join(sqlitePrebuilds, file));
}

// bcrypt (node-gyp-build) : prebuilds/<platform>-<arch>/bcrypt[.<libc>].node
const bcryptPrebuilds = join(outDir, 'bcrypt', 'prebuilds');
for (const dir of readdirSync(bcryptPrebuilds)) {
  const full = join(bcryptPrebuilds, dir);
  if (dir === `${target.platform}-${target.arch}`) {
    for (const file of readdirSync(full)) {
      const libcTag = /\.(glibc|musl)\.node$/.exec(file)?.[1];
      if (libcTag !== undefined && libcTag !== target.libc) rmSync(join(full, file));
    }
  } else {
    rmSync(full, { recursive: true, force: true });
  }
}

// Vérifie que les binaires attendus sont bien présents (bcrypt : avec ou sans suffixe libc, comme node-gyp-build)
if (!existsSync(join(sqlitePrebuilds, sqliteKey)))
  throw new Error(`Prebuild better-sqlite3 absent : ${sqliteKey}`);
const bcryptDir = join(bcryptPrebuilds, `${target.platform}-${target.arch}`);
const bcryptFiles = [`bcrypt.${target.libc}.node`, 'bcrypt.node'];
if (!bcryptFiles.some((file) => existsSync(join(bcryptDir, file)))) {
  throw new Error(
    `Prebuild bcrypt absent : ${target.platform}-${target.arch}/${bcryptFiles.join(' ou ')}`,
  );
}

let totalSize = 0;
const natives = [];
walkFiles(outDir, (file) => {
  totalSize += statSync(file).size;
  if (file.endsWith('.node')) natives.push(file.slice(outDir.length + 1));
});

stdout.write(`Paquets : ${[...packages.keys()].join(', ')}\n`);
stdout.write(`Binaires : ${natives.join(', ')}\n`);
stdout.write(`Cible : ${target.platform}-${target.arch}-${target.libc}\n`);
stdout.write(`Taille deploy/node_modules : ${(totalSize / 1024 / 1024).toFixed(1)} Mo\n`);
