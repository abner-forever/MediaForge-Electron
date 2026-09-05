import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(scriptDir, '..');
const outputDir = path.join(electronRoot, 'out');
const packageJson = JSON.parse(await readFile(path.join(electronRoot, 'package.json'), 'utf8'));
const version = process.env.APP_VERSION || packageJson.version;

async function fileHash(filePath) {
  const data = await readFile(filePath);
  return createHash('sha512').update(data).digest('base64');
}

async function findFile(predicate) {
  const entries = await readdir(outputDir);
  const match = entries.find((name) => predicate(name));
  return match ? path.join(outputDir, match) : null;
}

async function writeUpdateInfo(filePath, yaml) {
  await writeFile(filePath, yaml, 'utf8');
  console.log(`Wrote ${path.basename(filePath)}`);
}

async function writeLatestYaml(filename, outputName) {
  const filePath = await findFile((name) => name === filename);
  if (!filePath) {
    console.log(`Skipping ${outputName}: ${filename} not found`);
    return;
  }

  const fileStats = await stat(filePath);
  const sha512 = await fileHash(filePath);
  const releaseDate = new Date().toISOString();
  const yaml = [
    `version: ${version}`,
    'files:',
    `  - url: ${filename}`,
    `    sha512: ${sha512}`,
    `    size: ${fileStats.size}`,
    `path: ${filename}`,
    `sha512: ${sha512}`,
    `releaseDate: '${releaseDate}'`,
    '',
  ].join('\n');

  await writeUpdateInfo(path.join(outputDir, outputName), yaml);
}

await writeLatestYaml(
  `MediaForge-Windows-Setup-${version}.exe`,
  'latest.yml',
);
await writeLatestYaml(
  `MediaForge-macOS-arm64-${version}.zip`,
  'latest-mac.yml',
);
