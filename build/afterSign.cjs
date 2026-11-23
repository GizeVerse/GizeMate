// electron-builder afterSign hook (Windows only).
//
// Windows lists an app in Task Manager > Startup apps and in some Settings pages by the exe's version
// resource (FileDescription / ProductName). electron-builder fills both from `productName`, and `productName`
// is frozen ("Desktop Cat": it is app.getName(), the userData folder, the encrypted-key scope and the default
// install folder; see src/shared/identity.ts). The name people see is GizeMate (src/shared/brand.ts), so this
// hook rewrites those two display strings in the packaged exe and nothing else: no identifier, path or
// executable name changes, and the exe is not renamed.
//
// It must run at afterSign, not afterPack: electron-builder writes the exe's version strings (from productName) after
// afterPack, which would overwrite this. The editor is the same in-process one electron-builder uses (`resedit`).
// afterSign runs after any code signing of the exe, so a certificate for the exe itself would be invalidated by this edit;
// the project signs the installers, not the inner exe (docs/platforms/windows-signing.md). scripts/inspect-installer.mjs
// fails when the strings are wrong, and the packaged-app smoke tests launch the edited exe.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { NtExecutable, NtExecutableResource, Resource } = require('resedit');

const DISPLAY_NAME = 'GizeMate';

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'win32') return;
  const opts = context.packager.platformSpecificBuildOptions;
  const exeName = `${opts.executableName || context.packager.appInfo.productFilename}.exe`;
  const file = path.join(context.appOutDir, exeName);
  if (!fs.existsSync(file)) throw new Error(`afterSign: ${file} not found`);

  const executable = NtExecutable.from(fs.readFileSync(file));
  const res = NtExecutableResource.from(executable);
  const list = Resource.VersionInfo.fromEntries(res.entries);
  if (list.length === 0) throw new Error('afterSign: the exe has no version resource');
  const vi = list[0];
  const languages = vi.getAllLanguagesForStringValues();
  const lang = languages.length > 0 ? languages[0] : { lang: 0x0409, codepage: 1200 };
  vi.setStringValues(lang, { FileDescription: DISPLAY_NAME, ProductName: DISPLAY_NAME });
  vi.outputToResourceEntries(res.entries);
  res.outputResource(executable);
  fs.writeFileSync(file, Buffer.from(executable.generate()));
  console.log(`  • afterSign: ${exeName} FileDescription and ProductName set to ${DISPLAY_NAME}`);
};
