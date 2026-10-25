import { readFile, stat } from 'node:fs/promises';
import ts from 'typescript';
import type { Workspace } from './workspace.js';
import { hash } from './storage.js';
import { analyzePython, type EndpointFact } from './python-reader.js';
import { readSchemas } from './schema-reading.js';

export interface ContractParty { repo: string; file: string; symbol?: string }
export interface DeclaredContract {
  id: string; kind?: 'http' | 'schema' | 'configuration'; method?: string; path?: string; name?: string;
  producer: ContractParty; consumers: ContractParty[]; checks: string[];
  sources: { repo: string; file: string; hash: string }[];
}
export async function declaredContracts(workspace: Workspace): Promise<DeclaredContract[]> {
  const result: DeclaredContract[] = [];
  const identities = new Set<string>(); let sourceBytes = 0;
  for (const repo of workspace.config.repos) {
    const path = await workspace.path(repo.id, '.enigma-contracts.json');
    let bytes: Buffer;
    try { if ((await stat(path)).size > 256000) throw new Error('Contract manifest exceeds file budget'); bytes = await readFile(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const value = JSON.parse(bytes.toString('utf8')) as { schema: number; contracts: Omit<DeclaredContract, 'sources'>[] };
    if (value.schema !== 1 || !Array.isArray(value.contracts) || value.contracts.length > 100) throw new Error('Invalid contract manifest');
    for (const contract of value.contracts) {
      const kind = contract.kind ?? 'http';
      if (typeof contract.id !== 'string' || !contract.id.trim() || contract.id.length > 160 || identities.has(contract.id)
        || !['http', 'schema', 'configuration'].includes(kind) || !contract.producer || !Array.isArray(contract.consumers)
        || contract.consumers.length > 100 || !Array.isArray(contract.checks) || contract.checks.length > 100) throw new Error('Invalid or duplicate declared contract');
      if (kind === 'http' && (typeof contract.path !== 'string' || !contract.path.startsWith('/') || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(contract.method ?? ''))) throw new Error('Invalid declared HTTP contract');
      if (kind !== 'http' && (typeof contract.name !== 'string' || !contract.name.trim() || contract.name.length > 300)) throw new Error('Schema/configuration contract requires a name');
      identities.add(contract.id);
      const sources = [{ repo: repo.id, file: '.enigma-contracts.json', hash: hash(bytes) }];
      for (const party of [contract.producer, ...contract.consumers]) {
        if (!party || typeof party.repo !== 'string' || typeof party.file !== 'string' || party.symbol !== undefined && typeof party.symbol !== 'string') throw new Error('Invalid contract source party');
        const source = await workspace.path(party.repo, party.file);
        if ((await stat(source)).size > 8000000) throw new Error('Contract source exceeds read budget');
        const bytes = await readFile(source); sourceBytes += bytes.length;
        if (sourceBytes > 16_000_000) throw new Error('Declared contract sources exceed the 16 MB budget');
        sources.push({ repo: party.repo, file: party.file, hash: hash(bytes) });
      }
      for (const check of contract.checks) if (!workspace.config.checks.some(item => item.id === check)) throw new Error(`Contract references an unknown check: ${check}`);
      result.push({ ...contract, kind, sources });
    }
  }
  return result;
}

export async function discoverContracts(workspace: Workspace, options: { query?: string; maxFiles?: number; signal?: AbortSignal } = {}) {
  const maximum = options.maxFiles ?? 160;
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 1000) throw new Error('Invalid contract discovery budget');
  const observation = await workspace.observe();
  const declared = await declaredContracts(workspace);
  const schemas = await readSchemas(workspace, { query: options.query, maxFiles: maximum, signal: options.signal });
  const python = await analyzePython(workspace, '', { maxFiles: maximum, signal: options.signal });
  const consumers: EndpointFact[] = [], sources = [...python.sources, ...declared.flatMap(item => item.sources), ...schemas.sources], diagnostics = [...python.diagnostics, ...schemas.diagnostics];
  let parsed = 0, truncated = python.truncated;
  for (const repo of workspace.config.repos) for (const file of await workspace.files(repo.id)) {
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    if (++parsed > Math.max(0, maximum - python.scannedFiles)) { truncated = true; continue; }
    const path = await workspace.path(repo.id, file); if ((await stat(path)).size > 512000) { truncated = true; continue; }
    const bytes = await readFile(path), text = bytes.toString('utf8'), digest = hash(bytes);
    sources.push({ repo: repo.id, file, hash: digest });
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'fetch' && node.arguments[0]) {
        const argument = node.arguments[0]; let endpoint: string | undefined;
        if (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) endpoint = argument.text;
        else if (ts.isTemplateExpression(argument) && argument.templateSpans.length === 1 && argument.templateSpans[0]!.literal.text.startsWith('/')) endpoint = argument.templateSpans[0]!.literal.text;
        else if (ts.isBinaryExpression(argument) && argument.operatorToken.kind === ts.SyntaxKind.PlusToken && ts.isStringLiteral(argument.right) && argument.right.text.startsWith('/')) endpoint = argument.right.text;
        if (endpoint) {
          try { if (/^https?:/.test(endpoint)) endpoint = new URL(endpoint).pathname; } catch { endpoint = undefined; }
          if (endpoint?.startsWith('/')) {
            let method = 'GET'; const init = node.arguments[1];
            if (init && ts.isObjectLiteralExpression(init)) for (const property of init.properties) if (ts.isPropertyAssignment(property) && property.name.getText(ast).replace(/["']/g, '') === 'method' && ts.isStringLiteral(property.initializer)) method = property.initializer.text.toUpperCase();
            let owner = '';
            for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) if ((ts.isFunctionDeclaration(parent) || ts.isVariableDeclaration(parent)) && parent.name) { owner = parent.name.getText(ast); break; }
            consumers.push({ repo: repo.id, file, hash: digest, line: ast.getLineAndCharacterOfPosition(node.getStart()).line + 1, method, path: endpoint.split('?')[0]!, owner, kind: 'fetch-endpoint' });
          }
        }
      }
      ts.forEachChild(node, visit);
    }; visit(ast);
  }
  const candidates = [];
  for (const producer of python.endpoints) for (const consumer of consumers) if (producer.repo !== consumer.repo && producer.method === consumer.method && producer.path === consumer.path) {
    candidates.push({ id: `${producer.method} ${producer.path}`, producer, consumer, confidence: 'candidate' as const,
      reason: 'Matching source route declaration and fetch endpoint. Host/base URL, routing activation, authentication and runtime behavior need verification.' });
  }
  const query = options.query?.toLowerCase();
  return { observation, sources, declared: declared.filter(item => !query || JSON.stringify(item).toLowerCase().includes(query)),
    candidates: candidates.filter(item => !query || JSON.stringify(item).toLowerCase().includes(query)).slice(0, 100),
    endpoints: { producers: python.endpoints.slice(0, 100), consumers: consumers.slice(0, 100) }, schemas, diagnostics, truncated: truncated || schemas.truncated,
    coverage: { pythonFiles: python.scannedFiles, typescriptFiles: Math.min(parsed, Math.max(0, maximum - python.scannedFiles)) },
    limitation: 'Declared contracts express user-authored source/check mappings; endpoint matches are candidates, not proof that services call each other. Missing dynamic routes are not evidence of no dependency.' };
}
