/**
 * @fileOverview Build the Tauri 2 `latest.json` updater manifest (issue #1403).
 *
 * After `tauri build` runs with `bundle.createUpdaterArtifacts: true`, every
 * installer has a sibling `.sig` file containing the minisign-style
 * signature Tauri uses to verify the binary at install time. This script
 * walks those `.sig` files, reads each signature, and emits a single
 * `latest.json` file in the format the `@tauri-apps/plugin-updater`
 * `check()` expects when the endpoint is a static JSON.
 *
 * Usage (from CI):
 *
 *   node --experimental-strip-types scripts/build-latest-json.ts \
 *     --bundle-dir src-tauri/target/release/bundle \
 *     --repo anchapin/planar-nexus \
 *     --version 1.0.0 \
 *     --out latest.json
 *
 * Output schema:
 *   {
 *     "version":   "1.0.0",
 *     "notes":     "<optional release-notes file>",
 *     "pub_date":  "<RFC 3339>",
 *     "platforms": {
 *       "windows-x86_64": { "signature": "...", "url": "..." },
 *       "linux-x86_64":   { "signature": "...", "url": "..." },
 *       ...
 *     }
 *   }
 */

import * as fs from "fs";
import * as path from "path";

type PlatformKey =
  | "darwin-x86_64"
  | "darwin-aarch64"
  | "linux-x86_64"
  | "linux-aarch64"
  | "linux-i686"
  | "linux-armv7"
  | "windows-x86_64"
  | "windows-aarch64"
  | "windows-i686";

interface PlatformEntry {
  signature: string;
  url: string;
}

interface LatestManifest {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Partial<Record<PlatformKey, PlatformEntry>>;
}

// ---------------------------------------------------------------------------
// argv parsing (intentionally tiny — no external deps)
// ---------------------------------------------------------------------------

interface CliArgs {
  bundleDir: string;
  repo: string;
  version: string;
  outFile: string;
  notesFile: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> = {};
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (!flag?.startsWith("--") || next === undefined) continue;
    switch (flag) {
      case "--bundle-dir":
        args.bundleDir = next;
        i++;
        break;
      case "--repo":
        args.repo = next;
        i++;
        break;
      case "--version":
        args.version = next;
        i++;
        break;
      case "--out":
        args.outFile = next;
        i++;
        break;
      case "--notes":
        args.notesFile = next;
        i++;
        break;
    }
  }
  const missing = (["bundleDir", "repo", "version", "outFile"] as const).filter(
    (k) => !args[k],
  );
  if (missing.length > 0) {
    throw new Error(`Missing required flags: ${missing.join(", ")}`);
  }
  return args as CliArgs;
}

// ---------------------------------------------------------------------------
// artifact discovery
// ---------------------------------------------------------------------------

const BUNDLE_TO_PLATFORM: Record<string, PlatformKey> = {
  nsis: "windows-x86_64",
  msi: "windows-x86_64",
  appimage: "linux-x86_64",
  deb: "linux-x86_64",
  rpm: "linux-x86_64",
  dmg: "darwin-x86_64",
  macos: "darwin-x86_64",
};

interface Artifact {
  platform: PlatformKey;
  bundlePath: string;
  signaturePath: string;
  filename: string;
}

function discoverArtifacts(bundleDir: string): Artifact[] {
  const out: Artifact[] = [];
  for (const [subdir, platform] of Object.entries(BUNDLE_TO_PLATFORM)) {
    const fullDir = path.join(bundleDir, subdir);
    if (!fs.existsSync(fullDir)) continue;
    for (const entry of fs.readdirSync(fullDir)) {
      // Tauri 2 emits `<name>.sig` next to each installer.
      if (entry.endsWith(".sig")) continue;
      const sigCandidate = path.join(fullDir, `${entry}.sig`);
      if (!fs.existsSync(sigCandidate)) continue;
      out.push({
        platform,
        bundlePath: path.join(fullDir, entry),
        signaturePath: sigCandidate,
        filename: entry,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);
  const artifacts = discoverArtifacts(args.bundleDir);
  if (artifacts.length === 0) {
    throw new Error(
      `No signed artifacts found under ${args.bundleDir}. Did tauri build run with bundle.createUpdaterArtifacts=true and TAURI_SIGNING_PRIVATE_KEY set?`,
    );
  }

  const platforms: Partial<Record<PlatformKey, PlatformEntry>> = {};
  for (const art of artifacts) {
    // First .sig wins for each platform — multiple installers (nsis + msi)
    // for the same target should not stomp each other; nsis is preferred
    // because it's what the GitHub release workflow advertises first.
    if (platforms[art.platform]) continue;
    const sig = fs.readFileSync(art.signaturePath, "utf8").trim();
    const url = `https://github.com/${args.repo}/releases/latest/download/${art.filename}`;
    platforms[art.platform] = { signature: sig, url };
  }

  let notes = "";
  if (args.notesFile && fs.existsSync(args.notesFile)) {
    notes = fs.readFileSync(args.notesFile, "utf8").trim();
  }

  const manifest: LatestManifest = {
    version: args.version.replace(/^v/, ""),
    notes,
    pub_date: new Date().toISOString(),
    platforms,
  };

  fs.mkdirSync(path.dirname(args.outFile), { recursive: true });
  fs.writeFileSync(
    args.outFile,
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );
  // Single line on stdout so the GH Actions step can `tee` it without
  // flooding the build log.
  console.log(
    `wrote ${args.outFile} covering ${Object.keys(platforms).length} platforms`,
  );
}

main();
