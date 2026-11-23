import {
  dependencySatisfies,
  importSync,
  macroCondition,
} from '@embroider/macros';
import { module, test } from 'qunit';
import Inflector from 'ember-inflector';

import { activeModel, configure, jsonApi, rest } from '#src/index.ts';
import { basicPluralize, basicSingularize } from '#src/inflection.ts';

import { configureDefaults } from '../config.ts';

module('Unit | inflection', function (hooks) {
  hooks.afterEach(function () {
    configureDefaults();
  });

  test('configure({ pluralize, singularize }) wins', function (assert) {
    configure({
      pluralize: (word) => `${word}z`,
      singularize: (word) => word.replace(/z$/, ''),
    });

    assert.strictEqual(jsonApi().path('company'), '/companyz');
    assert.strictEqual(
      activeModel().relationshipKey('tagz', 'hasMany'),
      'tag_ids',
    );
  });

  test("the app's inflection rules come next", function (assert) {
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

  test('the basic rules are the last resort', function (assert) {
    assert.deepEqual(
      ['company', 'box', 'church', 'day', 'person', 'widget'].map(
        basicPluralize,
      ),
      ['companies', 'boxes', 'churches', 'days', 'people', 'widgets'],
    );
    assert.deepEqual(
      ['companies', 'boxes', 'churches', 'days', 'people', 'widgets'].map(
        basicSingularize,
      ),
      ['company', 'box', 'church', 'day', 'person', 'widget'],
    );
  });
});
