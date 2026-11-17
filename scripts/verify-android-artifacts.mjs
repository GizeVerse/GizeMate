#!/usr/bin/env node
// Verifies the Android release artifacts WITHOUT running anything on a device or emulator and without any
// credential: it only reads the signed files.
//
//   node scripts/verify-android-artifacts.mjs <dir with GizeMate-<version>-android.apk/.aab> [--baseline-apk <earlier signed apk>] [--json out.json]
//
// Checks: apksigner verify (v2/v3 schemes, verified, not debug), signing certificate SHA-256, aapt2 badging
// (package name, versionName, versionCode, launcher label, permissions), jarsigner verify of the AAB and its
// certificate SHA-256 (must equal the APK's), SHA-256 and size of both files, and, when a baseline APK is
// given, that its certificate is the same (the update path: same applicationId + same key + higher versionCode).
// Exit code 1 on any failure. Nothing here prints a password or a key.
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dir = path.resolve(args.find((a) => !a.startsWith('--')) ?? '');
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const baseline = opt('--baseline-apk');
const jsonOut = opt('--json');

const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const props = fs.readFileSync(path.join(root, 'android', 'version.properties'), 'utf8');
const wantCode = /^versionCode=(\d+)/m.exec(props)?.[1];
const wantName = /^versionName=(.+)$/m.exec(props)?.[1]?.trim();
const apk = path.join(dir, `GizeMate-${version}-android.apk`);
const aab = path.join(dir, `GizeMate-${version}-android.aab`);

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk');
const bt = fs.readdirSync(path.join(sdk, 'build-tools')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop();
const apksigner = path.join(sdk, 'build-tools', bt, 'apksigner.bat');
const aapt2 = path.join(sdk, 'build-tools', bt, 'aapt2.exe');
const jbr = ['C:/Program Files/Android/Android Studio/jbr/bin', process.env.JAVA_HOME && path.join(process.env.JAVA_HOME, 'bin')].filter(Boolean).find((d) => fs.existsSync(path.join(d, 'jarsigner.exe')));
const tool = (name) => path.join(jbr, `${name}.exe`);
// apksigner.bat needs a JDK: use the same one, for the child processes only (never set user- or machine-wide).
const childEnv = { ...process.env, JAVA_HOME: path.resolve(jbr, '..') };

function run(cmd, a) {
  const useShell = cmd.endsWith('.bat');
  const r = spawnSync(useShell ? `"${cmd}"` : cmd, a, { encoding: 'utf8', shell: useShell, maxBuffer: 64 * 1024 * 1024, env: childEnv });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const failures = [];
const res = { version, versionName: wantName, versionCode: wantCode, tools: { buildTools: bt } };
const need = (cond, msg) => { if (!cond) failures.push(msg); };

for (const f of [apk, aab]) need(fs.existsSync(f), `missing ${path.basename(f)}`);
if (!failures.length) {
  res.files = Object.fromEntries([apk, aab].map((f) => [path.basename(f), { bytes: fs.statSync(f).size, sha256: sha(f) }]));

  const v = run(apksigner, ['verify', '--verbose', '--print-certs', apk]);
  const certOf = (text) => /certificate SHA-256 digest: ([0-9a-f]+)/i.exec(text)?.[1]?.toLowerCase() ?? null;
  res.apk = {
    verified: v.code === 0 && /^Verifies/m.test(v.out),
    schemes: Object.fromEntries([1, 2, 3, 4].map((n) => [`v${n}`, new RegExp(`scheme \\(v${n}\\)\\): true`, 'i').test(v.out) || new RegExp(`v${n} scheme.*: true`, 'i').test(v.out)])),
    signers: Number(/Number of signers: (\d+)/.exec(v.out)?.[1] ?? 0),
    certSha256: certOf(v.out),
    debugCert: /Android Debug/i.test(v.out),
  };
  need(res.apk.verified, 'apksigner verify failed');
  need(res.apk.schemes.v2 || res.apk.schemes.v3, 'neither APK signature scheme v2 nor v3 is present');
  need(res.apk.signers === 1, `expected 1 signer, got ${res.apk.signers}`);
  need(!res.apk.debugCert, 'the APK is signed with an Android debug certificate');

  const b = run(aapt2, ['dump', 'badging', apk]);
  const pkg = /package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/.exec(b.out);
  res.badging = {
    package: pkg?.[1] ?? null,
    versionCode: pkg?.[2] ?? null,
    versionName: pkg?.[3] ?? null,
    label: /application-label:'([^']*)'/.exec(b.out)?.[1] ?? null,
    labelTr: /application-label-tr:'([^']*)'/.exec(b.out)?.[1] ?? null,
    minSdk: /sdkVersion:'(\d+)'/.exec(b.out)?.[1] ?? null,
    targetSdk: /targetSdkVersion:'(\d+)'/.exec(b.out)?.[1] ?? null,
    permissions: [...b.out.matchAll(/uses-permission: name='([^']+)'/g)].map((m) => m[1]).sort(),
    debuggable: /application-debuggable/.test(b.out),
  };
  need(res.badging.package === 'io.github.gizeverse.gizecat', `package is ${res.badging.package}, expected io.github.gizeverse.gizecat (applicationId must not change)`);
  need(res.badging.versionCode === wantCode, `versionCode ${res.badging.versionCode} differs from android/version.properties ${wantCode}`);
  need(res.badging.versionName === wantName, `versionName ${res.badging.versionName} differs from ${wantName}`);
  need(res.badging.label === 'GizeMate', `launcher label is ${res.badging.label}, expected GizeMate`);
  need(!res.badging.debuggable, 'the APK is debuggable');

  const j = run(tool('jarsigner'), ['-verify', '-verbose', '-certs', aab]);
  const k = run(tool('keytool'), ['-printcert', '-jarfile', aab]);
  const aabCert = /SHA256: ([0-9A-F:]+)/.exec(k.out)?.[1]?.replace(/:/g, '').toLowerCase() ?? null;
  res.aab = { jarsignerVerified: /jar verified/i.test(j.out), certSha256: aabCert, debugCert: /Android Debug/i.test(k.out) };
  need(res.aab.jarsignerVerified, 'jarsigner did not verify the AAB');
  need(!res.aab.debugCert, 'the AAB is signed with an Android debug certificate');
  need(res.aab.certSha256 !== null && res.aab.certSha256 === res.apk.certSha256, 'the AAB and the APK are signed with different certificates');

  if (baseline) {
    const bv = run(apksigner, ['verify', '--print-certs', baseline]);
    const bb = run(aapt2, ['dump', 'badging', baseline]);
    const bp = /package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/.exec(bb.out);
    res.baseline = { file: path.basename(baseline), package: bp?.[1] ?? null, versionCode: bp?.[2] ?? null, versionName: bp?.[3] ?? null, certSha256: certOf(bv.out) };
    res.upgradeFromBaseline = {
      samePackage: res.baseline.package === res.badging.package,
      sameCertificate: res.baseline.certSha256 !== null && res.baseline.certSha256 === res.apk.certSha256,
      higherVersionCode: Number(res.badging.versionCode) > Number(res.baseline.versionCode),
    };
    need(res.upgradeFromBaseline.samePackage && res.upgradeFromBaseline.sameCertificate && res.upgradeFromBaseline.higherVersionCode, 'the APK would not install over the baseline (package, certificate or versionCode)');
  }
}
res.failures = failures;
res.ok = failures.length === 0;
const text = JSON.stringify(res, null, 2);
if (jsonOut) fs.writeFileSync(jsonOut, `${text}\n`);
console.log(text);
process.exit(res.ok ? 0 : 1);
