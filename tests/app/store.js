import FragmentStore from 'ember-data-model-fragments/store';
import ArrayTransform from 'ember-data-model-fragments/transforms/array';
import FragmentTransform from 'ember-data-model-fragments/transforms/fragment';
import FragmentArrayTransform from 'ember-data-model-fragments/transforms/fragment-array';

class Store extends FragmentStore {}

export const modules = {
  './services/store': Store,
  './transforms/array': ArrayTransform,
  './transforms/fragment': FragmentTransform,
  './transforms/fragment-array': FragmentArrayTransform,
};
