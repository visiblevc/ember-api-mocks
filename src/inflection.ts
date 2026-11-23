import {
  dependencySatisfies,
  importSync,
  macroCondition,
} from '@embroider/macros';

interface Inflector {
  pluralize(word: string): string;
  singularize(word: string): string;
}

const IRREGULAR: Record<string, string> = {
  person: 'people',
  child: 'children',
  man: 'men',
  woman: 'women',
};

export function basicPluralize(word: string): string {
  const irregular = IRREGULAR[word];
  if (irregular) {
    return irregular;
  } else if (/[^aeiou]y$/.test(word)) {
    return word.replace(/y$/, 'ies');
  } else if (/(s|x|z|ch|sh)$/.test(word)) {
    return `${word}es`;
  }
  return `${word}s`;
}

export function basicSingularize(word: string): string {
  const irregular = Object.entries(IRREGULAR).find(
    ([, plural]) => plural === word,
  );
  if (irregular) {
    return irregular[0];
  } else if (/ies$/.test(word)) {
    return word.replace(/ies$/, 'y');
  } else if (/(s|x|z|ch|sh)es$/.test(word)) {
    return word.replace(/es$/, '');
  }
  return word.replace(/s$/, '');
}

function appInflector(): Inflector {
  if (
    macroCondition(
      dependencySatisfies('@ember-data/request-utils', '>=5.3.0') ||
        dependencySatisfies('ember-data', '>=5.3.0'),
    )
  ) {
    return importSync('@ember-data/request-utils/string') as Inflector;
  } else if (macroCondition(dependencySatisfies('ember-inflector', '*'))) {
    return importSync('ember-inflector') as Inflector;
  }
  return { pluralize: basicPluralize, singularize: basicSingularize };
}

let custom: Partial<Inflector> = {};
let detected: Inflector | undefined;

function inflector(): Inflector {
  return (detected ??= appInflector());
}

export function setInflector(next: Partial<Inflector>): void {
  custom = next;
}

export function pluralize(word: string): string {
  if (custom.pluralize) {
    return custom.pluralize(word);
  }
  return inflector().pluralize(word);
}

export function singularize(word: string): string {
  if (custom.singularize) {
    return custom.singularize(word);
  }
  return inflector().singularize(word);
}

export function underscore(word: string): string {
  return word
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase();
}

export function dasherize(word: string): string {
  return underscore(word).replace(/_/g, '-');
}

export function camelize(word: string): string {
  return word
    .replace(/[-_\s]+(.)?/g, (_, next: string | undefined) =>
      next ? next.toUpperCase() : '',
    )
    .replace(/^[A-Z]/, (first) => first.toLowerCase());
}
