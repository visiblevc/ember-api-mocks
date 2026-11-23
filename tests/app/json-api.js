import JSONAPIAdapter from '@ember-data/adapter/json-api';
import Model, { attr, belongsTo, hasMany } from '@ember-data/model';
import JSONAPISerializer from '@ember-data/serializer/json-api';

import { API_HOST } from '../config.ts';

class Adapter extends JSONAPIAdapter {
  host = API_HOST;
}

class Serializer extends JSONAPISerializer {}

class Investor extends Model {
  @attr name;
  @belongsTo('investor-group', { async: false, inverse: 'investors' }) group;
  @hasMany('person', { async: false, inverse: 'investor' }) people;
}

class Person extends Model {
  @attr firstName;
  @belongsTo('investor', { async: false, inverse: 'people' }) investor;
}

class InvestorGroup extends Model {
  @attr name;
  @hasMany('investor', { async: false, inverse: 'group' }) investors;
}

export const modules = {
  './models/investor': Investor,
  './models/person': Person,
  './models/investor-group': InvestorGroup,
  ...Object.fromEntries(
    ['investor', 'person', 'investor-group'].flatMap((name) => [
      [`./adapters/${name}`, Adapter],
      [`./serializers/${name}`, Serializer],
    ]),
  ),
};
