import { getContext } from '@ember/test-helpers';
import {
  dependencySatisfies,
  importSync,
  macroCondition,
} from '@embroider/macros';

import {
  build,
  buildList,
  documentFor,
  definitionOf,
  factoryOf,
  overridesOf,
  transientOf,
} from './factories.ts';
import type { Attrs, BuiltRecord } from './formats.ts';

/* Minimal structural types so the addon works with ember-data 4.12 and 5.x */
interface ModelClass {
  prototype: object;
  eachAttribute(callback: (name: string) => void): void;
  eachComputedProperty?(
    callback: (name: string, meta: { isAttribute?: boolean } | null) => void,
  ): void;
  eachRelationship(
    callback: (name: string, meta: { kind: string }) => void,
  ): void;
}

interface Serializer {
  attrs?: Record<string, string | { key?: string }>;
  keyForAttribute(name: string, method: string): string;
  keyForRelationship(name: string, kind: string, method: string): string;
}

interface Store {
  modelFor(name: string): ModelClass;
  serializerFor(name: string): Serializer & {
    normalize(
      modelClass: ModelClass,
      hash: Attrs,
    ): { data: { attributes: Attrs } };
  };
  pushPayload(name: string, payload: unknown): void;
  peekRecord(name: string, id: string): unknown;
  createFragment?(name: string, attributes: Attrs): Attrs;
}

const sources = new WeakMap<object, BuiltRecord>();

function isFragment(modelClass: ModelClass): boolean {
  if (macroCondition(dependencySatisfies('ember-data-model-fragments', '*'))) {
    const { default: Fragment } = importSync(
      'ember-data-model-fragments/fragment',
    ) as { default: abstract new () => object };
    return modelClass.prototype instanceof Fragment;
  }
  return false;
}

function attributeKeys(
  serializer: Serializer,
  modelClass: ModelClass,
): Set<string> {
  const keys = new Set(['id']);
  const add = (attribute: string) => {
    keys.add(attribute);
    keys.add(serializer.keyForAttribute(attribute, 'deserialize'));
  };
  modelClass.eachAttribute(add);
  modelClass.eachComputedProperty?.((name, meta) => {
    if (meta?.isAttribute) {
      add(name);
    }
  });
  return keys;
}

function modelKeys(
  serializer: Serializer,
  modelClass: ModelClass,
): { keys: Set<string>; relationships: Set<string> } {
  const keys = attributeKeys(serializer, modelClass);
  const relationships = new Set<string>();
  modelClass.eachRelationship((relationship, { kind }) => {
    const key = serializer.keyForRelationship(
      relationship,
      kind,
      'deserialize',
    );
    relationships.add(key);
    keys.add(key);
    keys.add(`${key.replace(/_ids?$/, '')}_type`);
  });
  for (const [name, mapping] of Object.entries(serializer.attrs ?? {})) {
    keys.add(serializer.keyForAttribute(name, 'deserialize'));
    const key = typeof mapping === 'string' ? mapping : mapping.key;
    if (key) {
      keys.add(key);
    }
  }
  return { keys, relationships };
}

function rejectUnusedOverrides(
  name: string,
  record: BuiltRecord,
  { keys, relationships }: ReturnType<typeof modelKeys>,
): void {
  const overrides = overridesOf(record);
  const undeclared = overrides.find(
    ({ key, relationship }) => !relationship && relationships.has(key),
  );
  if (undeclared && definitionOf(name).format.separatesRelationships) {
    throw new Error(
      `seed('${name}') got ${undeclared.key}, a relationship the ${name} factory does not declare. Declare it in the factory's relationships: { ${undeclared.key}: belongsTo(...) } or hasMany(...).`,
    );
  }
  const unused = overrides
    .map(({ key }) => key)
    .filter((key) => !keys.has(key));
  if (unused.length) {
    throw new Error(
      `seed('${name}') got ${unused.join(', ')}, which the ${name} model does not read. Use the keys the API sends.`,
    );
  }
}

function currentStore(): Store {
  const context = getContext() as
    { owner?: { lookup(name: string): unknown } } | undefined;
  if (!context?.owner) {
    throw new Error(
      'seed() needs a test set up with setupTest or setupRenderingTest',
    );
  }
  return context.owner.lookup('service:store') as Store;
}

function pushFragment(
  store: Store,
  name: string,
  modelClass: ModelClass,
  record: BuiltRecord,
): unknown {
  const serializer = store.serializerFor(name);
  const { id: _id, ...attrs } = record;
  const { data } = serializer.normalize(modelClass, attrs);
  const fragment = store.createFragment!(name, data.attributes);
  const known = attributeKeys(serializer, modelClass);
  for (const [key, value] of Object.entries(attrs)) {
    if (!known.has(key)) {
      fragment[key] = value;
    }
  }
  return fragment;
}

function push(name: string, record: BuiltRecord): unknown {
  const store = currentStore();
  const modelClass = store.modelFor(name);
  if (isFragment(modelClass)) {
    return pushFragment(store, name, modelClass, record);
  }
  rejectUnusedOverrides(
    name,
    record,
    modelKeys(store.serializerFor(name), modelClass),
  );
  const { beforeSeed, afterSeed } = definitionOf(name);
  beforeSeed?.(record, store);
  store.pushPayload(
    name,
    JSON.parse(JSON.stringify(documentFor(name, record, {}, true))),
  );
  const model = store.peekRecord(name, String(record.id)) as object;
  sources.set(model, record);
  afterSeed?.(model, transientOf(record));
  return model;
}

export function seed<T = unknown>(
  name: string,
  ...args: Array<string | Attrs>
): T {
  return push(name, build(name, ...args)) as T;
}

export function seedList<T = unknown>(name: string, ...args: unknown[]): T[] {
  return buildList(name, ...args).map((record) => push(name, record) as T);
}

export function seedRecord<T = unknown>(record: object): T {
  const name = factoryOf(record);
  if (!name) {
    throw new Error('seedRecord() takes a record from build()');
  }
  return push(name, record as BuiltRecord) as T;
}

export function sourceOf(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && sources.has(value)) {
    return sources.get(value);
  }
  const modelName = (value as { constructor?: { modelName?: unknown } } | null)
    ?.constructor?.modelName;
  if (typeof modelName === 'string') {
    throw new Error(
      `A ${modelName} record that was not created with seed() was used in a mocked response. Pass API JSON instead.`,
    );
  }
  return value;
}
