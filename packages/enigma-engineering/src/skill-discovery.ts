import { lstat, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Skill } from '@earendil-works/pi-coding-agent';
import type { Workspace } from './workspace.js';
import { hash, readJson, writeJson } from './storage.js';

export interface SkillSummary {
  id: string; name: string; description: string; file: string; version: string;
  source: Skill['sourceInfo']; modelInvocation: boolean; command: string;
}
export interface SkillDiscoveryConfig { schema: 1; paths: string[] }

/** Discovery locations are operator configuration, never repository write grants. */
export async function skillPaths(workspace: Workspace): Promise<string[]> {
  try {
    const config = await readJson<SkillDiscoveryConfig>(join(workspace.data, 'skill-discovery.json'));
    if (config.schema !== 1 || !Array.isArray(config.paths) || config.paths.length > 100
      || config.paths.some(path => typeof path !== 'string' || !path || path.includes('\0') || !path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path))) throw new Error('Invalid skill discovery paths');
    return config.paths;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}
export async function configureSkillPaths(workspace: Workspace, paths: string[]) {
  if (!Array.isArray(paths) || paths.length > 100 || paths.some(path => typeof path !== 'string' || !path || path.includes('\0'))) throw new Error('Provide at most 100 skill paths');
  const canonical = await Promise.all(paths.map(path => realpath(resolve(workspace.root, path))));
  return await workspace.exclusive(async () => {
    const config: SkillDiscoveryConfig = { schema: 1, paths: [...new Set(canonical)] };
    await writeJson(join(workspace.data, 'skill-discovery.json'), config); return config;
  });
}

/** Native Pi parses frontmatter, resolves duplicates and applies discovery rules. */
export async function loadNativeSkills(workspace: Workspace, options: { activePaths?: string[]; agentDir?: string } = {}) {
  const { loadSkills, getAgentDir } = await import('@earendil-works/pi-coding-agent');
  const paths = options.activePaths ?? await skillPaths(workspace);
  if (paths.length > 1000) throw new Error('Native skill catalogue exceeds the discovery budget');
  return loadSkills({ cwd: workspace.root, agentDir: options.agentDir ?? process.env.PI_CODING_AGENT_DIR ?? getAgentDir(),
    skillPaths: paths, includeDefaults: options.activePaths === undefined });
}

function terms(value: string): string[] {
  const tokens = value.toLowerCase().match(/[a-z0-9_]+|[\p{Script=Han}]+/gu) ?? [];
  return [...new Set(tokens.flatMap(token => /\p{Script=Han}/u.test(token) && token.length > 2
    ? [token, ...Array.from({ length: token.length - 1 }, (_, index) => token.slice(index, index + 2))] : [token]))].slice(0, 100);
}

/** Stateless, bounded selection. No model calls, automatic invocation or installation. */
export class SkillDiscovery {
  constructor(private readonly load: () => Promise<{ skills: Skill[]; diagnostics: unknown[] }>) {}
  private async catalogue() {
    const loaded = await this.load();
    if (loaded.skills.length > 1000) throw new Error('Skill catalogue exceeds the discovery budget');
    const skills: SkillSummary[] = [], unavailable: { name: string; reason: string }[] = []; let bytes = 0;
    for (const skill of loaded.skills) {
      try {
        const file = await realpath(skill.filePath), stat = await lstat(file);
        if (!stat.isFile() || stat.size > 256000) throw new Error('Skill file exceeds the 256 KB read budget');
        const body = await readFile(file, 'utf8'); if (Buffer.byteLength(body) > 256000) throw new Error('Skill file exceeds the read budget');
        bytes += Buffer.byteLength(body); if (bytes > 4000000) throw new Error('Skill catalogue exceeds the 4 MB content budget');
        skills.push({ id: hash(skill.filePath), name: skill.name, description: skill.description.slice(0, 3000), file,
          version: hash(body), source: skill.sourceInfo, modelInvocation: !skill.disableModelInvocation, command: `/skill:${skill.name}` });
      } catch (error) { unavailable.push({ name: skill.name, reason: String(error).slice(0, 500) }); }
    }
    return { skills, diagnostics: loaded.diagnostics.slice(0, 100), unavailable };
  }
  async search(query: string, options: { limit?: number; includeManual?: boolean } = {}) {
    if (typeof query !== 'string' || query.length > 500) throw new Error('Provide a skill intent of at most 500 characters');
    const limit = options.limit ?? 8;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 30) throw new Error('Skill search limit must be 1–30');
    const catalogue = await this.catalogue(), queryTerms = terms(query);
    const matches = catalogue.skills.filter(skill => options.includeManual || skill.modelInvocation).map(skill => {
      const text = `${skill.name} ${skill.description}`.toLowerCase(), name = skill.name.toLowerCase();
      const matched = queryTerms.filter(term => text.includes(term));
      return { ...skill, score: matched.reduce((total, term) => total + (name.includes(term) ? 3 : 1), 0), matched };
    }).filter(skill => !queryTerms.length || skill.score > 0).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return { query, skills: matches.slice(0, limit), totalMatches: matches.length, truncated: matches.length > limit,
      diagnostics: catalogue.diagnostics, unavailable: catalogue.unavailable, method: 'lexical intent matching against native Pi skill summaries',
      note: 'A discovery path grants no repository write permission. Manual-only skills are excluded unless explicitly requested; invocation remains owned by Pi.' };
  }
  async open(id: string, expectedVersion: string, options:{manualRead?:boolean} = {}) {
    const catalogue = await this.load();
    if(catalogue.skills.length>1000)throw new Error('Skill catalogue exceeds the discovery budget');
    const native=catalogue.skills.find(skill=>hash(skill.filePath)===id);
    if (!native) throw new Error('Skill is no longer in the native catalogue; search again');
    if (native.disableModelInvocation&&!options.manualRead) throw new Error('Manual-only skill: invoke its native /skill command explicitly');
    const file=await realpath(native.filePath),stat=await lstat(file);
    if(!stat.isFile()||stat.size>256000)throw new Error('Skill file exceeds the 256 KB read budget');
    const content = await readFile(file, 'utf8');
    if (Buffer.byteLength(content) > 256000 || hash(content) !== expectedVersion) throw new Error('Skill changed while reading');
    const skill:SkillSummary={id,name:native.name,description:native.description.slice(0,3000),file,version:expectedVersion,source:native.sourceInfo,modelInvocation:!native.disableModelInvocation,command:`/skill:${native.name}`};
    return { skill, content, role: 'selected skill reference', note: 'Native skill content does not expand host permissions or replace current user requirements.' };
  }
}
