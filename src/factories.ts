import type { Json } from './api.ts';
import { settings } from './config.ts';
import type {
  Attrs,
  BuiltRecord,
  Format,
  Related,
  Relationship,
  RelationshipKind,
} from './formats.ts';

type Value =
  | ((record: Json) => unknown)
  | object
  | string
  | number
  | boolean
  | null
  | undefined;
type Values = Record<string, Value>;
type Trait = Values | ((record: Json) => void);
type Overrides = Attrs;
type BuildArg = string | Overrides;
type ListArg = number | BuildArg | BuildArg[];

export interface FactoryDefinition {
  default?: Values;
  traits?: Record<string, Trait>;
  transient?: Values;
  relationships?: Record<string, Association>;
  format?: Format;
  url?: string;
  beforeSeed?: (record: Json, store: Json) => void;
  afterSeed?: (model: Json, transient: Json) => void;
}

const definitions = new Map<string, FactoryDefinition>();
const sequences = new Map<string, number>();
const sideloads = new WeakMap<BuiltRecord, Related[]>();
const relationshipMaps = new WeakMap<BuiltRecord, Map<string, Relationship>>();
const transients = new WeakMap<BuiltRecord, Attrs>();
const overrideKeys = new WeakMap<BuiltRecord, Override[]>();
const autoIds = new WeakSet<BuiltRecord>();
const factories = new WeakMap<BuiltRecord, string>();

interface Override {
  key: string;
  relationship: boolean;
}

class Sequence {
  constructor(readonly generate: (n: number) => unknown) {}
}

export class Association {
  constructor(
    readonly kind: RelationshipKind | 'fragment',
    readonly type: string,
    readonly args: ListArg[],
  ) {}
}

function isPlainObject(value: unknown): value is Attrs {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function clone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(clone) as T;
  } else if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clone(item)]),
    ) as T;
  }
  return value;
}

export function nextId(name: string): number {
  const id = (sequences.get(name) ?? 0) + 1;
  sequences.set(name, id);
  return id;
}

export function resetSequences(): void {
  sequences.clear();
}

export function defineFactory(
  name: string,
  definition: FactoryDefinition = {},
): void {
  definitions.set(name, definition);
}

export function belongsTo(type: string, ...args: BuildArg[]): Association {
  return new Association('belongsTo', type, args);
}

export function hasMany(type: string, ...args: ListArg[]): Association {
  return new Association('hasMany', type, args);
}

export function fragment(type: string, ...args: BuildArg[]): Association {
  return new Association('fragment', type, args);
}

export function sequence(generate: (n: number) => unknown): Sequence {
  return new Sequence(generate);
}

export function formatOf(name: string): Format {
  return definitions.get(name)?.format ?? settings().format;
}

export function urlOf(name: string): string | undefined {
  return definitions.get(name)?.url;
}

export function hooksOf(name: string): FactoryDefinition {
  return definitions.get(name) ?? {};
}

function isBuilt(value: unknown): value is BuiltRecord {
  return (
    value !== null &&
    typeof value === 'object' &&
    factories.has(value as BuiltRecord)
  );
}

function relate(
  record: BuiltRecord,
  key: string,
  association: Association,
  value: unknown,
  format: Format,
  related: Related[],
  relationships: Map<string, Relationship>,
): void {
  const kind = association.kind as RelationshipKind;
  const wireKey = format.relationshipKey(key, kind);
  const items = kind === 'hasMany' ? ((value ?? []) as unknown[]) : [value];
  for (const item of items) {
    if (isBuilt(item)) {
      related.push({ type: factoryOf(item) ?? association.type, record: item });
    }
  }
  const idOf = (item: unknown) => (isBuilt(item) ? item.id : item);
  record[wireKey] =
    kind === 'hasMany' ? items.map(idOf) : value == null ? value : idOf(value);
  relationships.set(wireKey, { type: association.type, kind });
}

function idFor(name: string, value: unknown): unknown {
  if (value instanceof Sequence) {
    return value.generate(nextId(name));
  } else if (typeof value === 'function') {
    return (value as (n: number) => unknown)(nextId(name));
  }
  return value ?? nextId(name);
}

