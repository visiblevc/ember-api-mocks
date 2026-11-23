import {
  belongsTo,
  defineFactory,
  fragment,
  hasMany,
  jsonApi,
  rest,
} from '#src/index.ts';

defineFactory('company', {
  default: {
    name: (company) => `Company #${company.id}`,
    events: { added_data_source: true },
  },
  traits: {
    withSubscription: {
      subscriptions: hasMany('subscription', 1, { plan_id: 'custom' }),
    },
    withAddress: { address: fragment('address') },
  },
});

defineFactory('subscription', {
  default: { plan_id: 'starter' },
  traits: { custom: { plan_id: 'custom' } },
  relationships: { company: belongsTo('company') },
});

defineFactory('contact', {
  default: { name: 'Ada' },
});

defineFactory('address', {
  default: { street: '1 Main St', city: 'Springfield' },
  traits: { remote: { city: 'Remote' } },
});

defineFactory('post', {
  format: rest(),
  default: { title: (post) => `Post #${post.id}` },
  traits: {
    withComments: { comments: hasMany('comment', 2) },
    withAuthor: { author: belongsTo('author') },
  },
  relationships: { author: belongsTo('author') },
});

defineFactory('comment', {
  format: rest(),
  default: { body: 'Nice' },
  relationships: { post: belongsTo('post') },
});

defineFactory('author', {
  format: rest(),
  default: { name: 'Grace' },
});

defineFactory('investor', {
  format: jsonApi(),
  default: { name: (investor) => `Investor #${investor.id}` },
  traits: {
    withPeople: { people: hasMany('person', 2) },
    withGroup: { group: belongsTo('investor-group') },
  },
  relationships: {
    group: belongsTo('investor-group'),
    people: hasMany('person'),
  },
});

defineFactory('person', {
  format: jsonApi(),
  default: { 'first-name': 'Ada' },
  relationships: { investor: belongsTo('investor') },
});

defineFactory('investor-group', {
  format: jsonApi(),
  default: { name: 'Seed' },
});
