import { module, test } from 'qunit';

import {
  build,
  buildList,
  seed,
  seedList,
  seedRecord,
  setupTest,
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
    const fromJson = seedRecord<Company>(build('company', { name: 'Built' }));

    assert.strictEqual(json.name, 'Acme');
    assert.strictEqual(list.length, 2);
    assert.strictEqual(company.name, 'Seeded');
    assert.strictEqual(companies[0]?.name, 'Company #5');
    assert.strictEqual(fromJson.name, 'Built');
  });
});
