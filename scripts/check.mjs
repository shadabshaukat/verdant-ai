#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignored = new Set(['.git', 'node_modules', '.secrets', 'coverage']);
const files = [];
async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name === '.env' || entry.name.startsWith('.env.') && entry.name !== '.env.example') continue;
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(target);
    else if (entry.isFile()) files.push(target);
  }
}
await walk(root);
const errors = [];
let syntax = 0, links = 0;
for (const file of files) {
  const relative = path.relative(root, file);
  if (/\.(mjs|js)$/.test(file)) {
    try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); syntax++; }
    catch (error) { errors.push(`${relative}: ${String(error.stderr || error.message).trim()}`); }
  }
  if (/\.(sh|sql|ya?ml|mjs|js)$/.test(file) && (await fs.readFile(file, 'utf8')).includes('\r')) errors.push(`${relative}: use LF line endings`);
  if (file.endsWith('.md')) {
    const markdown = (await fs.readFile(file, 'utf8')).replace(/```[\s\S]*?```/g, '');
    for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const href = match[1].replace(/^<|>$/g, '');
      if (/^(?:[a-z][\w+.-]*:|#)/i.test(href)) continue;
      const pathname = decodeURIComponent(href.split('#')[0].split('?')[0]);
      if (!pathname) continue;
      try { await fs.access(path.resolve(path.dirname(file), pathname)); links++; }
      catch { errors.push(`${relative}: missing local link ${href}`); }
    }
  }
}
try {
  const tracked = execFileSync('git', ['ls-files', '--', '.env', '.secrets'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (tracked) errors.push('Local configuration or generated secrets are tracked in Git');
} catch (error) {
  if (error.status !== 128 && error.code !== 'ENOENT') throw error;
}
if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else console.log(`PASS: ${syntax} JavaScript files, LF deployment sources, ${links} local documentation links and tracked-secret check`);
