/**
 * Prepares packages/desktop/build for electron-builder:
 *  - bundles main.ts + @qodea/core (+ SDK deps) into ONE CJS file (esbuild)
 *  - copies preload.cjs and the built UI
 *  - copies playwright driver packages (kept external)
 *  - writes a minimal package.json for the packaged app
 */
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(desktop, '..', '..');
const out = path.join(desktop, 'build');

console.log('[pack-prep] bundling main…');
await build({
  entryPoints: [path.join(desktop, 'src', 'main.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: path.join(out, 'main.cjs'),
  external: ['electron', 'playwright'],
  sourcemap: false,
  logLevel: 'silent',
  banner: {
    // CJS output has no import.meta — provide it before module code runs
    js: 'var __import_meta_url = require("node:url").pathToFileURL(__filename).href;',
  },
  define: { 'import.meta.url': '__import_meta_url' },
});

console.log('[pack-prep] copying preload + ui + playwright…');
fs.copyFileSync(path.join(desktop, 'preload.cjs'), path.join(out, 'preload.cjs'));
fs.cpSync(path.join(root, 'packages', 'ui', 'dist'), path.join(out, 'ui-dist'), { recursive: true });

function resolvePkg(name) {
  // pnpm: direct links first, then dig into the content-addressable store
  const candidates = [
    path.join(desktop, 'node_modules', name),
    path.join(root, 'packages', 'core', 'node_modules', name),
    path.join(root, 'node_modules', name),
  ];
  for (const base of candidates) {
    const pkgFile = path.join(base, 'package.json');
    if (fs.existsSync(pkgFile)) {
      const pkgJson = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
      return { from: fs.realpathSync(base), version: pkgJson.version };
    }
  }
  // transitive deps live only inside .pnpm
  const store = path.join(root, 'node_modules', '.pnpm');
  if (fs.existsSync(store)) {
    const prefix = `${name}@`;
    for (const entry of fs.readdirSync(store)) {
      if (!entry.startsWith(prefix)) continue;
      const base = path.join(store, entry, 'node_modules', name);
      if (fs.existsSync(path.join(base, 'package.json'))) {
        const pkgJson = JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8'));
        return { from: fs.realpathSync(base), version: pkgJson.version };
      }
    }
  }
  throw new Error(`[pack-prep] cannot resolve ${name}`);
}

for (const name of ['playwright', 'playwright-core']) {
  const { from } = resolvePkg(name);
  fs.cpSync(from, path.join(out, 'node_modules', name), { recursive: true });
}

// minimal package.json for the packed app
const desktopPkg = JSON.parse(
  fs.readFileSync(path.join(desktop, 'package.json'), 'utf8'),
);
fs.writeFileSync(
  path.join(out, 'package.json'),
  JSON.stringify(
    {
      name: 'qodea',
      productName: 'Qodea',
      version: desktopPkg.version,
      description: 'Qodea — open-source agentic coder app',
      author: 'Csala Zoltán',
      license: 'MIT',
      type: 'commonjs',
      main: 'main.cjs',
      // electron-builder requires the version here but electron must sit in devDependencies
      devDependencies: { electron: desktopPkg.devDependencies?.electron ?? '^43.0.0' },
    },
    null,
    2,
  ),
);

console.log('[pack-prep] done →', out);
