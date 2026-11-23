import {
  dependencySatisfies,
  importSync,
  macroCondition,
} from '@embroider/macros';

interface Inflector {
  pluralize(word: string): string;
  singularize(word: string): string;
}

function appInflector(): Inflector {
  if (
    macroCondition(dependencySatisfies('@ember-data/request-utils', '>=5.3.0'))
  ) {
    return importSync('@ember-data/request-utils/string') as Inflector;
  } else if (macroCondition(dependencySatisfies('ember-inflector', '*'))) {
    return importSync('ember-inflector') as Inflector;
  }
  return {
    pluralize: (word) => `${word}s`,
    singularize: (word) => word.replace(/s$/, ''),
  };
}

let detected: Inflector | undefined;

export function pluralize(word: string): string {
  return (detected ??= appInflector()).pluralize(word);
}

export function singularize(word: string): string {
  return (detected ??= appInflector()).singularize(word);
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
