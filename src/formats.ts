import {
  camelize,
  dasherize,
  pluralize,
  singularize,
  underscore,
} from './inflection.ts';

export type Attrs = Record<string, unknown>;
export type BuiltRecord = Attrs & { id: unknown };
export type RelationshipKind = 'belongsTo' | 'hasMany';

export interface Relationship {
  type: string;
  kind: RelationshipKind;
}

export interface Related {
  type: string;
  record: BuiltRecord;
}

export interface DocumentContext {
  seeding: boolean;
  related(record: BuiltRecord): Related[];
  relationships(record: BuiltRecord): Map<string, Relationship>;
}

export interface Format {
  readonly name: string;
  readonly updateMethod: 'put' | 'patch';
  readonly separatesRelationships: boolean;
  keyError(key: string): string | undefined;
  relationshipKey(key: string, kind: RelationshipKind): string;
  path(type: string): string;
  document(
    type: string,
    data: BuiltRecord | BuiltRecord[],
    extra: Attrs,
    context: DocumentContext,
  ): Attrs;
  idFromBody(type: string, body: unknown): unknown;
}

type KeyCase = 'snake' | 'camel' | 'dash';

const KEY_RULES: Record<KeyCase, { invalid: RegExp; description: string }> = {
  snake: { invalid: /[A-Z-]/, description: 'snake_case' },
  camel: { invalid: /[_-]/, description: 'camelCase' },
  dash: { invalid: /[A-Z_]/, description: 'dasherized' },
};

function keyError(keys: KeyCase, key: string): string | undefined {
  const rule = KEY_RULES[keys];
  return rule.invalid.test(key)
    ? `Overrides use the API's ${rule.description} keys.`
    : undefined;
}

function collect(records: BuiltRecord[], context: DocumentContext): Related[] {
  const seen = new Set<BuiltRecord>(records);
  const result: Related[] = [];
  const visit = (record: BuiltRecord) => {
    for (const related of context.related(record)) {
      if (!seen.has(related.record)) {
        seen.add(related.record);
        result.push(related);
        visit(related.record);
      }
    }
  };
  records.forEach(visit);
  return result;
}

function sideloadedDocument(
  rootKey: (type: string, plural: boolean) => string,
): Format['document'] {
  return (type, data, extra, context) => {
    const many = Array.isArray(data);
    const records = many ? data : [data];
    const result: Attrs = { [rootKey(type, many)]: many ? [...data] : data };
    for (const { type: relatedType, record } of collect(records, context)) {
      const key = rootKey(relatedType, true);
      ((result[key] ??= []) as BuiltRecord[]).push(record);
    }
    return { ...result, ...extra };
  };
}

function bodyRoot(body: unknown, key: string): unknown {
  return body !== null && typeof body === 'object'
    ? (body as Attrs)[key]
    : undefined;
}

export interface ActiveModelOptions {
  path?: (type: string) => string;
}

export function activeModel(options: ActiveModelOptions = {}): Format {
  const rootKey = (type: string, plural: boolean) =>
    plural ? pluralize(underscore(type)) : underscore(type);

  return {
    name: 'activeModel',
    updateMethod: 'put',
    separatesRelationships: false,
    keyError: (key) => keyError('snake', key),
    relationshipKey: (key, kind) =>
      kind === 'belongsTo' ? `${key}_id` : `${singularize(key)}_ids`,
    path: options.path ?? ((type) => `/${rootKey(type, true)}`),
    document: sideloadedDocument(rootKey),
    idFromBody: (type, body) =>
      (bodyRoot(body, rootKey(type, false)) as Attrs | undefined)?.id,
  };
}

export interface RestOptions {
  keys?: KeyCase;
  path?: (type: string) => string;
}

export function rest(options: RestOptions = {}): Format {
  const keys = options.keys ?? 'camel';
  const cased = (type: string) =>
    keys === 'snake'
      ? underscore(type)
      : keys === 'dash'
        ? dasherize(type)
        : camelize(type);
  const rootKey = (type: string, plural: boolean) =>
    plural ? pluralize(cased(type)) : cased(type);

  return {
    name: 'rest',
    updateMethod: 'put',
    separatesRelationships: false,
    keyError: (key) => keyError(keys, key),
    relationshipKey: (key) => key,
    path: options.path ?? ((type) => `/${pluralize(camelize(type))}`),
    document: sideloadedDocument(rootKey),
    idFromBody: (type, body) =>
      (bodyRoot(body, rootKey(type, false)) as Attrs | undefined)?.id,
  };
}

export interface JsonApiOptions {
  linkage?: 'included' | 'always';
  path?: (type: string) => string;
}

interface Identifier {
  type: string;
  id: string;
}

export function jsonApi(options: JsonApiOptions = {}): Format {
  const linkage = options.linkage ?? 'included';
  const resourceType = (type: string) => pluralize(dasherize(type));

  const identifier = (type: string, value: unknown): Identifier => {
    if (value !== null && typeof value === 'object' && 'id' in value) {
      const { type: explicit, id } = value as { type?: string; id: unknown };
      return { type: resourceType(explicit ?? type), id: String(id) };
    }
    return { type: resourceType(type), id: String(value) };
  };

  const toLinkage = (
    relationship: Relationship,
    value: unknown,
  ): Identifier | Identifier[] | null => {
    if (relationship.kind === 'hasMany') {
      return ((value ?? []) as unknown[]).map((item) =>
        identifier(relationship.type, item),
      );
    }
    return value == null ? null : identifier(relationship.type, value);
  };

  return {
    name: 'jsonApi',
    updateMethod: 'patch',
    separatesRelationships: true,
    keyError: (key) => keyError('dash', key),
    relationshipKey: (key) => key,
    path: options.path ?? ((type) => `/${resourceType(type)}`),

    document(type, data, extra, context) {
      const many = Array.isArray(data);
      const records = many ? data : [data];
      const related = collect(records, context);
      const present = new Set(
        [...records.map((record) => ({ type, record })), ...related].map(
          ({ type: t, record }) => `${resourceType(t)}:${String(record.id)}`,
        ),
      );
      const isPresent = (linked: Identifier | Identifier[] | null) =>
        linked === null ||
        [linked].flat().every(({ type: t, id }) => present.has(`${t}:${id}`));

      const resource = (resourceOf: string, record: BuiltRecord) => {
        const { id, ...rest } = record;
        const declared = context.relationships(record);
        const attributes: Attrs = {};
        const relationships: Attrs = {};
        for (const [key, value] of Object.entries(rest)) {
          const relationship = declared.get(key);
          if (!relationship) {
            attributes[key] = value;
            continue;
          }
          const linked = toLinkage(relationship, value);
          if (linkage === 'always' || context.seeding || isPresent(linked)) {
            relationships[key] = { data: linked };
          }
        }
        return {
          id: String(id),
          type: resourceType(resourceOf),
          attributes,
          ...(Object.keys(relationships).length ? { relationships } : {}),
        };
      };

      return {
        data: many
          ? records.map((record) => resource(type, record))
          : resource(type, data),
        ...(related.length
          ? {
              included: related.map(({ type: t, record }) =>
                resource(t, record),
              ),
            }
          : {}),
        ...extra,
      };
    },

    idFromBody: (_type, body) =>
      (bodyRoot(body, 'data') as Attrs | undefined)?.id,
  };
}
