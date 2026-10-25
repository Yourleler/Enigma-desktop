import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import protobuf from 'protobufjs';
import { parse as parseThrift, SyntaxType, type FunctionType } from '@creditkarma/thrift-parser';
import ts from 'typescript';
import type { Workspace } from './workspace.js';
import type { SourceLocation } from './reading.js';
import { hash } from './storage.js';

export interface SchemaMember { name: string; type: string; fieldId?: number; required?: boolean; source: SourceLocation }
export interface SchemaDefinition { id: string; name: string; qualified: string; language: string; kind: string; source: SourceLocation; members: SchemaMember[] }
interface Unit { repo: string; file: string; path: string; text: string; hash: string }
interface TypeUse { from: string; type: string; source: SourceLocation }
export interface Import { repo: string; file: string; path: string; line: number; target?: string }

const key = (path: string) => process.platform === 'win32' ? resolve(path).replace(/\\/g, '/').toLowerCase() : resolve(path);
const identifier = (unit: Unit, name: string) => `${unit.repo}:${unit.file}:${name}`;
const location = (unit: Unit, name: string, kind: string, start: number, end = start): SourceLocation => ({ repo: unit.repo, file: unit.file, hash: unit.hash,
  symbol: name, kind, line: start, endLine: Math.min(end, start + 80), snippet: unit.text.split('\n').slice(start - 1, Math.min(end, start + 80)).join('\n').slice(0, 16000), truncated: end > start + 80 });
