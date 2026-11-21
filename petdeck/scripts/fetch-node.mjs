#!/usr/bin/env node
// Fetch the official Node.js Windows x64 runtime bundled with PetDeck.
//
// The sidecar is an unmodified node.exe from nodejs.org. This script verifies
// the official SHA256, extracts only node.exe plus its LICENSE, and records the
// pinned hashes in node-runtime.json. Generated binaries are never committed.

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CACHE_DIR = path.join(ROOT, ".cache", "node");
const BIN_DIR = path.join(ROOT, "src-tauri", "binaries");
const TARGET = path.join(BIN_DIR, "node-x86_64-pc-windows-msvc.exe");
const LICENSE_DIR = path.join(ROOT, "src-tauri", "resources", "third-party", "nodejs");
const META_FILE = path.join(ROOT, "node-runtime.json");

const NODE_VERSION = "24.18.0";
const PLATFORM = "win-x64";
const ARCHIVE_NAME = `node-v${NODE_VERSION}-${PLATFORM}.zip`;
const ARCHIVE_ROOT = `node-v${NODE_VERSION}-${PLATFORM}`;
const DIST_BASE = `https://nodejs.org/dist/v${NODE_VERSION}`;
const SHASUMS_URL = `${DIST_BASE}/SHASUMS256.txt`;
const ARCHIVE_URL = `${DIST_BASE}/${ARCHIVE_NAME}`;
const EXE_MEMBER = `${ARCHIVE_ROOT}/node.exe`;
const LICENSE_MEMBER = `${ARCHIVE_ROOT}/LICENSE`;
const THIRD_PARTY_MARKER = "The externally maintained libraries used by Node.js are:";

const force = process.argv.includes("--force");
const quiet = process.argv.includes("--quiet");

