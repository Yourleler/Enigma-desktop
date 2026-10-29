import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const rootDir = process.cwd();

function readWorkflow(name: string) {
  return fs.readFileSync(path.join(rootDir, ".github", "workflows", name), "utf-8");
}

describe("release mirror workflows", () => {
  it("mirrors the published tag to AtomGit after the release job succeeds", () => {
    const workflow = readWorkflow("build.yml");

    expect(workflow).toContain("mirror-atomgit:");
    expect(workflow).toContain("needs: release");
    expect(workflow).toContain("ATOMGIT_REPO: OpenHanako-Releases");
    expect(workflow).toContain("node scripts/mirror-release-to-atomgit.mjs --tag \"${{ github.ref_name }}\"");
    expect(workflow).not.toContain("node scripts/mirror-release-to-atomgit.mjs --newest");
    expect(workflow).not.toContain("node scripts/mirror-release-to-atomgit.mjs --latest");
  });

  it("does not reference the standalone mirror workflow removed upstream", () => {
    // Removed deliberately by upstream 85f59fd0. The retained build workflow
    // still has its exact-tag contract above; do not recreate automation to
    // satisfy a stale file-existence assertion in this private fork.
    const removed = "mirror-release-to-atomgit.yml";
    expect(fs.existsSync(path.join(rootDir, ".github", "workflows", removed))).toBe(false);
    for (const file of fs.readdirSync(path.join(rootDir, ".github", "workflows"))) {
      if (file.endsWith(".yml") || file.endsWith(".yaml")) {
        expect(readWorkflow(file)).not.toContain(`uses: ./.github/workflows/${removed}`);
      }
    }
  });
});
