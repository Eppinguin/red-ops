#!/usr/bin/env node
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { parse as parseYaml } from 'yaml';
import { normalizeFoundryDocument, slug } from './lib/foundry-normalize.mjs';

const root = process.cwd();
const manifestPath = path.join(root, 'foundry-content-manifest.json');
const config = JSON.parse(await readFile(manifestPath, 'utf8'));
if (!Number.isInteger(config.projectId) || !config.repository || !config.ref || !config.apiBase || !Array.isArray(config.packRoots) || !Array.isArray(config.includedDocumentTypes)) {
  throw new Error('foundry-content-manifest.json is missing required fields');
}
const outputDirectory = process.env.CONTENT_OUTPUT_DIR
  ? path.resolve(process.env.CONTENT_OUTPUT_DIR)
  : path.join(root, 'public', 'content', 'foundry');
const apiBase = config.apiBase.replace(/\/$/, '');
const projectId = encodeURIComponent(String(config.projectId));
const ref = process.env.FOUNDRY_REF || config.ref;
const concurrency = Math.max(1, Math.min(12, Number(process.env.CONTENT_SYNC_CONCURRENCY || 6)));
const sourceDirectory = process.env.FOUNDRY_SOURCE_DIR ? path.resolve(process.env.FOUNDRY_SOURCE_DIR) : null;
const gitlabToken = process.env.GITLAB_TOKEN;

function apiUrl(endpoint, params = {}) {
  const url = new URL(`${apiBase}/projects/${projectId}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url;
}

async function request(url, attempt = 0) {
  const headers = {
    'user-agent': 'cp-red-npc-generator-content-sync/1.0',
    ...(gitlabToken ? { 'private-token': gitlabToken } : {}),
  };
  const response = await fetch(url, { headers });
  if ((response.status === 429 || response.status >= 500) && attempt < 4) {
    const retryAfter = Number(response.headers.get('retry-after'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(30000, retryAfter * 1000)
      : Math.min(8000, 500 * (2 ** attempt));
    await new Promise((resolve) => setTimeout(resolve, delay));
    return request(url, attempt + 1);
  }
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response;
}

async function listTree(repositoryPath) {
  const entries = [];
  let page = 1;
  for (;;) {
    const response = await request(apiUrl('repository/tree', {
      ref,
      path: repositoryPath,
      recursive: true,
      per_page: 100,
      page,
    }));
    const batch = await response.json();
    entries.push(...batch);
    const next = response.headers.get('x-next-page');
    if (!next) break;
    page = Number(next);
  }
  return entries;
}

async function readRaw(repositoryPath) {
  if (sourceDirectory) return readFile(path.join(sourceDirectory, repositoryPath), 'utf8');
  const encodedPath = encodeURIComponent(repositoryPath);
  const response = await request(apiUrl(`repository/files/${encodedPath}/raw`, { ref }));
  return response.text();
}

async function listLocalYaml(repositoryPath) {
  const rootPath = path.join(sourceDirectory, repositoryPath);
  const files = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) files.push(path.relative(sourceDirectory, absolute).split(path.sep).join('/'));
    }
  }
  try {
    await walk(rootPath);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return [];
    throw error;
  }
  return files;
}

async function mapConcurrent(values, limit, mapper) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      results[index] = await mapper(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

console.log(sourceDirectory
  ? `Discovering Foundry content in ${sourceDirectory}`
  : `Discovering Foundry content at ${config.repository}@${ref}`);
const yamlFiles = sourceDirectory
  ? (await Promise.all(config.packRoots.map(listLocalYaml))).flat().sort()
  : (await Promise.all(config.packRoots.map(listTree)))
    .flat()
    .filter((entry) => entry.type === 'blob' && /\.ya?ml$/i.test(entry.path))
    .map((entry) => entry.path)
    .sort();
if (yamlFiles.length === 0) throw new Error('No Foundry YAML documents were found in the configured pack roots.');

console.log(`Reading ${yamlFiles.length} YAML documents with concurrency ${concurrency}`);
let completed = 0;
const entries = (await mapConcurrent(yamlFiles, concurrency, async (repositoryPath) => {
  const raw = await readRaw(repositoryPath);
  const document = parseYaml(raw);
  completed += 1;
  if (completed % 50 === 0 || completed === yamlFiles.length) console.log(`  ${completed}/${yamlFiles.length}`);
  return normalizeFoundryDocument({ document, repositoryPath, config, ref });
})).filter(Boolean);

const byId = new Map();
for (const entry of entries) {
  const existing = byId.get(entry.id);
  if (!existing) {
    byId.set(entry.id, entry);
    continue;
  }
  const suffix = slug(entry.foundry.pack || entry.foundry.documentId || String(byId.size));
  byId.set(`${entry.id}.${suffix}`, { ...entry, id: `${entry.id}.${suffix}` });
}
const normalized = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
const contentHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');

let commit = process.env.FOUNDRY_COMMIT;
if (!commit && !sourceDirectory) {
  try {
    const response = await request(apiUrl(`repository/tags/${encodeURIComponent(ref)}`));
    const tag = await response.json();
    commit = tag.commit?.id;
  } catch {
    commit = undefined;
  }
}

const catalog = {
  manifest: {
    schemaVersion: config.schemaVersion,
    generatedAt: new Date().toISOString(),
    generator: {
      repository: 'n0lavar/cp_red_npc_generator',
      commit: 'dfd4c08c4295c3d34f11a6c75c4d3ae5792ef2a4',
    },
    foundry: {
      projectId: config.projectId,
      repository: config.repository,
      ref,
      ...(commit ? { commit } : {}),
      itemCount: normalized.length,
      contentHash,
    },
    entryCount: normalized.length,
    conflictCount: 0,
  },
  entries: normalized,
  conflicts: [],
};

async function atomicWrite(filename, value) {
  const target = path.join(outputDirectory, filename);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, value);
  await rename(temporary, target);
}

await mkdir(outputDirectory, { recursive: true });
await atomicWrite('catalog.json', `${JSON.stringify(catalog, null, 2)}\n`);
await atomicWrite('manifest.json', `${JSON.stringify(catalog.manifest, null, 2)}\n`);
console.log(`Wrote ${normalized.length} normalized entries (${contentHash.slice(0, 12)}) to ${path.relative(root, outputDirectory)}`);
