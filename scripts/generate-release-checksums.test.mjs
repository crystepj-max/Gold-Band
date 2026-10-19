import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = path.resolve('scripts/generate-release-checksums.mjs');

const releaseWorkflowContracts = [
  {
    workflow: '.github/workflows/release.yml',
    manifestGenerator: 'release-tools/scripts/generate-release-assets.mjs',
    checksumGenerator: 'release-tools/scripts/generate-release-checksums.mjs',
    installer: 'release-tools/scripts/install-gold-band-macos.sh',
  },
  {
    workflow: '.github/workflows/release-please.yml',
    manifestGenerator: 'scripts/generate-release-assets.mjs',
    checksumGenerator: 'scripts/generate-release-checksums.mjs',
    installer: 'scripts/install-gold-band-macos.sh',
  },
];

function getWorkflowStep(source, workflow, stepName) {
  const marker = `      - name: ${stepName}\n`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${workflow} must include the ${stepName} step`);

  const nextStep = source.indexOf('\n      - name: ', start + marker.length);
  return source.slice(start, nextStep === -1 ? undefined : nextStep);
}

function createDirectory(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'gold-band-checksums-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('writes deterministic sidecars for every supported platform artifact', (t) => {
  const directory = createDirectory(t);
  const assets = new Map([
    ['Gold.Band_1.2.3_aarch64.dmg', 'mac-arm'],
    ['Gold.Band_1.2.3_x64.dmg', 'mac-intel'],
    ['Gold.Band_1.2.3_x64-setup.exe', 'windows-exe'],
    ['Gold.Band_1.2.3_x64_en-US.msi', 'windows-msi'],
    ['Gold.Band_1.2.3_amd64.AppImage', 'linux-appimage'],
    ['Gold.Band_1.2.3_amd64.deb', 'linux-deb'],
    ['Gold.Band-1.2.3-1.x86_64.rpm', 'linux-rpm'],
    ['Gold.Band_aarch64.app.tar.gz', 'updater-macos'],
  ]);

  for (const [name, content] of assets) {
    writeFileSync(path.join(directory, name), content);
  }
  writeFileSync(path.join(directory, 'Gold.Band_1.2.3_amd64.deb.sig'), 'signature');
  writeFileSync(path.join(directory, 'latest.json'), '{}');
  writeFileSync(path.join(directory, 'notes.txt'), 'notes');
  writeFileSync(path.join(directory, 'obsolete.sha256'), 'stale');

  const result = spawnSync(process.execPath, [script, directory], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);

  for (const [name, content] of assets) {
    const digest = createHash('sha256').update(content).digest('hex');
    assert.equal(readFileSync(path.join(directory, `${name}.sha256`), 'utf8'), `${digest}  ${name}\n`);
  }

  const generated = readdirSync(directory).filter((name) => name.endsWith('.sha256')).sort();
  assert.deepEqual(generated, [...assets.keys()].map((name) => `${name}.sha256`).sort());
});

test('fails when the release contains no supported platform artifacts', (t) => {
  const directory = createDirectory(t);
  writeFileSync(path.join(directory, 'latest.json'), '{}');
  writeFileSync(path.join(directory, 'artifact.sig'), 'signature');

  const result = spawnSync(process.execPath, [script, directory], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No supported release assets/);
});

test('both release entry points generate and upload manifests, checksums, and the installer in order', () => {
  for (const contract of releaseWorkflowContracts) {
    const source = readFileSync(path.resolve(contract.workflow), 'utf8');
    const manifestCommand = `node ${contract.manifestGenerator} release-assets release-output --version "\${RELEASE_TAG#v}"`;
    const checksumCommand = `node ${contract.checksumGenerator} release-assets`;
    const uploadCommand = `gh release upload "\${RELEASE_TAG}" release-output/latest*.json ${contract.installer} release-assets/*.sha256 --clobber`;
    const manifestStep = getWorkflowStep(source, contract.workflow, 'Generate localized updater manifests and release body');
    const checksumStep = getWorkflowStep(source, contract.workflow, 'Generate release checksums');
    const uploadStep = getWorkflowStep(source, contract.workflow, 'Upload updater manifests, macOS installer, and release checksums');
    const manifestIndex = source.indexOf(manifestCommand);
    const checksumIndex = source.indexOf(checksumCommand);
    const uploadIndex = source.indexOf(uploadCommand);

    assert.ok(manifestStep.includes(manifestCommand), `${contract.workflow} must generate manifests into release-output`);
    assert.ok(checksumStep.includes(checksumCommand), `${contract.workflow} must generate sidecars for release-assets`);
    assert.ok(uploadStep.includes(uploadCommand), `${contract.workflow} must upload manifests, installer, and sidecars`);
    assert.ok(checksumIndex > manifestIndex, `${contract.workflow} must generate checksums after the manifests`);
    assert.ok(uploadIndex > checksumIndex, `${contract.workflow} must upload artifacts after the checksums`);
  }
});
