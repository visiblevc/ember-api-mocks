import EmberApp from 'ember-strict-application-resolver';
import EmberRouter from '@ember/routing/router';
import { registerDeprecationHandler } from '@ember/debug';
import * as QUnit from 'qunit';
import { setApplication } from '@ember/test-helpers';
import { setup } from 'qunit-dom';
import { start as qunitStart, setupEmberOnerrorValidation } from 'ember-qunit';
import { setTesting } from '@embroider/macros';

import { configureDefaults } from './config.ts';

class Router extends EmberRouter {
  location = 'none';
  rootURL = '/';
}

const appModules = Object.values(
  import.meta.glob<{ modules: Record<string, unknown> }>('./app/*.js', {
    eager: true,
  }),
).reduce((all, { modules }) => ({ ...all, ...modules }), {});

class TestApp extends EmberApp {
  modules = {
    './router': Router,
    ...appModules,
  };
}

Router.map(function () {});

export function start() {
  setTesting(true);
  registerDeprecationHandler(() => undefined);
  configureDefaults();
  setApplication(
    TestApp.create({
      autoboot: false,
      rootElement: '#ember-testing',
    }),
  );
  setup(QUnit.assert);
  setupEmberOnerrorValidation();
  qunitStart();
}
