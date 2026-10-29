#!/usr/bin/env node
/** Stage a signed local renderer update without re-signing the .app or server.
 * Existing artifact verification, pointer protection and boot rollback apply.
 * Close the desktop first. No TCC or keychain changes are made. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { packRendererArtifact } from './build-server-artifact.mjs';

const require = createRequire(import.meta.url);
const { manifest: manifests, activation, pointerStore } = require('../shared/artifact-core/index.cjs');
const { rendererPointerChannel } = require('../shared/artifact-core/pointer-channels.cjs');
const contracts = require('../shared/contract-versions.cjs');

export async function stageRendererUpdate({ homeDir, seedDir, archivePath, version, keyset, privateKey, outputDir, platformArch = `${process.platform}-${process.arch}` }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Renderer version must be major.minor.patch');
  const manifestPath = path.join(seedDir, `seed-train-${platformArch}.json`);
  const seed = manifests.verifyManifest(fs.readFileSync(manifestPath), fs.readFileSync(manifestPath + '.sig'), keyset);
  if (seed.contract.preload !== contracts.PRELOAD_API_VERSION || seed.contract.serverProtocol !== contracts.SERVER_PROTOCOL_VERSION)
    throw new Error('Installed shell/server contracts differ; a renderer-only update is not compatible');
  const serverEntry = seed.artifacts.server?.[platformArch];
  if (!serverEntry) throw new Error('Installed seed has no matching server');
  const channel = seed.channel, rendererChannel = rendererPointerChannel(channel);
  const currentServer = await pointerStore.readPointer(homeDir, channel, 'current');
  const currentRenderer = await pointerStore.readPointer(homeDir, rendererChannel, 'current');
  if (!currentServer || currentServer.sha256 !== serverEntry.sha256) throw new Error('Current server differs from installed seed; refusing to change it');
  if ([currentRenderer?.version, seed.artifacts.renderer?.version].filter(Boolean).some(old => {
    const a = version.split('.').map(Number), b = old.split('.').map(Number);
    return a[0] < b[0] || a[0] === b[0] && (a[1] < b[1] || a[1] === b[1] && a[2] <= b[2]);
  })) throw new Error('Use a newer renderer version');
  const train = Math.max(currentServer.train || 0, currentRenderer?.train || 0) + 1;
  const sha256 = await activation.sha256File(archivePath);
  const next = { ...seed, train, releasedAt: new Date().toISOString(), artifacts: {
    server: { [platformArch]: serverEntry },
    renderer: { version, sha256, size: fs.statSync(archivePath).size, path: path.basename(archivePath) },
  } };
  const bytes = Buffer.from(JSON.stringify(next, null, 2) + '\n');
  const signature = crypto.sign(null, bytes, privateKey);
  const verified = manifests.verifyManifest(bytes, signature, keyset);
  manifests.checkMonotonic(verified, Math.max(currentServer.train || 0, currentRenderer?.train || 0));
  // Signature and compatibility checks happen before any profile mutation.
  const lock = await pointerStore.acquireLock(homeDir);
  if (!lock) throw new Error('Another artifact update is in progress');
  try {
    if (await pointerStore.readPointer(homeDir, channel, 'next') || await pointerStore.readPointer(homeDir, rendererChannel, 'next'))
      throw new Error('An update is already staged; refusing to overwrite it');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'renderer-update.json'), bytes);
    fs.writeFileSync(path.join(outputDir, 'renderer-update.json.sig'), signature);
    await activation.activateFromArchive(path.join(seedDir, serverEntry.path), verified, { homeDir, channel, kind: 'server', platformArch });
    try {
      await activation.activateFromArchive(archivePath, verified, { homeDir, channel: rendererChannel, kind: 'renderer' });
    } catch (error) {
      await pointerStore.clearPointer(homeDir, channel, 'next');
      throw error;
    }
    return { rendererVersion: version, serverVersion: serverEntry.version, train, staged: true };
  } finally { await lock.release(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => index % 2 ? pairs : [...pairs, [value.replace(/^--/, ''), all[index + 1]]], []));
  for (const key of ['app', 'home', 'renderer', 'version', 'keyset', 'key', 'out']) if (!args[key]) throw new Error(`Missing --${key}`);
  const app = path.resolve(args.app), homeDir = path.resolve(args.home);
  if (!app.endsWith('.app')) throw new Error('Expected an installed .app');
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
  const infoFile = path.join(homeDir, 'server-info.json');
  if (fs.existsSync(infoFile)) {
    const info = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
    for (const pid of [info.ownerPid, info.pid].filter(pid => Number.isInteger(pid) && pid > 0)) {
      let running = false; try { process.kill(pid, 0); running = true; } catch (error) { if (error.code !== 'ESRCH') throw error; }
      if (running) throw new Error('Close Enigma and its server before staging a local update');
    }
  }
  const outputDir = path.resolve(args.out);
  if (fs.existsSync(outputDir)) throw new Error('Use a new output directory; existing artifacts will not be overwritten');
  fs.mkdirSync(outputDir, { recursive: true });
  const archive = await packRendererArtifact({ rendererDistDir: path.resolve(args.renderer), artifactOutDir: path.join(outputDir, 'archive'), version: args.version });
  console.log(await stageRendererUpdate({ homeDir, seedDir: path.join(app, 'Contents/Resources/seed'), archivePath: archive.archivePath,
    version: args.version, keyset: JSON.parse(fs.readFileSync(args.keyset, 'utf8')), privateKey: crypto.createPrivateKey(fs.readFileSync(args.key)), outputDir }));
}
