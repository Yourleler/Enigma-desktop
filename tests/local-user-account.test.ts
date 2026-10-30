import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hana-local-user-account-"));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function writeUsers(root) {
  writeJson(path.join(root, "users.json"), {
    schemaVersion: 1,
    defaultUserId: "user_owner",
    users: [{
      userId: "user_owner",
      kind: "legacy_owner",
      displayName: "Owner",
      profileSource: "legacy_user_profile",
      createdAt: "2026-05-16T00:00:00.000Z",
      updatedAt: "2026-05-16T00:00:00.000Z",
    }],
    createdAt: "2026-05-16T00:00:00.000Z",
    updatedAt: "2026-05-16T00:00:00.000Z",
  });
}

describe("local user account store", () => {
  let tmpDir = null;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  });

  it("updates the default user profile without losing legacy fields", async () => {
    tmpDir = makeTmpDir();
    writeUsers(tmpDir);
    const { updateLocalAccountProfile, getLocalAccountSummary } = await import("../core/local-user-account.ts");

    const profile = updateLocalAccountProfile(tmpDir, {
      username: "hana-owner",
      displayName: "Hana Owner",
      now: "2026-05-16T01:00:00.000Z",
    });

    expect(profile).toMatchObject({
      userId: "user_owner",
      username: "hana-owner",
      displayName: "Hana Owner",
    });
    expect(getLocalAccountSummary(tmpDir)).toMatchObject({
      userId: "user_owner",
      username: "hana-owner",
      displayName: "Hana Owner",
    });
    const stored = JSON.parse(fs.readFileSync(path.join(tmpDir, "users.json"), "utf-8"));
    expect(stored.users[0]).toMatchObject({
      kind: "legacy_owner",
      profileSource: "legacy_user_profile",
      username: "hana-owner",
      displayName: "Hana Owner",
      updatedAt: "2026-05-16T01:00:00.000Z",
    });
  });

  it("ignores obsolete password storage when reading and updating the profile", async () => {
    tmpDir = makeTmpDir();
    writeUsers(tmpDir);
    const legacyPath = path.join(tmpDir, "local-user-auth.json");
    // Even corrupt retired credential data must not block local settings.
    fs.writeFileSync(legacyPath, "obsolete invalid credential data");
    const { getLocalAccountSummary, updateLocalAccountProfile } = await import("../core/local-user-account.ts");
    expect(getLocalAccountSummary(tmpDir)).toMatchObject({ userId: "user_owner", displayName: "Owner" });
    expect(getLocalAccountSummary(tmpDir)).not.toHaveProperty("passwordSet");
    expect(updateLocalAccountProfile(tmpDir, { displayName: "Updated owner" })).toMatchObject({ displayName: "Updated owner" });
    expect(fs.readFileSync(legacyPath, "utf-8")).toBe("obsolete invalid credential data");
  });
});
