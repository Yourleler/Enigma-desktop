import fs from "node:fs/promises";
import path from "node:path";
import { hash } from "enigma-next/storage";
import {
  withProcessBoundary,
  type ProcessBoundary,
} from "enigma-next/execution-boundary";
import type { Workspace } from "enigma-next";
import { deriveSandboxPolicy } from "../../lib/sandbox/policy.ts";
import { PathGuard } from "../../lib/sandbox/path-guard.ts";
import { generateProfile } from "../../lib/sandbox/seatbelt.ts";

const cache = new WeakMap<object, Map<string, Promise<ProcessBoundary>>>();
export function nativeEngineeringPolicy(
  engine: any,
  workspace: Workspace,
  sessionPath: string,
) {
  const preferences = engine.getEngineeringExecutionPreferences();
  const policy = deriveSandboxPolicy({
    agentDir: path.dirname(path.dirname(sessionPath)),
    cwd: workspace.root,
    workspace: workspace.root,
    workspaceFolders: workspace.config.repos.map((repo) => repo.root),
    hanakoHome: engine.hanakoHome,
    mode: "standard",
  });
  const readOnlyRepos = workspace.config.repos
    .filter((repo) => repo.access !== "write")
    .map((repo) => repo.root);
  policy.protectedPaths.push(
    ...readOnlyRepos,
    workspace.data,
    path.dirname(sessionPath),
    ...[
      "workspace.json",
      "checkpoints",
      "blobs",
      "plans",
      "memory",
      "task-readings",
      "change-readings",
      "artifacts",
      "source-index",
      "readings",
    ].map((name) => path.join(workspace.data, name)),
    path.join(engine.hanakoHome, "plugin-data", "enigma", "policies"),
  );
  const guard = new PathGuard(
    preferences.sandbox ? policy : { mode: "full-access" },
  );
  workspace.pathPolicy = (file, access) => {
    const result = guard.check(file, access);
    if (!result.allowed)
      throw new Error(
        result.reason || "Native host resource permission denied",
      );
    if (
      access === "write" &&
      readOnlyRepos.some(
        (root) => file === root || file.startsWith(root + path.sep),
      )
    )
      throw new Error("Repository is read-only");
  };
  return { preferences, policy, guard };
}

async function boundary(
  engine: any,
  workspace: Workspace,
  sessionPath: string,
): Promise<ProcessBoundary> {
  const { preferences, policy } = nativeEngineeringPolicy(
    engine,
    workspace,
    sessionPath,
  );
  const key = hash(JSON.stringify({ preferences, policy }));
  let entries = cache.get(engine);
  if (!entries) {
    entries = new Map();
    cache.set(engine, entries);
  }
  let value = entries.get(key);
  if (!value) {
    value = (async () => {
      if (!preferences.sandbox)
        return {
          schema: 1,
          kind: "explicit-host",
          prefix: [],
          denyReadPaths: [],
          readOnlyPaths: [],
        } as ProcessBoundary;
      if (process.platform !== "darwin")
        throw new Error(
          "Enigma native execution is currently verified only on Mac; the sandbox will not fall back to unrestricted execution",
        );
      const directory = path.join(
        engine.hanakoHome,
        "plugin-data",
        "enigma",
        "policies",
      );
      await fs.mkdir(directory, { recursive: true });
      const file = path.join(directory, `${key}.sb`),
        contents = generateProfile(policy, {
          allowNetwork: preferences.network,
          allowLocalServers:preferences.localServers===true,
        });
      try {
        await fs.writeFile(file, contents, { mode: 0o600, flag: "wx" });
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "EEXIST" ||
          (await fs.readFile(file, "utf8")) !== contents
        )
          throw error;
      }
      return {
        schema: 1,
        kind: "seatbelt",
        prefix: [
          "/usr/bin/sandbox-exec",
          "-f",
          file,
          "/bin/bash",
          "-c",
          'exec "$@"',
          "--",
        ],
        denyReadPaths: policy.denyReadPaths,
        readOnlyPaths: [...policy.protectedPaths, ...policy.readablePaths],
      } as ProcessBoundary;
    })();
    entries.set(key, value);
    value.catch(() => entries?.delete(key));
  }
  return value;
}

export async function withNativeEngineeringExecution<T>(
  engine: any,
  workspace: Workspace,
  sessionPath: string,
  action: () => Promise<T>,
): Promise<T> {
  return withProcessBoundary(
    await boundary(engine, workspace, sessionPath),
    action,
  );
}
