import { readFile } from 'node:fs/promises';
import type { Workspace } from './workspace.js';
import { MemoryStore, type MemoryAccess, type MemoryKind, type MemoryInput } from './memory.js';
import { ProjectContext } from './project-context.js';

export interface KnowledgeInput {
  title: string; content: string; kind: Exclude<MemoryKind, 'preference'>; resources?: string[]; sources?: { repo: string; file: string }[];
  evidence?: string[]; appliesWhen?: string; tags?: string[]; task?: string; entry?: string; taskOnly?: boolean;
}

/** Explicit, source-backed drafts. Idle consolidation remains owned by the memory store. */
export class ProjectKnowledge {
  constructor(readonly workspace: Workspace) {}
  async draft(input: KnowledgeInput, access: MemoryAccess = {}) {
    if (input.kind === ('preference' as string) || !['convention', 'contract', 'decision', 'troubleshooting', 'research'].includes(input.kind)
      || (input.resources?.length ?? 0) > 20 || !input.title?.trim() || !input.content?.trim()) throw new Error('Provide bounded candidate knowledge, not a personal preference');
    const materials = [], repos = new Set((input.sources ?? []).map(source => source.repo));
    for (const id of input.resources ?? []) {
      const resource = await new ProjectContext(this.workspace).read(id, { task: input.task }); if (resource.current === false) throw new Error('Project knowledge material is already stale');
      resource.resource.repos.forEach(repo => repos.add(repo)); materials.push({ id, revision: resource.resource.revision, contentHash: resource.resource.contentHash, task: resource.resource.task });
    }
    for (const source of input.sources ?? []) await readFile(await this.workspace.path(source.repo, source.file));
    for (const evidence of input.evidence ?? []) {
      let current = false; try { current = (await this.workspace.evidenceStatus(evidence)).valid; } catch { /* A child/source evidence ID is not a parent execution. */ }
      if (!current) throw new Error('Knowledge requires current evidence from this workspace; child evidence remains a source reference, not parent acceptance');
    }
    if (!materials.length && !input.sources?.length && !input.evidence?.length) throw new Error('Candidate knowledge requires current materials, source or evidence');
    const privateTask = input.taskOnly || materials.some(material => material.task);
    if (privateTask && (!input.task || !input.entry || access.session !== input.task || !access.entries?.includes(input.entry))) throw new Error('Private knowledge requires its current task entry');
    const note: MemoryInput = { kind: input.kind, title: input.title, content: input.content, tags: input.tags, appliesWhen: input.appliesWhen,
      materials, sources: input.sources, evidence: input.evidence,
      scope: privateTask ? { type: 'task', session: input.task, entry: input.entry } : repos.size ? { type: 'repositories', repos: [...repos] } : { type: 'project' },
      origin: { kind: 'assistant', reference: `project-knowledge:${materials.map(material => `${material.id}:${material.revision}`).join(',') || input.sources?.map(source => `${source.repo}:${source.file}`).join(',') || input.evidence?.join(',')}`, session: input.task, entry: input.entry } };
    const draft = await (await MemoryStore.open(this.workspace)).queue(note, access);
    return { draft, status: 'queued', materials, note: 'Candidate summary is not an instruction or verified conclusion. Consolidation rechecks source versions; imported references remain remote-unverified.' };
  }
  async organize(options: { limit?: number; signal?: AbortSignal } = {}) { return await (await MemoryStore.open(this.workspace)).organize(options); }
  async search(query: string, access: MemoryAccess = {}) { return await (await MemoryStore.open(this.workspace)).search(query, access); }
}
