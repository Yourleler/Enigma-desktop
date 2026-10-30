import fs from "fs";
import path from "path";
import { writeSecretFileSync } from "../shared/secret-fs.ts";

const USERS_FILE = "users.json";
const SCHEMA_VERSION = 1;
const USERNAME_MAX_LENGTH = 64;
const DISPLAY_NAME_MAX_LENGTH = 80;

export function getLocalAccountSummary(hanakoHome) {
  const { user } = loadDefaultUser(hanakoHome);
  return sanitizeAccount(user);
}

export function updateLocalAccountProfile(hanakoHome, {
  username,
  displayName,
  now = new Date().toISOString(),
}: { username?: string; displayName?: string; now?: string } = {}) {
  const users = loadUsers(hanakoHome);
  const user = getDefaultUser(users);
  const nextUsername = normalizeUsername(username, user.username || user.displayName);
  const nextDisplayName = normalizeDisplayName(displayName, user.displayName);

  user.username = nextUsername;
  user.displayName = nextDisplayName;
  user.updatedAt = now;
  users.updatedAt = now;
  writeSecretJson(path.join(hanakoHome, USERS_FILE), users);
  return sanitizeAccount(user);
}

function loadDefaultUser(hanakoHome) {
  const users = loadUsers(hanakoHome);
  return { users, user: getDefaultUser(users) };
}

function loadUsers(hanakoHome) {
  return validateUsers(readJsonRequired(path.join(hanakoHome, USERS_FILE), USERS_FILE), USERS_FILE);
}

function getDefaultUser(users) {
  const user = users.users.find((candidate) => candidate.userId === users.defaultUserId);
  if (!user) throw new Error(`invalid ${USERS_FILE}: defaultUserId must reference an existing user`);
  return user;
}

function validateUsers(value, label) {
  if (!isPlainObject(value)) throw new Error(`invalid ${label}: expected object`);
  if (value.schemaVersion !== SCHEMA_VERSION) throw new Error(`invalid ${label}: schemaVersion must be 1`);
  if (!isNonEmptyString(value.defaultUserId)) throw new Error(`invalid ${label}: defaultUserId required`);
  if (!Array.isArray(value.users) || value.users.length === 0) {
    throw new Error(`invalid ${label}: users must be a non-empty array`);
  }
  for (const user of value.users) {
    if (!isPlainObject(user)) throw new Error(`invalid ${label}: user must be object`);
    if (!isNonEmptyString(user.userId)) throw new Error(`invalid ${label}: userId required`);
    if (!isNonEmptyString(user.displayName)) throw new Error(`invalid ${label}: displayName required`);
  }
  return value;
}

function sanitizeAccount(user) {
  return {
    userId: user.userId,
    username: user.username || user.displayName || user.userId,
    displayName: user.displayName,
    kind: user.kind || null,
    updatedAt: user.updatedAt || null,
  };
}

function hasAsciiControlChar(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function hasUsernamePathSeparator(value) {
  return value.includes("/") || value.includes("\\");
}

function normalizeUsername(value, fallback) {
  const raw = isNonEmptyString(value) ? value.trim() : fallback;
  if (!isNonEmptyString(raw)) throw new Error("username required");
  if (raw.length > USERNAME_MAX_LENGTH) throw new Error(`username must be at most ${USERNAME_MAX_LENGTH} characters`);
  if (hasAsciiControlChar(raw) || hasUsernamePathSeparator(raw)) throw new Error("username contains unsupported characters");
  return raw;
}

function normalizeDisplayName(value, fallback) {
  const raw = isNonEmptyString(value) ? value.trim() : fallback;
  if (!isNonEmptyString(raw)) throw new Error("displayName required");
  if (raw.length > DISPLAY_NAME_MAX_LENGTH) {
    throw new Error(`displayName must be at most ${DISPLAY_NAME_MAX_LENGTH} characters`);
  }
  if (hasAsciiControlChar(raw)) throw new Error("displayName contains unsupported characters");
  return raw;
}

function readJsonRequired(filePath, label) {
  const value = readJsonIfPresent(filePath, label);
  if (!value) throw new Error(`${label} not found`);
  return value;
}

function readJsonIfPresent(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    if (err instanceof SyntaxError) throw new Error(`invalid ${label}: ${err.message}`);
    throw new Error(`failed to read ${label}: ${err.message}`);
  }
}

function writeSecretJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  writeSecretFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