export function build<T extends object = BuiltRecord>(
  name: string,
  ...args: BuildArg[]
): T {
  const definition = definitions.get(name);
  if (!definition) {
    throw new Error(`No factory defined for "${name}"`);
  }
  const format = formatOf(name);
  const last = args.at(-1);
  const overrides: Overrides = isPlainObject(last)
    ? (args.pop() as Overrides)
    : {};
  const transientKeys = new Set(Object.keys(definition.transient ?? {}));
  const declared = definition.relationships ?? {};

  const attrs: Attrs = { ...definition.transient, ...definition.default };
  const mutations: Array<(record: BuiltRecord) => void> = [];
  for (const trait of args as string[]) {
    const traitAttrs = definition.traits?.[trait];
    if (!traitAttrs) {
      throw new Error(`Factory "${name}" has no trait "${trait}"`);
    } else if (typeof traitAttrs === 'function') {
      mutations.push(traitAttrs as (record: BuiltRecord) => void);
    } else {
      Object.assign(attrs, traitAttrs);
    }
  }
  for (const key of Object.keys(overrides)) {
    const error =
      transientKeys.has(key) || key in declared
        ? undefined
        : format.keyError(key);
    if (error) {
      throw new Error(`build('${name}') got "${key}". ${error}`);
    }
  }
  Object.assign(attrs, overrides);

  const generated =
    attrs.id == null ||
    attrs.id instanceof Sequence ||
    typeof attrs.id === 'function';
  const record: BuiltRecord = { id: idFor(name, attrs.id) };
  if (generated) {
    autoIds.add(record);
  } else if (Number.isInteger(Number(record.id)) && record.id !== '') {
    sequences.set(name, Math.max(sequences.get(name) ?? 0, Number(record.id)));
  }

  const related: Related[] = [];
  const relationships = new Map<string, Relationship>();
  const options: Attrs = {};
  const deferred: Array<[string, (record: BuiltRecord) => unknown]> = [];
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'id') {
      continue;
    } else if (transientKeys.has(key)) {
      options[key] = value;
    } else if (value instanceof Sequence) {
      record[key] = value.generate(nextId(`${name}.${key}`));
    } else if (value instanceof Association) {
      if (value.kind === 'hasMany' && value.args.length === 0) {
        throw new Error(
          `hasMany('${value.type}') in a default or trait needs a count`,
        );
      } else if (value.kind === 'fragment') {
        const { id: _id, ...nested } = build(
          value.type,
          ...(value.args as BuildArg[]),
        );
        record[key] = nested;
      } else {
        const built =
          value.kind === 'hasMany'
            ? buildList(value.type, ...value.args)
            : build(value.type, ...(value.args as BuildArg[]));
        relate(record, key, value, built, format, related, relationships);
      }
    } else if (declared[key]) {
      relate(record, key, declared[key], value, format, related, relationships);
    } else if (typeof value === 'function') {
      record[key] = undefined;
      deferred.push([key, value as (record: BuiltRecord) => unknown]);
    } else if ([value].flat().some(isBuilt)) {
      throw new Error(
        `build('${name}') got built records under "${key}". Declare it in the ${name} factory's relationships: { ${key}: belongsTo(...) } or hasMany(...).`,
      );
    } else {
      record[key] = clone(value);
    }
  }
  deferred.forEach(([key, value]) => (record[key] = value(record)));
  mutations.forEach((mutate) => mutate(record));

  sideloads.set(record, related);
  relationshipMaps.set(record, relationships);
  transients.set(record, options);
  factories.set(record, name);
  overrideKeys.set(
    record,
    Object.entries(overrides)
      .filter(([key]) => !transientKeys.has(key))
      .map(([key, value]) => {
        const association =
          value instanceof Association ? value : declared[key];
        return association && association.kind !== 'fragment'
          ? {
              key: format.relationshipKey(key, association.kind),
              relationship: true,
            }
          : { key, relationship: false };
      }),
  );
  return record as T;
}

export function buildList<T extends object = BuiltRecord>(
  name: string,
  ...args: unknown[]
): T[] {
  if (typeof args[0] === 'number') {
    const [count, ...rest] = args as [number, ...BuildArg[]];
    return Array.from({ length: count }, () => build<T>(name, ...rest));
  }
  return (args as Array<BuildArg | BuildArg[]>).map((spec) =>
    build<T>(name, ...[spec].flat()),
  );
}