function log(message) {
  if (!quiet) process.stdout.write(`[fetch-node] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[fetch-node] ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

async function fetchBuffer(url) {
  log(`GET ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    fail(`download failed: HTTP ${response.status} for ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.error) fail(`${command} failed: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${command} exited ${result.status}: ${(result.stderr || "").trim()}`);
  }
  return (result.stdout || "").trim();
}

function nodeVersionOf(file) {
  try {
    const version = run(file, ["--version"], { timeout: 20_000 });
    return version.startsWith("v") ? version : `v${version}`;
  } catch {
    return null;
  }
}

function cachedRuntimeOkay(meta) {
  if (force) return false;
  if (!meta || meta.version !== NODE_VERSION) return false;
  if (!fs.existsSync(TARGET) || !fs.existsSync(path.join(LICENSE_DIR, "LICENSE"))) return false;
  if (!fs.existsSync(path.join(LICENSE_DIR, "THIRD_PARTY_LICENSES"))) return false;
  const actual = sha256File(TARGET);
  if (actual !== meta.node?.sha256) {
    log("cached node.exe hash changed; fetching again");
    return false;
  }
  const version = nodeVersionOf(TARGET);
  if (!version || version !== `v${NODE_VERSION}`) {
    log(`cached node.exe reports ${version || "no version"}; fetching again`);
    return false;
  }
  log(`cached v${NODE_VERSION} ${(meta.node.bytes / 1024 / 1024).toFixed(1)} MB`);
  return true;
}

async function ensureArchive(meta) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const archiveFile = path.join(CACHE_DIR, ARCHIVE_NAME);
  let expected = typeof meta?.archiveSha256 === "string" ? meta.archiveSha256 : "";
  let officialShasums = "";

  if (!expected) {
    officialShasums = run("curl.exe", ["-sS", "--fail", SHASUMS_URL], { timeout: 60_000 });
  }

  if (fs.existsSync(archiveFile)) {
    const actual = sha256File(archiveFile);
    if (expected && actual === expected) {
      log(`cached archive ${ARCHIVE_NAME}`);
      return { archiveFile, sha: actual };
    }
    if (!expected) {
      const line = officialShasums
        .split(/\r?\n/)
        .find((entry) => entry.endsWith(` ${ARCHIVE_NAME}`) || entry.endsWith(` *${ARCHIVE_NAME}`));
      if (line && line.split(/\s+/)[0] === actual) {
        log(`cached archive ${ARCHIVE_NAME}`);
        return { archiveFile, sha: actual };
      }
    }
    log("cached archive does not match the pinned hash; downloading again");
    fs.rmSync(archiveFile, { force: true });
  }

  if (!officialShasums) {
    officialShasums = run("curl.exe", ["-sS", "--fail", SHASUMS_URL], { timeout: 60_000 });
  }
  const line = officialShasums
    .split(/\r?\n/)
    .find((entry) => entry.endsWith(` ${ARCHIVE_NAME}`) || entry.endsWith(` *${ARCHIVE_NAME}`));
  if (!line) fail(`${ARCHIVE_NAME} is not listed in ${SHASUMS_URL}`);
  expected = line.split(/\s+/)[0];
  if (!/^[0-9a-f]{64}$/.test(expected)) fail("official SHA256 line is malformed");
  if (meta?.archiveSha256 && meta.archiveSha256 !== expected) {
    fail(
      `node-runtime.json pins archive SHA256 ${meta.archiveSha256} but nodejs.org reports ${expected}; update node-runtime.json deliberately`,
    );
  }

  const buffer = await fetchBuffer(ARCHIVE_URL);
  const actual = sha256(buffer);
  if (actual !== expected) {
    fail(`archive SHA256 mismatch: expected ${expected}, got ${actual}`);
  }
  fs.writeFileSync(archiveFile, buffer);
  log(`downloaded ${ARCHIVE_NAME} (${(buffer.length / 1024 / 1024).toFixed(1)} MB, sha256 verified)`);
  return { archiveFile, sha: actual };
}

function extract(archiveFile) {
  const extractDir = path.join(CACHE_DIR, "extract");
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  run("tar", ["-xf", archiveFile, "-C", extractDir, "--strip-components=1", EXE_MEMBER, LICENSE_MEMBER], {
    timeout: 180_000,
  });
  const exe = path.join(extractDir, "node.exe");
  const license = path.join(extractDir, "LICENSE");
  if (!fs.existsSync(exe)) fail("node.exe missing after extraction");
  if (!fs.existsSync(license)) fail("LICENSE missing after extraction");
  return { exe, license };
}

function writeLicenses(licenseFile) {
  fs.mkdirSync(LICENSE_DIR, { recursive: true });
  const licenseText = fs.readFileSync(licenseFile, "utf8");
  fs.writeFileSync(path.join(LICENSE_DIR, "LICENSE"), licenseText);

  const markerAt = licenseText.indexOf(THIRD_PARTY_MARKER);
  if (markerAt < 0) fail("could not locate the third-party license section in the official LICENSE");
  const header = [
    `Third-party licenses for Node.js v${NODE_VERSION}, bundled with PetDeck.`,
    "",
    "The text below is extracted verbatim from the official Node.js LICENSE file:",
    `https://github.com/nodejs/node/blob/v${NODE_VERSION}/LICENSE`,
    "",
    "Node.js itself is licensed under the MIT license; see LICENSE in this folder.",
    "",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(LICENSE_DIR, "THIRD_PARTY_LICENSES"), header + licenseText.slice(markerAt));
}

async function main() {
  const meta = readJson(META_FILE);
  if (cachedRuntimeOkay(meta)) return;

  const { archiveFile, sha } = await ensureArchive(meta);
  const { exe, license } = extract(archiveFile);

  fs.mkdirSync(BIN_DIR, { recursive: true });
  fs.copyFileSync(exe, TARGET);
  writeLicenses(license);

  const nodeBytes = fs.statSync(TARGET).size;
  const nodeSha = sha256File(TARGET);
  const version = nodeVersionOf(TARGET);
  if (version !== `v${NODE_VERSION}`) {
    fail(`bundled node.exe reports ${version || "no version"}, expected v${NODE_VERSION}`);
  }

  const next = {
    version: NODE_VERSION,
    platform: PLATFORM,
    archive: ARCHIVE_NAME,
    archiveSha256: sha,
    archiveBytes: fs.statSync(archiveFile).size,
    node: { file: "node.exe", sha256: nodeSha, bytes: nodeBytes },
    source: SHASUMS_URL,
    license: "MIT",
    licenses: ["LICENSE", "THIRD_PARTY_LICENSES"],
  };
  fs.writeFileSync(META_FILE, `${JSON.stringify(next, null, 2)}\n`);
  log(
    `ready v${NODE_VERSION} node.exe ${(nodeBytes / 1024 / 1024).toFixed(1)} MB (sha256 ${nodeSha.slice(0, 12)}…)`,
  );
}

main().catch((error) => {
  if (!process.exitCode) process.exitCode = 1;
  if (!String(error?.message || error).startsWith("[fetch-node]")) {
    process.stderr.write(`[fetch-node] ${error?.stack || error}\n`);
  }
});
