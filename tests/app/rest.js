import RESTAdapter from '@ember-data/adapter/rest';
import Model, { attr, belongsTo, hasMany } from '@ember-data/model';
import RESTSerializer from '@ember-data/serializer/rest';

import { API_HOST } from '../config.ts';

class Adapter extends RESTAdapter {
  host = API_HOST;
}

class Serializer extends RESTSerializer {}

class Post extends Model {
  @attr title;
  @belongsTo('author', { async: false, inverse: 'posts' }) author;
  @hasMany('comment', { async: false, inverse: 'post' }) comments;
}

class Comment extends Model {
  @attr body;
  @belongsTo('post', { async: false, inverse: 'comments' }) post;
}

class Author extends Model {
  @attr name;
  @hasMany('post', { async: false, inverse: 'author' }) posts;
}

export const modules = {
  './models/post': Post,
  './models/comment': Comment,
  './models/author': Author,
  ...Object.fromEntries(
    ['post', 'comment', 'author'].flatMap((name) => [
      [`./adapters/${name}`, Adapter],
      [`./serializers/${name}`, Serializer],
    ]),
  ),
};
