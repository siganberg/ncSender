// electron-builder afterPack hook (runs before signing).
//
// macOS 15+ keys Local Network permission on the main executable's Mach-O
// LC_UUID as well as the bundle ID. electron-builder ships Electron's stock
// prebuilt binaries, so every app on the same Electron build has the same
// UUID; when another one (gSender, for one) already has a Local Network entry,
// macOS finds that app's bundle ID under our UUID, never prompts, and silently
// blocks ncSender's connections to the controller with "No route to host"
// (issue #93). Give the app and its helpers their own UUIDs.
//
// The new UUID is derived from the app ID and the stock UUID, so it is stable
// across ncSender releases on the same Electron (the permission the user
// granted keeps working after an update) and unique to ncSender.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FAT_MAGIC = 0xcafebabe;
const FAT_MAGIC_64 = 0xcafebabf;
const MH_MAGIC_64 = 0xfeedfacf;
const LC_UUID = 0x1b;

// Rewrites LC_UUID in the thin 64-bit Mach-O starting at `base`; returns the
// [old, new] UUIDs, or null when the slice has none.
function patchSlice(buf, base, appId) {
  if (buf.readUInt32LE(base) !== MH_MAGIC_64) throw new Error(`unsupported Mach-O slice at ${base}`);
  const ncmds = buf.readUInt32LE(base + 16);
  let off = base + 32; // sizeof(mach_header_64)
  for (let i = 0; i < ncmds; i++) {
    const cmd = buf.readUInt32LE(off);
    const size = buf.readUInt32LE(off + 4);
    if (cmd === LC_UUID) {
      const old = Buffer.from(buf.subarray(off + 8, off + 24));
      const next = crypto.createHash('sha256').update(`${appId}:${old.toString('hex')}`).digest().subarray(0, 16);
      next[6] = (next[6] & 0x0f) | 0x50; // RFC 4122 version 5 / variant bits
      next[8] = (next[8] & 0x3f) | 0x80;
      next.copy(buf, off + 8);
      return [old, next];
    }
    off += size;
  }
  return null;
}

function patchExecutable(file, appId) {
  const buf = fs.readFileSync(file);
  const magic = buf.readUInt32BE(0);
  const results = [];
  if (magic === FAT_MAGIC || magic === FAT_MAGIC_64) {
    const count = buf.readUInt32BE(4);
    const entry = magic === FAT_MAGIC ? 20 : 32;
    for (let i = 0; i < count; i++) {
      const e = 8 + i * entry;
      const offset = magic === FAT_MAGIC ? buf.readUInt32BE(e + 8) : Number(buf.readBigUInt64BE(e + 8));
      results.push(patchSlice(buf, offset, appId));
    }
  } else {
    results.push(patchSlice(buf, 0, appId));
  }
  fs.writeFileSync(file, buf);
  return results.filter(Boolean);
}

const fmt = (b) => {
  const h = b.toString('hex').toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appInfo = context.packager.appInfo;
  const appId = appInfo.id;
  const app = path.join(context.appOutDir, `${appInfo.productFilename}.app`);

  // The app's own executable plus every helper app (the network service
  // runs in one of them).
  const executables = [path.join(app, 'Contents', 'MacOS', appInfo.productFilename)];
  const frameworks = path.join(app, 'Contents', 'Frameworks');
  for (const entry of fs.readdirSync(frameworks)) {
    if (!entry.endsWith('.app')) continue;
    const macos = path.join(frameworks, entry, 'Contents', 'MacOS');
    for (const exe of fs.readdirSync(macos)) executables.push(path.join(macos, exe));
  }

  for (const exe of executables) {
    const patched = patchExecutable(exe, appId);
    if (patched.length === 0) throw new Error(`no LC_UUID in ${exe}`);
    for (const [from, to] of patched) {
      console.log(`  • LC_UUID ${path.basename(exe)}: ${fmt(from)} -> ${fmt(to)}`);
    }
  }
};
