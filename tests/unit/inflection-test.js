import {
  dependencySatisfies,
  importSync,
  macroCondition,
} from '@embroider/macros';
import { module, test } from 'qunit';
import Inflector from 'ember-inflector';

import { activeModel, jsonApi, rest } from '#src/index.ts';

module('Unit | inflection', function () {
  test("paths follow the app's inflection rules", function (assert) {
    if (
      macroCondition(
        dependencySatisfies('@ember-data/request-utils', '>=5.3.0'),
      )
    ) {
      const { irregular, uncountable } = importSync(
        '@ember-data/request-utils/string',
      );
      irregular('cactus', 'cacti');
      uncountable('xero_credentials');
    } else {
      Inflector.inflector.irregular('cactus', 'cacti');
      Inflector.inflector.uncountable('xero_credentials');
    }

    assert.strictEqual(jsonApi().path('cactus'), '/cacti');
    assert.strictEqual(
      activeModel().path('xero_credentials'),
      '/xero_credentials',
    );
    assert.strictEqual(rest().path('person'), '/people');
    assert.strictEqual(
      activeModel().relationshipKey('people', 'hasMany'),
      'person_ids',
    );
  });
});
