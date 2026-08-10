#!/usr/bin/env node
/**
 * Pre-push / pre-deploy sanity checks: git hygiene and obvious env footguns.
 * Does not print secret values.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function readGitignorePatterns() {
  const p = path.join(root, ".gitignore");
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

function gitTrackedFiles() {
  try {
    return execSync("git ls-files", {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

function main() {
  let exitCode = 0;
  const patterns = readGitignorePatterns();

  const requiredPatterns = [".env", "*.sqlite"];
  for (const req of requiredPatterns) {
    const ok = patterns.some(
      (line) => line === req || line === req.replace("*", "") || line.includes(req)
    );
    if (!ok) {
      console.warn(
        `[deploy-check] Warning: add "${req}" (or equivalent) to .gitignore`
      );
    }
  }

  const tracked = gitTrackedFiles();
  if (tracked === null) {
    console.log(
      "[deploy-check] No git repository or git unavailable — skipping tracked-files check"
    );
  } else {
    const blocked = tracked.filter(
      (f) =>
        f === ".env" ||
        f.endsWith(".env.local") ||
        f.endsWith(".sqlite") ||
        f.endsWith(".sqlite3") ||
        f.endsWith(".db")
    );
    if (blocked.length) {
      console.error(
        "[deploy-check] BLOCKED: never commit secrets or database files:",
        blocked.join(", ")
      );
      exitCode = 1;
    }
  }

  const envPath = path.join(root, ".env");
  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, "utf8");
    const jwtLine = raw
      .split("\n")
      .find((l) => /^JWT_SECRET=/i.test(l.trim()));
    if (jwtLine) {
      const val = jwtLine.split("=").slice(1).join("=").trim();
      if (
        !val ||
        val.length < 24 ||
        /replace_me|dev_secret/i.test(val)
      ) {
        console.warn(
          "[deploy-check] Warning: JWT_SECRET in .env looks missing, short, or like a placeholder"
        );
      }
    }
  }

  console.log("[deploy-check] Finished");
  process.exit(exitCode);
}

main();
