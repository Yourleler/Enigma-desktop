import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import type { Workspace } from './workspace.js';
import type { ReadingResult, SourceLocation } from './reading.js';
import { hash } from './storage.js';
import { runProcess } from './process.js';
import { SourceIndex } from './source-index.js';

interface Unit { repo: string; file: string; path: string; bytes: Buffer; ast: ts.SourceFile; hash: string }
const cached = new Map<string, { hash: string; ast: ts.SourceFile }>();
const compilerPath = (path: string): string => {
  const normalized = resolve(path).replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};
const sourcePath = (path: string) => /\.[cm]?[jt]sx?$/.test(path);

/** Use the actual TypeScript checker inside a bounded, registered-source filesystem. */
export async function analyzeTypescript(workspace: Workspace, term: string, options: { repo?: string; maxFiles: number; signal?: AbortSignal; rg?: string }) {
  const units = new Map<string, Unit>(), texts = new Map<string, string>();
  const sources: ReadingResult['sources'] = [];
  const diagnostics: string[] = [];
  let truncated = false, reparsed = 0, reused = 0;
  let sourceBytes = 0;
  const pending: { repo: string; file: string }[] = [];
  const matches = new Set<string>();
  let portableSearch = false;
  for (const repo of workspace.config.repos) {
    if (options.signal?.aborted) throw new Error('TypeScript source reading cancelled');
    const found = await runProcess([options.rg ?? 'rg', '--files-with-matches', '--null', '--fixed-strings', '--glob', '*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}', '--', term, '.'], repo.root,
      { timeoutMs: 30_000, limit: 1_000_000, signal: options.signal });
    if (found.status === 'passed' || found.exitCode === 1) for (const path of found.output.split('\0').filter(Boolean)) matches.add(compilerPath(resolve(repo.root, path)));
    if (found.truncated || found.status !== 'passed' && found.exitCode !== 1) portableSearch = true;
  }
  if (portableSearch) {
    const indexed = await new SourceIndex(workspace).select(term, { language: 'TypeScript', maxFiles: 50_000, signal: options.signal });
    for (const file of indexed.files) if (file.score > 0) matches.add(compilerPath(resolve(workspace.repo(file.repo).root, file.file)));
    truncated ||= indexed.truncated; diagnostics.push(...indexed.diagnostics);
  }
  for (const repo of workspace.config.repos) for (const file of await workspace.files(repo.id)) {
    if (sourcePath(file)) pending.push({ repo: repo.id, file });
    else if (/(^|\/)tsconfig[^/]*\.json$|(^|\/)package\.json$/.test(file)) {
      const path = await workspace.path(repo.id, file);
      if ((await stat(path)).size > 512_000) { diagnostics.push(`Configuration exceeds budget: ${repo.id}:${file}`); continue; }
      const bytes = await readFile(path); texts.set(compilerPath(path), bytes.toString('utf8')); sources.push({ repo: repo.id, file, hash: hash(bytes) });
    }
  }
  pending.sort((a, b) => Number(matches.has(compilerPath(resolve(workspace.repo(b.repo).root, b.file)))) - Number(matches.has(compilerPath(resolve(workspace.repo(a.repo).root, a.file))))
    || Number(/test|spec/.test(a.file)) - Number(/test|spec/.test(b.file)) || a.repo.localeCompare(b.repo) || a.file.localeCompare(b.file));
  if (pending.length > options.maxFiles) truncated = true;
  const registered = new Map(pending.map(candidate => [compilerPath(resolve(workspace.repo(candidate.repo).root, candidate.file)), candidate]));
  const roots = new Set([...texts.keys(), ...registered.keys()].map(path => compilerPath(dirname(path))));
  const moduleHost: ts.ModuleResolutionHost = { fileExists: path => texts.has(compilerPath(path)), readFile: path => texts.get(compilerPath(path)),
    directoryExists: path => [...roots].some(root => root === compilerPath(path) || root.startsWith(compilerPath(path) + '/')), getCurrentDirectory: () => compilerPath(workspace.root) };
  const compilerOptions = (repoId: string, file: string, seen = new Set<string>()): ts.CompilerOptions => {
    const path = compilerPath(file), text = texts.get(path); if (!text) return {};
    if (seen.has(path) || seen.size > 8) { diagnostics.push(`Cyclic or excessive tsconfig extends: ${repoId}:${file}`); return {}; }
    seen.add(path);
    const parsed = ts.parseConfigFileTextToJson(path, text);
    if (parsed.error) { diagnostics.push(`Invalid tsconfig: ${repoId}:${file}`); return {}; }
    const config = parsed.config as { extends?: string | string[]; compilerOptions?: object };
    const inherited: ts.CompilerOptions = {};
    for (const parent of typeof config.extends === 'string' ? [config.extends] : config.extends ?? []) {
      const desired = compilerPath(resolve(dirname(path), parent.endsWith('.json') ? parent : `${parent}.json`));
      if (!texts.has(desired)) { diagnostics.push(`Unresolved tsconfig extends: ${repoId}:${parent}`); continue; }
      Object.assign(inherited, compilerOptions(repoId, desired, new Set(seen)));
    }
    const converted = ts.convertCompilerOptionsFromJson(config.compilerOptions ?? {}, dirname(path));
    diagnostics.push(...converted.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, ' ')));
    return { ...inherited, ...converted.options };
  };
  const manifests = workspace.config.repos.map(repo => {
    const text = texts.get(compilerPath(join(repo.root, 'package.json')));
    try { return { repo, manifest: text ? JSON.parse(text) as Record<string, unknown> : {} }; }
    catch { diagnostics.push(`Invalid package manifest: ${repo.id}`); return { repo, manifest: {} as Record<string, unknown> }; }
  });
  const resolveRegisteredPackage = (name: string, navigate = false): string | undefined => {
    const packageName = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]!;
    const matches = manifests.filter(item => item.manifest.name === packageName);
    if (matches.length !== 1) return undefined;
    const { repo, manifest } = matches[0]!;
    const subpath = name.slice(packageName.length).replace(/^\//, '');
    const choose = (value: unknown): string | undefined => {
      if (typeof value === 'string') return value;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
      const conditions = value as Record<string, unknown>;
      return choose(conditions.types) ?? choose(conditions.import) ?? choose(conditions.default);
    };
    const exports = manifest.exports;
    const entry = exports !== undefined ? typeof exports === 'object' && exports !== null && Object.keys(exports).some(key => key.startsWith('.'))
      ? choose((exports as Record<string, unknown>)[subpath ? `./${subpath}` : '.']) : !subpath ? choose(exports) : undefined
      : subpath || choose(manifest.types) || choose(manifest.module) || choose(manifest.main) || 'index.js';
    if (!entry) return undefined;
    const desired = compilerPath(resolve(repo.root, entry));
    const candidates = [...(navigate ? registered.keys() : units.keys())].filter(path => path === desired || path.replace(/\.[cm]?[jt]sx?$/, '') === desired.replace(/\.[cm]?[jt]sx?$/, '')
      || path === compilerPath(join(desired, 'index.ts')) || path === compilerPath(join(desired, 'index.js')));
    return candidates.length === 1 ? candidates[0] : undefined;
  };
  const symbols: SourceLocation[] = [], references: ReadingResult['references'] = [], imports: ReadingResult['imports'] = [];
  const projectOptions = new Map(workspace.config.repos.map(repo => [repo.id, { allowJs: true, checkJs: true, target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, ...compilerOptions(repo.id, join(repo.root, 'tsconfig.json')),
    noEmit: true, noLib: true, types: [] } as ts.CompilerOptions]));
  const navigationHost: ts.ModuleResolutionHost = { ...moduleHost, fileExists: path => texts.has(compilerPath(path)) || registered.has(compilerPath(path)) };
  const queue = [...pending], visited = new Set<string>();
  while (queue.length && units.size < options.maxFiles) {
    if (options.signal?.aborted) throw new Error('TypeScript source reading cancelled');
    const candidate = queue.shift()!, path = compilerPath(resolve(workspace.repo(candidate.repo).root, candidate.file));
    if (visited.has(path)) continue; visited.add(path);
    const checked = await workspace.path(candidate.repo, candidate.file);
    if ((await stat(checked)).size > 512_000) { truncated = true; continue; }
    const bytes = await readFile(checked), digest = hash(bytes); sourceBytes += bytes.length;
    if (sourceBytes > 16_000_000) { truncated = true; diagnostics.push('Registered source exceeds the 16 MB analysis budget'); break; }
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { diagnostics.push(`Invalid UTF-8: ${candidate.repo}:${candidate.file}`); continue; }
    const previous = cached.get(path), ast = previous?.hash === digest ? previous.ast : ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    if (previous?.hash === digest) reused++; else reparsed++;
    cached.set(path, { hash: digest, ast }); units.set(path, { ...candidate, path, bytes, hash: digest, ast }); texts.set(path, text);
    sources.push({ ...candidate, hash: digest });
    // Spend the next slots on real static imports, before unrelated files with no query hit.
    for (const dependency of ts.preProcessFile(text, true, true).importedFiles) {
      const resolved = ts.resolveModuleName(dependency.fileName, path, projectOptions.get(candidate.repo)!, navigationHost).resolvedModule;
      const target = resolved && registered.has(compilerPath(resolved.resolvedFileName)) ? compilerPath(resolved.resolvedFileName) : resolveRegisteredPackage(dependency.fileName, true);
      const next = target && registered.get(target); if (next && !visited.has(target!)) queue.unshift(next);
    }
  }
  while (cached.size > 2000) cached.delete(cached.keys().next().value!);
  const seenLocations = new Set<string>();
  const location = (node: ts.Node, symbol: string, kind: string): SourceLocation | undefined => {
    const ast = node.getSourceFile(), unit = units.get(compilerPath(ast.fileName)); if (!unit) return undefined;
    const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, endLine = ast.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
    return { repo: unit.repo, file: unit.file, line, endLine, symbol, kind, hash: unit.hash,
      snippet: ast.text.split('\n').slice(line - 1, Math.min(endLine, line + 17)).join('\n') };
  };
  for (const repo of workspace.config.repos) {
    const optionsForRepo = projectOptions.get(repo.id)!;
    const resolveModule = (name: string, containingFile: string): ts.ResolvedModuleFull | undefined => {
      const containingOptions = projectOptions.get(units.get(compilerPath(containingFile))?.repo ?? repo.id)!;
      const resolved = ts.resolveModuleName(name, containingFile, containingOptions, moduleHost).resolvedModule;
      const path = resolved && units.has(compilerPath(resolved.resolvedFileName)) ? compilerPath(resolved.resolvedFileName) : resolveRegisteredPackage(name);
      if (!path) return undefined;
      const extension = path.endsWith('.tsx') ? ts.Extension.Tsx : path.endsWith('.jsx') ? ts.Extension.Jsx : /\.[cm]?js$/.test(path) ? ts.Extension.Js : ts.Extension.Ts;
      return { resolvedFileName: path, extension, isExternalLibraryImport: false };
    };
    const host: ts.CompilerHost = { ...moduleHost, fileExists: moduleHost.fileExists, readFile: moduleHost.readFile,
      getSourceFile: path => units.get(compilerPath(path))?.ast, getDefaultLibFileName: () => '', writeFile: () => { throw new Error('Reading cannot emit files'); },
      getCurrentDirectory: () => compilerPath(repo.root), getCanonicalFileName: compilerPath, useCaseSensitiveFileNames: () => process.platform !== 'win32', getNewLine: () => '\n',
      resolveModuleNameLiterals: (literals, containingFile) => literals.map(literal => ({ resolvedModule: resolveModule(literal.text, containingFile) })) };
    const program = ts.createProgram({ rootNames: [...units.keys()], options: optionsForRepo, host });
    const checker = program.getTypeChecker();
    const unalias = (symbol: ts.Symbol | undefined): ts.Symbol | undefined => symbol && (symbol.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(symbol) : symbol;
    const targets = new Set<ts.Symbol>();
    for (const unit of units.values()) {
      if (options.repo && unit.repo !== options.repo) continue;
      const findTargets = (node: ts.Node) => {
        if (ts.isIdentifier(node) && node.text === term) {
          const symbol = unalias(checker.getSymbolAtLocation(node));
          if (symbol && symbol.declarations?.some(declaration => units.has(compilerPath(declaration.getSourceFile().fileName)))) targets.add(symbol);
        }
        ts.forEachChild(node, findTargets);
      };
      findTargets(unit.ast);
    }
    // Analyze each repository using its own project options; imported declarations can belong elsewhere.
    for (const target of targets) for (const declaration of target.declarations ?? []) {
      const found = location(declaration, target.name, ts.SyntaxKind[declaration.kind]);
      const key = found && `definition:${found.repo}:${found.file}:${found.line}:${found.symbol}`;
      if (found && key && !seenLocations.has(key)) { seenLocations.add(key); symbols.push(found); }
    }
    for (const unit of units.values()) {
      if (unit.repo !== repo.id) continue;
      const visit = (node: ts.Node) => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
          const resolved = resolveModule(node.moduleSpecifier.text, unit.path), target = resolved && units.get(compilerPath(resolved.resolvedFileName));
          imports.push({ repo: unit.repo, file: unit.file, line: unit.ast.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            module: node.moduleSpecifier.text, target: target ? `${target.repo}:${target.file}` : undefined, confidence: target ? 'confirmed' : 'unresolved' });
        }
        if (ts.isIdentifier(node)) {
          const bound = checker.getSymbolAtLocation(node), target = unalias(bound);
          if (target && targets.has(target)) {
            const isOwnDeclaration = target.declarations?.some(declaration => (declaration as ts.NamedDeclaration).name === node);
            if (!isOwnDeclaration) {
              const parent = node.parent, imported = ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent);
              const call = ts.isCallExpression(parent) && parent.expression === node || ts.isPropertyAccessExpression(parent) && ts.isCallExpression(parent.parent) && parent.parent.expression === parent;
              const found = location(node, node.text, imported ? 'import-binding' : call ? 'call-site' : /test|spec/.test(unit.file) ? 'test-reference' : 'source-reference');
              const key = found && `reference:${found.repo}:${found.file}:${found.line}:${found.symbol}`;
              if (found && key && !seenLocations.has(key)) {
                const declaration = target.declarations?.find(item => units.has(compilerPath(item.getSourceFile().fileName)));
                const destination = declaration && location(declaration, target.name, 'definition');
                let owner: string | undefined;
                for (let ancestor: ts.Node | undefined = node.parent; ancestor; ancestor = ancestor.parent) {
                  if ((ts.isFunctionDeclaration(ancestor) || ts.isMethodDeclaration(ancestor) || ts.isVariableDeclaration(ancestor)) && ancestor.name) {
                    owner = ancestor.name.getText(unit.ast); break;
                  }
                }
                seenLocations.add(key); references.push({ ...found, confidence: 'confirmed', target: destination, owner,
                  reason: `TypeScript static symbol binding${destination ? ` to ${destination.repo}:${destination.file}:${destination.line}` : ''}; runtime dispatch may still differ.` });
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(unit.ast);
    }
  }
  return { symbols, references, imports, sources, truncated, diagnostics: [...new Set(diagnostics)], scannedFiles: units.size,
    incremental: { reparsed, reused }, limitation: 'Bounded registered-source TypeScript programs; external package declarations, excluded files and dynamic runtime dispatch are not resolved.' };
}
