import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const manifest = JSON.parse(await readFile(new URL('../upstream-manifest.json', import.meta.url), 'utf8'));

for (const [index, path] of manifest.paths.entries()) {
  const url = `https://raw.githubusercontent.com/${manifest.repository}/${manifest.commit}/${manifest.root}/${path}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const target = resolve('public/upstream', path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, new Uint8Array(await response.arrayBuffer()));
  console.log(`[${index + 1}/${manifest.paths.length}] ${path}`);
}
