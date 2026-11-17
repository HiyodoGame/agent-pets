import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const errors = [];

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return extname(entry.name) === '.md' ? [path] : [];
  });
}

const files = [
  join(root, 'README.md'),
  join(root, 'CHANGELOG.md'),
  join(root, 'archive/phase-1-2026-11-14/INDEX.md'),
  join(root, 'petdeck/README.md'),
  ...markdownFiles(join(root, 'docs')),
  ...markdownFiles(join(root, 'petdeck/docs')),
];

let linkCount = 0;
for (const file of files) {
  const markdown = readFileSync(file, 'utf8');
  const links = markdown.matchAll(/!?\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))/g);
  for (const match of links) {
    const target = match[1] ?? match[2];
    if (!target || target.startsWith('#') || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(target)) continue;
    const path = decodeURIComponent(target.split('#')[0].split('?')[0]);
    if (!path) continue;
    linkCount += 1;
    if (!existsSync(resolve(dirname(file), path))) {
      errors.push(`${relative(root, file)}: broken local link: ${target}`);
    }
  }
}

const packageVersion = JSON.parse(readFileSync(join(root, 'petdeck/package.json'), 'utf8')).version;
const tauriVersion = JSON.parse(readFileSync(join(root, 'petdeck/src-tauri/tauri.conf.json'), 'utf8')).version;
const cargo = readFileSync(join(root, 'petdeck/src-tauri/Cargo.toml'), 'utf8');
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

if (!cargoVersion || packageVersion !== cargoVersion || packageVersion !== tauriVersion) {
  errors.push(
    `version mismatch: package=${packageVersion}, Cargo=${cargoVersion ?? 'missing'}, Tauri=${tauriVersion}`,
  );
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`docs: ${files.length} Markdown files, ${linkCount} local links; version ${packageVersion} aligned`);
}
