import RESTAdapter from '@ember-data/adapter/rest';
import { InvalidError } from '@ember-data/adapter/error';
import Model, { attr, belongsTo, hasMany } from '@ember-data/model';
import RESTSerializer from '@ember-data/serializer/rest';
import { fragment, fragmentArray } from 'ember-data-model-fragments/attributes';
import Fragment from 'ember-data-model-fragments/fragment';
import {
  fragmentApplyTransforms,
  fragmentExtractAttributes,
  fragmentTransformFor,
} from 'ember-data-model-fragments/serializers/utils';

import { pluralize, singularize, underscore } from '#src/inflection.ts';

import { API_HOST } from '../config.ts';

class Adapter extends RESTAdapter {
  host = API_HOST;

  pathForType(modelName) {
    return pluralize(underscore(modelName));
  }

  handleResponse(status, headers, payload, requestData) {
    if (this.isInvalid(status, headers, payload)) {
      return new InvalidError(
        Object.entries(payload.errors).flatMap(([key, messages]) =>
          [messages].flat().map((detail) => ({
            detail,
            source: { pointer: `/data/attributes/${key}` },
          })),
        ),
      );
    }
    return super.handleResponse(status, headers, payload, requestData);
  }
}

class Serializer extends RESTSerializer {
  keyForAttribute(name) {
    return underscore(name);
  }

  keyForRelationship(name, kind) {
    return kind === 'belongsTo'
      ? `${underscore(name)}_id`
      : `${singularize(underscore(name))}_ids`;
  }

  payloadKeyFromModelName(modelName) {
    return underscore(modelName);
  }

  serializeHasMany() {}

  transformFor(attributeType) {
    return fragmentTransformFor(this, attributeType, super.transformFor);
  }

  applyTransforms(typeClass, data) {
    return fragmentApplyTransforms(this, typeClass, data);
  }

  extractAttributes(modelClass, resourceHash) {
    return fragmentExtractAttributes(
      this,
      modelClass,
      resourceHash,
      super.extractAttributes,
    );
  }
}

class Company extends Model {
  @attr name;
  @attr events;
  @fragment('address') address;
  @fragmentArray('address') branches;
  @hasMany('subscription', { async: false, inverse: 'company' })
  subscriptions;
  @hasMany('contact', { async: false, inverse: 'company' }) contacts;
}

class Subscription extends Model {
  @attr planId;
  @belongsTo('company', { async: false, inverse: 'subscriptions' }) company;
}

class Contact extends Model {
  @attr name;
  @belongsTo('company', { async: false, inverse: 'contacts' }) company;
}

class Address extends Fragment {
  @attr street;
  @attr city;
}

export const modules = {
  './models/company': Company,
  './models/subscription': Subscription,
  './models/contact': Contact,
  './models/address': Address,
  ...Object.fromEntries(
    ['company', 'subscription', 'contact'].flatMap((name) => [
      [`./adapters/${name}`, Adapter],
      [`./serializers/${name}`, Serializer],
    ]),
  ),
};
