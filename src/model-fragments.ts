import Fragment from 'ember-data-model-fragments/fragment';

import { hasAutoId } from './factories.ts';
import { attributeKeys, registerSeeder, type Store } from './store.ts';

interface FragmentStore extends Store {
  createFragment(name: string, attributes: unknown): Record<string, unknown>;
}

interface Normalizer {
  normalize(
    modelClass: unknown,
    hash: unknown,
  ): { data: { attributes: unknown } };
}

registerSeeder({
  handles: (modelClass) => modelClass.prototype instanceof Fragment,

  seed(store, name, modelClass, record) {
    const serializer = store.serializerFor(name);
    const { id: _id, ...attrs } = record;
    const { data } = (serializer as unknown as Normalizer).normalize(
      modelClass,
      hasAutoId(record) ? attrs : record,
    );
    const fragment = (store as FragmentStore).createFragment(
      name,
      data.attributes,
    );

    const known = attributeKeys(serializer, modelClass);
    for (const [key, value] of Object.entries(attrs)) {
      if (!known.has(key)) {
        fragment[key] = value;
      }
    }
    return fragment;
  },
});
