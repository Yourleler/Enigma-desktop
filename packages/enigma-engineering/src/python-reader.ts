import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Workspace } from './workspace.js';
import type { ReadingResult, SourceLocation } from './reading.js';
import { hash } from './storage.js';
import { runProcess } from './process.js';

interface PyUnit { repo: string; file: string; hash: string; text: string }
interface PySymbol { name: string; line: number; end: number; kind: string; scope: string }
interface PyImport { module: string; imported: string; local: string; line: number; level: number; scope: string }
interface PyCall { name: string; line: number; owner?: string; scope: string; shadowed: string[] }
interface PyRoute { path: string; method: string; line: number; owner: string; kind: string }
interface PyFacts { symbols: PySymbol[]; imports: PyImport[]; calls: PyCall[]; routes: PyRoute[]; error?: string }
export interface EndpointFact { repo: string; file: string; hash: string; line: number; path: string; method: string; owner: string; kind: string }
const parser = String.raw`
import ast,json,sys
payload=json.load(sys.stdin)
output=[]
for unit in payload:
 result={'symbols':[],'imports':[],'calls':[],'routes':[]}
 try:
  tree=ast.parse(unit['text'],filename=unit['file'])
  parents={child:node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
  def scope(node):
   owner=parents.get(node)
   while owner is not None:
    if isinstance(owner,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef,ast.Lambda)):
     return str(getattr(owner,'name','lambda'))+':'+str(owner.lineno)
    owner=parents.get(owner)
   return ''
  locals_by_scope={}
  for node in ast.walk(tree):
   key=scope(node)
   if isinstance(node,ast.Name) and isinstance(node.ctx,ast.Store):locals_by_scope.setdefault(key,set()).add(node.id)
   if isinstance(node,ast.arg):locals_by_scope.setdefault(key,set()).add(node.arg)
  for node in ast.walk(tree):
   key=scope(node)
   if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)):
    result['symbols'].append({'name':node.name,'line':node.lineno,'end':getattr(node,'end_lineno',node.lineno),'kind':type(node).__name__,'scope':key})
    for dec in node.decorator_list:
     if isinstance(dec,ast.Call) and isinstance(dec.func,ast.Attribute) and dec.args and isinstance(dec.args[0],ast.Constant) and isinstance(dec.args[0].value,str):
      method=dec.func.attr.lower()
      if method in ['get','post','put','delete','patch','route']:
       methods=[method.upper()] if method!='route' else ['GET']
       for kw in dec.keywords:
        if kw.arg=='methods' and isinstance(kw.value,(ast.List,ast.Tuple)):
         methods=[str(v.value).upper() for v in kw.value.elts if isinstance(v,ast.Constant) and isinstance(v.value,str)]
       for method_name in methods:result['routes'].append({'path':dec.args[0].value,'method':method_name,'line':dec.lineno,'owner':node.name,'kind':'decorator-route'})
   elif isinstance(node,ast.ImportFrom):
    for alias in node.names:result['imports'].append({'module':node.module or '', 'imported':alias.name,'local':alias.asname or alias.name,'line':node.lineno,'level':node.level,'scope':key})
   elif isinstance(node,ast.Import):
    for alias in node.names:result['imports'].append({'module':alias.name,'imported':'*','local':alias.asname or alias.name.split('.')[0],'line':node.lineno,'level':0,'scope':key})
   elif isinstance(node,ast.Call):
    def name(n):
     if isinstance(n,ast.Name):return n.id
     if isinstance(n,ast.Attribute):
      parent=name(n.value)
      return parent+'.'+n.attr if parent else ''
     return ''
    call_name=name(node.func)
    if call_name:result['calls'].append({'name':call_name,'line':node.lineno,'owner':key.split(':')[0] if key else None,'scope':key,'shadowed':sorted(locals_by_scope.get(key,set()))})
   elif isinstance(node,ast.Compare) and len(node.ops)==1 and isinstance(node.ops[0],ast.Eq) and len(node.comparators)==1:
    right=node.comparators[0]
    if isinstance(node.left,ast.Attribute) and node.left.attr=='path' and isinstance(right,ast.Constant) and isinstance(right.value,str) and right.value.startswith('/'):
     owner=key.split(':')[0]
     if owner.startswith('do_'):result['routes'].append({'path':right.value,'method':owner[3:],'line':node.lineno,'owner':owner,'kind':'stdlib-path-condition'})
 except (SyntaxError,ValueError,MemoryError,RecursionError) as error:result['error']=type(error).__name__+': '+str(error)
 output.append(result)
json.dump(output,sys.stdout,ensure_ascii=False)
`;
const cache = new Map<string, { hash: string; facts: PyFacts }>();
const location = (unit: PyUnit, line: number, end: number, symbol: string, kind: string): SourceLocation => ({ repo: unit.repo, file: unit.file, hash: unit.hash,
  line, endLine: end, symbol, kind, snippet: unit.text.split('\n').slice(Math.max(0, line - 1), Math.min(end, line + 16)).join('\n') });