function thriftType(type: FunctionType): string {
  if (type.type === SyntaxType.Identifier) return type.value;
  if (type.type === SyntaxType.MapType) return `map<${thriftType(type.keyType)},${thriftType(type.valueType)}>`;
  if (type.type === SyntaxType.ListType || type.type === SyntaxType.SetType) return `${type.type === SyntaxType.ListType ? 'list' : 'set'}<${thriftType(type.valueType)}>`;
  return type.type.replace(/Keyword$/, '').toLowerCase();
}
function parseThriftUnit(unit: Unit, definitions: SchemaDefinition[], uses: TypeUse[], imports: Import[], diagnostics: string[]) {
  const document = parseThrift(unit.text);
  if (document.type === SyntaxType.ThriftErrors) { diagnostics.push(...document.errors.map(error => `${unit.repo}:${unit.file}:${error.loc.start.line}: ${error.message}`)); return; }
  const namespace = document.body.find(item => item.type === SyntaxType.NamespaceDefinition && ['*', 'go'].includes(item.scope.value));
  for (const statement of document.body) {
    if (statement.type === SyntaxType.IncludeDefinition) { imports.push({ repo: unit.repo, file: unit.file, path: statement.path.value, line: statement.loc.start.line }); continue; }
    if (!('name' in statement) || statement.type === SyntaxType.NamespaceDefinition) continue;
    const name = statement.name.value, id = identifier(unit, name), source = location(unit, name, statement.type, statement.loc.start.line, statement.loc.end.line);
    const members: SchemaMember[] = [];
    if ('fields' in statement) for (const field of statement.fields) {
      const member = { name: field.name.value, type: thriftType(field.fieldType), fieldId: field.fieldID?.value, required: field.requiredness === 'required', source: location(unit, field.name.value, 'schema-field', field.loc.start.line, field.loc.end.line) };
      members.push(member); uses.push({ from: id, type: member.type, source: member.source });
    }
    if (statement.type === SyntaxType.ServiceDefinition) for (const method of statement.functions) {
      const signature = `${thriftType(method.returnType)}(${method.fields.map(field => thriftType(field.fieldType)).join(',')})`;
      const member = { name: method.name.value, type: signature, source: location(unit, method.name.value, 'schema-method', method.loc.start.line, method.loc.end.line) };
      members.push(member); uses.push({ from: id, type: signature, source: member.source });
    }
    if (statement.type === SyntaxType.EnumDefinition) for (const member of statement.members) members.push({ name: member.name.value, type: 'enum-value', source: location(unit, member.name.value, 'enum-value', member.loc.start.line, member.loc.end.line) });
    if (statement.type === SyntaxType.TypedefDefinition) uses.push({ from: id, type: thriftType(statement.definitionType), source });
    definitions.push({ id, name, qualified: namespace && namespace.type === SyntaxType.NamespaceDefinition ? `${namespace.name.value}.${name}` : name, language: 'Thrift', kind: statement.type, source, members });
  }
}
interface Token { text: string; line: number; offset: number }
function protoPositions(text: string, packageName: string) {
  const tokens: Token[] = []; let previous = 0, line = 1;
  const pattern = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_][\w.]*|\d+|[{}=;]/g;
  for (const match of text.matchAll(pattern)) {
    line += text.slice(previous, match.index).split('\n').length - 1; previous = match.index!;
    if (!match[0].startsWith('//') && !match[0].startsWith('/*')) tokens.push({ text: match[0], line, offset: match.index! });
  }
  const declarations = new Map<string, { start: number; end: number; line: number; endLine: number }>();
  const walk = (start: number, end: number, prefix: string) => {
    for (let i = start; i < end; i++) if (['message', 'enum', 'service'].includes(tokens[i]!.text) && tokens[i + 2]?.text === '{') {
      let depth = 1, closing = i + 3;
      for (; closing < end; closing++) { if (tokens[closing]!.text === '{') depth++; if (tokens[closing]!.text === '}' && --depth === 0) break; }
      if (closing >= end) continue;
      const name = [prefix, tokens[i + 1]!.text].filter(Boolean).join('.');
      declarations.set(name, { start: i, end: closing, line: tokens[i]!.line, endLine: tokens[closing]!.line });
      walk(i + 3, closing, name); i = closing;
    }
  };
  walk(0, tokens.length, packageName); return { tokens, declarations };
}
function parseProtoUnit(unit: Unit, definitions: SchemaDefinition[], uses: TypeUse[], imports: Import[], diagnostics: string[]) {
  try {
    const parsed = protobuf.parse(unit.text, { keepCase: true });
    const positions = protoPositions(unit.text, parsed.package ?? '');
    for (const path of [...parsed.imports ?? [], ...parsed.weakImports ?? []]) {
      const line = unit.text.slice(0, unit.text.indexOf(path)).split('\n').length; imports.push({ repo: unit.repo, file: unit.file, path, line });
    }
    const walk = (object: protobuf.ReflectionObject) => {
      const qualified = object.fullName.replace(/^\./, ''), pos = positions.declarations.get(qualified);
      if (pos && (object instanceof protobuf.Type || object instanceof protobuf.Enum || object instanceof protobuf.Service)) {
        const id = identifier(unit, qualified), members: SchemaMember[] = [];
        const childRanges = [...positions.declarations.entries()].filter(([name]) => name.startsWith(qualified + '.')).map(([, range]) => range);
        const find = (name: string, fieldId?: number) => positions.tokens.findIndex((token, index) => index > pos.start && index < pos.end && !childRanges.some(range => index >= range.start && index <= range.end)
          && token.text === name && (fieldId === undefined ? positions.tokens[index - 1]?.text === 'rpc' : positions.tokens[index + 1]?.text === '=' && Number(positions.tokens[index + 2]?.text) === fieldId));
        if (object instanceof protobuf.Type) for (const field of object.fieldsArray) {
          const at = find(field.name, field.id); if (at < 0) { diagnostics.push(`No exact field anchor: ${unit.repo}:${unit.file}:${qualified}.${field.name}`); continue; }
          const type = field instanceof protobuf.MapField ? `map<${field.keyType},${field.type}>` : field.repeated ? `list<${field.type}>` : field.type;
          const source = location(unit, field.name, 'schema-field', positions.tokens[at]!.line);
          members.push({ name: field.name, type, fieldId: field.id, required: field.required, source }); uses.push({ from: id, type, source });
        }
        if (object instanceof protobuf.Service) for (const method of object.methodsArray) {
          const at = find(method.name); if (at < 0) continue;
          const type = `${method.requestType}->${method.responseType}`, source = location(unit, method.name, 'schema-method', positions.tokens[at]!.line);
          members.push({ name: method.name, type, source }); uses.push({ from: id, type, source });
        }
        if (object instanceof protobuf.Enum) for (const [name] of Object.entries(object.values)) {
          const at = positions.tokens.findIndex((token, index) => index > pos.start && index < pos.end && token.text === name && positions.tokens[index + 1]?.text === '=');
          if (at >= 0) members.push({ name, type: 'enum-value', source: location(unit, name, 'enum-value', positions.tokens[at]!.line) });
        }
        definitions.push({ id, name: object.name, qualified, language: 'Protobuf', kind: object instanceof protobuf.Type ? 'message' : object instanceof protobuf.Service ? 'service' : 'enum', source: location(unit, object.name, 'schema-definition', pos.line, pos.endLine), members });
      }
      if (object instanceof protobuf.Namespace) object.nestedArray.forEach(walk);
    }; walk(parsed.root);
  } catch (error) { diagnostics.push(`${unit.repo}:${unit.file}: ${String(error)}`); }
}
function parseJsonUnit(unit: Unit, definitions: SchemaDefinition[], uses: TypeUse[], imports: Import[], diagnostics: string[]) {
  try {
    const value = JSON.parse(unit.text) as Record<string, unknown>, ast = ts.parseJsonText(unit.file, unit.text);
    const positions = new Map<string, ts.Node>();
    const visit = (node: ts.Node, pointer: string) => {
      positions.set(pointer, node);
      if (ts.isObjectLiteralExpression(node)) for (const property of node.properties) if (ts.isPropertyAssignment(property)) visit(property.initializer, `${pointer}/${(ts.isStringLiteral(property.name) ? property.name.text : property.name.getText(ast)).replace(/~/g, '~0').replace(/\//g, '~1')}`);
      if (ts.isArrayLiteralExpression(node)) node.elements.forEach((item, index) => visit(item, `${pointer}/${index}`));
    };
    const statement = ast.statements[0]; if (statement && ts.isExpressionStatement(statement)) visit(statement.expression, '#');
    const containers: [string, unknown][] = [['#/$defs', value.$defs], ['#/definitions', value.definitions], ['#/components/schemas', (value.components as Record<string, unknown> | undefined)?.schemas]];
    if (value.properties) containers.push(['#', { [basename(unit.file)]: value }]);
    for (const [prefix, collection] of containers) {
      if (!collection || typeof collection !== 'object' || Array.isArray(collection)) continue;
      for (const [name, schema] of Object.entries(collection)) {
        if (!schema || typeof schema !== 'object') continue;
        const data = schema as Record<string, unknown>, pointer = prefix === '#' ? '#' : `${prefix}/${name.replace(/~/g, '~0').replace(/\//g, '~1')}`, node = positions.get(pointer);
        if (!node) continue;
        const id = identifier(unit, pointer), source = location(unit, name, 'schema-definition', ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, ast.getLineAndCharacterOfPosition(node.end).line + 1), members: SchemaMember[] = [];
        for (const [field, details] of Object.entries(data.properties as object ?? {})) {
          const child = positions.get(`${pointer}/properties/${field.replace(/~/g, '~0').replace(/\//g, '~1')}`); if (!child || !details || typeof details !== 'object') continue;
          const definition = details as { type?: string; $ref?: string }, type = definition.$ref ?? definition.type ?? 'unknown';
          const fieldSource = location(unit, field, 'schema-field', ast.getLineAndCharacterOfPosition(child.getStart(ast)).line + 1, ast.getLineAndCharacterOfPosition(child.end).line + 1);
          members.push({ name: field, type, required: Array.isArray(data.required) && data.required.includes(field), source: fieldSource });
        }
        const references = (value: unknown, path: string) => {
          if (!value || typeof value !== 'object') return;
          if (Array.isArray(value)) { value.forEach((item, index) => references(item, `${path}/${index}`)); return; }
          for (const [key, item] of Object.entries(value)) {
            const next = `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;
            if (key === '$ref' && typeof item === 'string') {
              const node = positions.get(next); if (!node) continue;
              const source = location(unit, '$ref', 'schema-reference', ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1);
              uses.push({ from: id, type: item, source });
              if (!item.startsWith('#')) imports.push({ repo: unit.repo, file: unit.file, path: item.split('#')[0]!, line: source.line });
            } else references(item, next);
          }
        }; references(data, pointer);
        definitions.push({ id, name, qualified: pointer, language: 'JSON Schema', kind: 'schema', source, members });
      }
    }
  } catch (error) { diagnostics.push(`${unit.repo}:${unit.file}: ${String(error)}`); }
}

export async function readSchemas(workspace: Workspace, options: { query?: string; maxFiles?: number; signal?: AbortSignal } = {}) {
  const observation = await workspace.observe(), maximum = options.maxFiles ?? 160;
  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 1000) throw new Error('Invalid schema reading budget');
  const candidates: { repo: string; file: string }[] = [];
  for (const repo of workspace.config.repos) for (const file of await workspace.files(repo.id)) if (/\.(proto|thrift|json)$/.test(file) && !file.endsWith('lock.json')) candidates.push({ repo: repo.id, file });
  const units: Unit[] = []; let bytesRead = 0, truncated = candidates.length > maximum;
  const definitions: SchemaDefinition[] = [], uses: TypeUse[] = [], imports: Import[] = [], diagnostics: string[] = [];
  for (const candidate of candidates.slice(0, maximum)) {
    if (options.signal?.aborted) throw new Error('Schema reading cancelled');
    const path = await workspace.path(candidate.repo, candidate.file); if ((await stat(path)).size > 512000) { truncated = true; continue; }
    const bytes = await readFile(path); bytesRead += bytes.length;
    if (bytesRead > 16_000_000) { truncated = true; break; }
    let text: string; try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { diagnostics.push(`Invalid UTF-8 schema: ${candidate.repo}:${candidate.file}`); continue; }
    const unit = { ...candidate, path, text, hash: hash(bytes) }; units.push(unit);
    if (unit.file.endsWith('.thrift')) parseThriftUnit(unit, definitions, uses, imports, diagnostics);
    else if (unit.file.endsWith('.proto')) parseProtoUnit(unit, definitions, uses, imports, diagnostics);
    else parseJsonUnit(unit, definitions, uses, imports, diagnostics);
  }
  const byPath = new Map(units.map(unit => [key(unit.path), unit]));
  for (const imported of imports) {
    const owner = units.find(unit => unit.repo === imported.repo && unit.file === imported.file)!;
    const path = resolve(dirname(owner.path), imported.path), target = byPath.get(key(path));
    if (target) imported.target = `${target.repo}:${target.file}`;
    else diagnostics.push(`Unresolved registered schema import: ${owner.repo}:${owner.file}:${imported.path}`);
  }
  const relations = [];
  for (const use of uses) {
    const owner = definitions.find(definition => definition.id === use.from)!;
    const visible = new Set([`${owner.source.repo}:${owner.source.file}`, ...imports.filter(item => item.repo === owner.source.repo && item.file === owner.source.file && item.target).map(item => item.target!)]);
    const terms = owner.language === 'JSON Schema' ? [use.type] : use.type.match(/\.?[A-Za-z_][\w.]*/g) ?? [];
    for (const term of terms) {
      const allowed = definitions.filter(target => visible.has(`${target.source.repo}:${target.source.file}`));
      let matches: SchemaDefinition[] = [];
      if (owner.language === 'Thrift') {
        if (!term.includes('.')) matches = allowed.filter(target => target.source.repo === owner.source.repo && target.source.file === owner.source.file && target.name === term);
        else {
          const prefix = term.split('.')[0]!, name = term.slice(prefix.length + 1);
          const targets = imports.filter(item => item.repo === owner.source.repo && item.file === owner.source.file && basename(item.path, '.thrift') === prefix).map(item => item.target);
          matches = allowed.filter(target => targets.includes(`${target.source.repo}:${target.source.file}`) && target.name === name);
        }
      } else if (owner.language === 'JSON Schema') {
        const at = term.indexOf('#'), file = at < 0 ? term : term.slice(0, at), pointer = at < 0 ? '#' : term.slice(at);
        const targets = file ? imports.filter(item => item.repo === owner.source.repo && item.file === owner.source.file && item.path === file).map(item => item.target) : [`${owner.source.repo}:${owner.source.file}`];
        matches = allowed.filter(target => targets.includes(`${target.source.repo}:${target.source.file}`) && target.qualified === pointer);
      } else {
        const prefixes = owner.qualified.split('.');
        if (term.startsWith('.')) matches = allowed.filter(target => target.qualified === term.slice(1));
        for (let count = prefixes.length; count >= 0 && !matches.length && !term.startsWith('.'); count--) {
          const qualified = [...prefixes.slice(0, count), term.replace(/^\./, '')].join('.');
          matches = allowed.filter(target => target.qualified === qualified);
        }
        if (!matches.length) matches = allowed.filter(target => target.qualified === term.replace(/^\./, ''));
      }
      if (matches.length === 1) relations.push({ from: use.from, to: matches[0]!.id, kind: 'schema-type-reference', confidence: 'confirmed' as const, source: use.source });
      else if (matches.length > 1) diagnostics.push(`Ambiguous schema type reference: ${owner.id}:${term}`);
    }
  }
  const query = options.query?.toLowerCase();
  const selected = definitions.filter(definition => !query || `${definition.name} ${definition.qualified} ${definition.members.map(member => member.name).join(' ')}`.toLowerCase().includes(query));
  const selectedIds = new Set(selected.map(definition => definition.id));
  const uniqueRelations = [...new Map(relations.map(relation => [`${relation.from}:${relation.to}:${relation.source.file}:${relation.source.line}`, relation])).values()];
  return { observation, definitions: selected.slice(0, 200), relations: uniqueRelations.filter(relation => selectedIds.has(relation.from) || selectedIds.has(relation.to)).slice(0, 400), imports, diagnostics: [...new Set(diagnostics)],
    sources: units.map(({ repo, file, hash }) => ({ repo, file, hash })), truncated: truncated || selected.length > 200 || relations.length > 400,
    limitation: 'Static schema declarations and registered imports only. Field compatibility, generated consumers, protocol runtime behavior and external references require explicit source mappings and actual checks.' };
}
