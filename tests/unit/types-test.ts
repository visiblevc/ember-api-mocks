import { module, test } from 'qunit';

import {
  api,
  belongsTo,
  build,
  buildList,
  defineFactory,
  hasMany,
  payload,
  reply,
  seed,
  seedList,
  seedRecord,
  sequence,
  setupTest,
  sideload,
} from '#src/index.ts';

interface CompanyJson {
  id: number;
  name: string;
}

interface Company {
  id: string;
  name: string;
}

module('Unit | types', function (hooks) {
  setupTest(hooks);

  test('build and seed take the record type', function (assert) {
    const json = build<CompanyJson>('company', { name: 'Acme' });
    const list = buildList<CompanyJson>('company', 2);
    const company = seed<Company>('company', { name: 'Seeded' });
    const companies = seedList<Company>('company', 1);
    const fromJson = seedRecord<Company>(build<CompanyJson>('company'));

    assert.strictEqual(json.name, 'Acme');
    assert.strictEqual(list.length, 2);
    assert.strictEqual(company.name, 'Seeded');
    assert.strictEqual(companies[0]?.name, 'Company #5');
    assert.strictEqual(fromJson.name, 'Company #6');
    assert.deepEqual(payload('company', sideload(json, list[0])).companies, [
      list[0],
    ]);
  });

  test('handles type the README patterns', async function (assert) {
    const create = api
      .create('contact', { name: 'Ada' })
      .match({ contact: { name: 'Ada', tag_ids: ['1', '2'] } })
      .withHeaders({ Authorization: (value) => value?.startsWith('Bearer ') });
    api.put('/reports/:id', ({ params, body }) => ({
      report: { id: params.id, ...body.report },
    }));
    api.post('/files/sign', reply(201, { url: 'https://example.com/upload' }));
    api.update('company', ({ params }) => ({ company: { id: params.id } }));
    api.query('company').returns(buildList('company', 1), { meta: {} });

    await fetch('https://api.example.test/contacts', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer t',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ contact: { name: 'Ada', tag_ids: ['1', '2'] } }),
    });

    assert.strictEqual(create.timesCalled, 1);
    assert.deepEqual(create.lastCall.body.contact.tag_ids, ['1', '2']);
  });

  test('factory definitions type their values', function (assert) {
    defineFactory('typed-company', {
      default: {
        name: (company) => `Company #${company.id}`,
        slug: sequence((n) => `company-${n}`),
      },
      traits: {
        withSubscription: { subscriptions: hasMany('subscription', 1) },
        shouting: (company) => {
          company.name = company.name.toUpperCase();
        },
      },
      relationships: { owner: belongsTo('contact') },
      afterSeed: (model, transient) => [model, transient.role],
    });

    assert.strictEqual(build('typed-company', 'shouting').name, 'COMPANY #1');
  });
});