export async function analyzePython(workspace: Workspace, query: string, options: { repo?: string; maxFiles: number; signal?: AbortSignal }) {
  const units: PyUnit[] = [], diagnostics: string[] = [];
  const candidates = [];
  for (const repo of workspace.config.repos) for (const file of await workspace.files(repo.id)) if (file.endsWith('.py')) candidates.push({ repo: repo.id, file });
  let truncated = candidates.length > options.maxFiles, bytesRead = 0, reparsed = 0, reused = 0;
  for (const candidate of candidates.slice(0, options.maxFiles)) {
    const path = await workspace.path(candidate.repo, candidate.file);
    if ((await stat(path)).size > 512000) { truncated = true; continue; }
    const bytes = await readFile(path); bytesRead += bytes.length;
    if (bytesRead > 16000000) { truncated = true; break; }
    try { units.push({ ...candidate, hash: hash(bytes), text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }); }
    catch { diagnostics.push(`Invalid UTF-8 Python source: ${candidate.repo}:${candidate.file}`); }
  }
  const facts = new Map<string, PyFacts>(); const changed: PyUnit[] = [];
  const key = (unit: PyUnit) => `${workspace.repo(unit.repo).root}:${unit.file}`;
  for (const unit of units) {
    const previous = cache.get(key(unit));
    if (previous?.hash === unit.hash) { facts.set(key(unit), previous.facts); reused++; } else changed.push(unit);
  }
  if (changed.length) {
    const argv = process.env.ENIGMA_PYTHON ? [process.env.ENIGMA_PYTHON, '-I', '-c', parser] : process.platform === 'win32' ? ['python', '-I', '-c', parser] : ['python3', '-I', '-c', parser];
    const result = await runProcess(argv, workspace.root, { stdin: JSON.stringify(changed.map(unit => ({ file: unit.file, text: unit.text }))), timeoutMs: 30000, limit: 8000000, signal: options.signal });
    if (result.status !== 'passed' || result.truncated) diagnostics.push('Python AST parser unavailable, cancelled, or exceeded output budget; Python source relationships remain unverified.');
    else {
      const parsed = JSON.parse(result.output) as PyFacts[];
      if (!Array.isArray(parsed) || parsed.length !== changed.length) throw new Error('Invalid Python AST parser output');
      for (let i = 0; i < changed.length; i++) { const unit = changed[i]!, data = parsed[i]!; cache.set(key(unit), { hash: unit.hash, facts: data }); facts.set(key(unit), data); reparsed++; }
    }
  }
  while (cache.size > 2000) cache.delete(cache.keys().next().value!);
  const targetModule = (unit: PyUnit, imp: PyImport): PyUnit | undefined => {
    const targetParts = imp.module.split('.').filter(Boolean);
    let relativePath: string | undefined;
    if (imp.level > 0) {
      const base = unit.file.split('/').slice(0, -1); for (let i = 1; i < imp.level; i++) base.pop();
      relativePath = [...base, ...targetParts].join('/');
    }
    const matches = units.filter(candidate => {
      const without = candidate.file.replace(/\.py$/, '').replace(/\/__init__$/, '');
      if (relativePath !== undefined) return candidate.repo === unit.repo && without === relativePath;
      return without === targetParts.join('/') || `${basename(workspace.repo(candidate.repo).root)}/${without}` === targetParts.join('/');
    });
    return matches.length === 1 ? matches[0] : undefined;
  };
  const selected: { unit: PyUnit; symbol: PySymbol }[] = [];
  for (const unit of units) if (!options.repo || options.repo === unit.repo) for (const symbol of facts.get(key(unit))?.symbols ?? []) if (symbol.name === query) selected.push({ unit, symbol });
  const symbols = selected.map(({ unit, symbol }) => location(unit, symbol.line, symbol.end, symbol.name, symbol.kind));
  const references: ReadingResult['references'] = [], imports: ReadingResult['imports'] = [], endpoints: EndpointFact[] = [];
  for (const unit of units) {
    const data = facts.get(key(unit)); if (!data) continue;
    if (data.error) { diagnostics.push(`${unit.repo}:${unit.file}: ${data.error}`); continue; }
    for (const route of data.routes) endpoints.push({ repo: unit.repo, file: unit.file, hash: unit.hash, ...route });
    for (const imp of data.imports) {
      const target = targetModule(unit, imp);
      imports.push({ repo: unit.repo, file: unit.file, line: imp.line, module: '.'.repeat(imp.level) + imp.module, target: target ? `${target.repo}:${target.file}` : undefined, confidence: target ? 'confirmed' : 'unresolved' });
    }
    for (const call of data.calls) {
      const stem = call.name.split('.')[0]!, member = call.name.split('.').at(-1)!;
      const imported = data.imports.find(imp => imp.local === stem && (imp.scope === call.scope || !imp.scope));
      if (imported && call.shadowed.includes(stem)) continue;
      const targetUnit = imported ? targetModule(unit, imported) : unit;
      const targetName = imported ? imported.imported === '*' ? member : imported.imported : member;
      const matches = selected.filter(item => item.unit.repo === targetUnit?.repo && item.unit.file === targetUnit?.file && item.symbol.name === targetName);
      if (matches.length === 1) {
        const selectedTarget = matches[0]!;
        const target = location(selectedTarget.unit, selectedTarget.symbol.line, selectedTarget.symbol.end, selectedTarget.symbol.name, selectedTarget.symbol.kind);
        const shadowed = !imported && call.shadowed.includes(stem);
        if (shadowed) continue;
        references.push({ ...location(unit, call.line, call.line, call.name, /test/.test(unit.file) ? 'test-reference' : 'call-site'), target, owner: call.owner,
          confidence: imported && imported.imported !== '*' && !selectedTarget.symbol.scope ? 'confirmed' : 'candidate',
          reason: imported ? 'Python explicit source import; dynamic module mutation and runtime dispatch are not verified.' : 'Python AST call candidate; class/closure/runtime binding requires inspection.' });
      } else if (call.name === query && (!options.repo || unit.repo === options.repo)) references.push({ ...location(unit, call.line, call.line, call.name, 'call-site'), owner: call.owner,
        confidence: 'candidate', reason: 'Python AST name call; source target could not be resolved uniquely.' });
    }
  }
  return { symbols, references, imports, endpoints, sources: units.map(({ repo, file, hash }) => ({ repo, file, hash })), diagnostics, scannedFiles: units.length, truncated,
    incremental: { reparsed, reused }, limitation: 'Python AST parsing never executes repository code. Explicit unambiguous imports are source facts; closures, class dispatch, import hooks and route activation remain unverified.' };
}
