/**
 * Unit tests for src-tauri/capabilities/*.json (issue #1274).
 *
 * Enforces the least-privilege contract documented in CONTRIBUTING.md
 * § "Adding a Tauri permission":
 *   - The blanket `core:default` permission is banned.
 *   - Every granted plugin identifier must correspond to a plugin the
 *     frontend actually imports (no over-grant).
 *   - The main window's identifier must match the window declared in
 *     src-tauri/tauri.conf.json.
 *
 * These tests run in plain Node (no Tauri runtime required) so they fail
 * fast in CI without spinning up a webview.
 */

import * as fs from "fs";
import * as path from "path";

type Capability = {
  identifier: string;
  description?: string;
  windows: string[];
  permissions: string[];
};

const REPO_ROOT = path.resolve(__dirname, "..");
const CAPABILITIES_DIR = path.join(REPO_ROOT, "src-tauri", "capabilities");
const TAURI_CONF = path.join(REPO_ROOT, "src-tauri", "tauri.conf.json");

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function listCapabilities(): { file: string; cap: Capability }[] {
  const files = fs
    .readdirSync(CAPABILITIES_DIR)
    .filter((f) => f.endsWith(".json"));
  return files.map((file) => ({
    file,
    cap: readJson(path.join(CAPABILITIES_DIR, file)) as Capability,
  }));
}

function listTauriPluginImports(): Set<string> {
  // Audit imports of `@tauri-apps/plugin-<name>` across the frontend tree.
  // Restrict to well-known source roots so vendor transpiled output is ignored.
  const roots = ["src", "ai", "e2e", "tests", "scripts"];
  const plugins = new Set<string>();
  const importRegex = /@tauri-apps\/plugin-([a-z0-9-]+)/g;
  const requireRegex = /require\(["']@tauri-apps\/plugin-([a-z0-9-]+)["']\)/g;

  function walk(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        walk(full);
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
        const text = fs.readFileSync(full, "utf8");
        for (const m of text.matchAll(importRegex)) plugins.add(m[1]);
        for (const m of text.matchAll(requireRegex)) plugins.add(m[1]);
      }
    }
  }

  for (const root of roots) walk(path.join(REPO_ROOT, root));
  return plugins;
}

describe("Tauri capability allow-list (issue #1274)", () => {
  const caps = listCapabilities();
  const conf = readJson(TAURI_CONF) as {
    app?: { windows?: { label?: string }[] };
    plugins?: Record<string, unknown>;
    build?: { frontendDist?: string };
  };

  test("at least one capability file is present", () => {
    expect(caps.length).toBeGreaterThan(0);
  });

  test.each(caps.map((c) => [c.file, c.cap]))(
    "%s does not grant the umbrella `core:default`",
    (_file, cap) => {
      expect(cap.permissions).not.toContain("core:default");
    },
  );

  test("every granted `core:*` sub-permission is intentional (no typos, no unused)", () => {
    const allowedCoreSubs = new Set([
      "core:app:default",
      "core:event:default",
      "core:webview:default",
      "core:window:default",
    ]);
    for (const { cap } of caps) {
      for (const perm of cap.permissions) {
        if (!perm.startsWith("core:")) continue;
        expect(allowedCoreSubs.has(perm)).toBe(true);
      }
    }
  });

  test("the capability windows array is non-empty", () => {
    for (const { cap } of caps) {
      expect(Array.isArray(cap.windows)).toBe(true);
      expect(cap.windows.length).toBeGreaterThan(0);
    }
  });

  test("every capability window references a window declared in tauri.conf.json", () => {
    // Tauri's main window is referenced by label; the frontend-configured
    // window has no explicit label, which Tauri defaults to "main" — keep
    // the test loose so adding a label later is a one-line edit.
    const configuredLabels = new Set(
      (conf.app?.windows ?? []).map((w) => w.label ?? "main"),
    );
    configuredLabels.add("main");
    for (const { cap } of caps) {
      for (const win of cap.windows) {
        expect(configuredLabels.has(win)).toBe(true);
      }
    }
  });

  test("no plugin permission is granted for a plugin the frontend does not import", () => {
    const importedPlugins = listTauriPluginImports();
    // Plugin permissions look like `<plugin>:<scope>`. Extract the plugin
    // prefix (everything before the first `:`).
    for (const { cap } of caps) {
      for (const perm of cap.permissions) {
        if (perm.startsWith("core:")) continue;
        // Permissions to first-party Tauri features outside `core:*` are
        // namespaced via the plugin name followed by `:`. Treat any
        // non-`core:` permission as a plugin grant.
        const pluginName = perm.split(":")[0];
        if (pluginName === "core") continue;
        // Empty tree means no plugin imports — every non-core permission is
        // over-grant. A populated set narrows the check to "only what is
        // actually used".
        const hasImport = importedPlugins.has(pluginName);
        if (!hasImport) {
          throw new Error(
            `permission ${perm} granted but @tauri-apps/plugin-${pluginName} is never imported by the frontend`,
          );
        }
        expect(hasImport).toBe(true);
      }
    }
  });
});