export function factoryOf(record: unknown): string | undefined {
  return isPlainObject(record)
    ? factories.get(record as BuiltRecord)
    : undefined;
}

export function transientOf(record: BuiltRecord): Attrs {
  return transients.get(record) ?? {};
}

export function overridesOf(record: BuiltRecord): Override[] {
  return overrideKeys.get(record) ?? [];
}

export function hasAutoId(record: BuiltRecord): boolean {
  return autoIds.has(record);
}

export function sideload<T extends object>(
  record: T,
  ...related: Array<object | null | undefined>
): T {
  const list = sideloads.get(record as BuiltRecord) ?? [];
  for (const item of related) {
    const type = item && factoryOf(item);
    if (item && type) {
      list.push({ type, record: item as BuiltRecord });
    }
  }
  sideloads.set(record as BuiltRecord, list);
  return record;
}

interface Prepared {
  record: BuiltRecord;
  related: Related[];
  relationships: Map<string, Relationship>;
}

function declaredRelationships(
  name: string,
  format: Format,
): Array<[string, string, Relationship]> {
  return Object.entries(definitions.get(name)?.relationships ?? {})
    .filter(([, association]) => association.kind !== 'fragment')
    .map(([key, association]) => {
      const kind = association.kind as RelationshipKind;
      return [
        key,
        format.relationshipKey(key, kind),
        { type: association.type, kind },
      ];
    });
}

function prepare(
  type: string,
  record: BuiltRecord,
  format: Format,
  cache: Map<BuiltRecord, Prepared>,
): Prepared {
  const cached = cache.get(record);
  if (cached) {
    return cached;
  }
  const relationships = new Map(relationshipMaps.get(record) ?? []);
  const related = [...(sideloads.get(record) ?? [])];
  let copy = record;
  for (const [key, wireKey, relationship] of declaredRelationships(
    factoryOf(record) ?? type,
    format,
  )) {
    relationships.set(wireKey, relationship);
    const source = key in record && key !== wireKey ? key : wireKey;
    const value = record[source];
    const items =
      relationship.kind === 'hasMany'
        ? Array.isArray(value)
          ? (value as unknown[])
          : []
        : [value];
    if (source === wireKey && !items.some(isBuilt)) {
      continue;
    }
    if (copy === record) {
      copy = { ...record };
    }
    delete copy[source];
    const idOf = (item: unknown) => (isBuilt(item) ? item.id : item);
    copy[wireKey] =
      relationship.kind === 'hasMany' ? items.map(idOf) : idOf(value);
    for (const item of items.filter(isBuilt)) {
      related.push({
        type: factoryOf(item) ?? relationship.type,
        record: item,
      });
    }
  }
  const prepared = { record: copy, related, relationships };
  cache.set(record, prepared);
  cache.set(copy, prepared);
  return prepared;
}

export function documentFor(
  type: string,
  data: BuiltRecord | BuiltRecord[],
  extra: Attrs,
  seeding: boolean,
): Attrs {
  const format = formatOf(type);
  const cache = new Map<BuiltRecord, Prepared>();
  const prepared = (record: BuiltRecord, recordType = type) =>
    prepare(recordType, record, format, cache);
  const records = Array.isArray(data)
    ? data.map((record) => prepared(record).record)
    : prepared(data).record;
  return format.document(type, records, extra, {
    seeding,
    related: (record) =>
      prepared(record).related.map((entry) => ({
        type: entry.type,
        record: prepared(entry.record, entry.type).record,
      })),
    relationships: (record) => prepared(record).relationships,
  });
}

export function payload(
  type: string,
  data: object | object[],
  extra: Attrs = {},
): Attrs {
  return documentFor(type, data as BuiltRecord | BuiltRecord[], extra, false);
}

export function mergePayloads(...payloads: Attrs[]): Attrs {
  const result: Attrs = {};
  for (const [key, value] of payloads.flatMap(Object.entries)) {
    const existing = result[key];
    result[key] =
      Array.isArray(existing) && Array.isArray(value)
        ? [...(existing as unknown[]), ...(value as unknown[])]
        : value;
  }
  return result;
}
