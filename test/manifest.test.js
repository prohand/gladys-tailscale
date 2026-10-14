// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The store indexer validates the manifest, but nothing there can know which
// handlers the code registers or which keys it fires — these tests keep both
// in sync, and catch the store rules that are easiest to miss.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ACTIONS, createTailscaleApp } from '../src/app.js';
import { AUTH_METHODS, DEFAULT_CONFIG } from '../src/config.js';
import {
  AUTHORIZATIONS,
  CONNECTION_STATES,
  SCENE_ACTIONS,
  SCENE_TRIGGERS,
  sceneEventOf,
} from '../src/capabilities/scenes.js';
import { TAILNET_WIDGET, WIDGET_FILTERS } from '../src/capabilities/widget.js';
import { CHANGES } from '../src/tailscale/tailnet.js';
import { normalizeMachine } from '../src/tailscale/machines.js';
import { LANGUAGES } from '../src/i18n.js';
import { rawDevice } from './helpers/fakeTailscale.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(await read('../gladys-assistant-integration.json'));
const packageJson = JSON.parse(await read('../package.json'));

test('the version follows package.json and tags the image', () => {
  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.docker_image, `ghcr.io/prohand/gladys-tailscale:${packageJson.version}`);
  assert.match(
    manifest.cover_image,
    /^https:\/\/raw\.githubusercontent\.com\/prohand\/gladys-tailscale\//,
  );
});

test('the integration declares the cloud transport only', () => {
  // The Tailscale API is the only channel: the container is not on the
  // tailnet. Declaring "local" would show a "Prefer local" toggle that does
  // nothing.
  assert.deepEqual(manifest.transports, ['cloud']);
});

test('the categories stay inside the vocabulary the store indexes', () => {
  const vocabulary = [
    'climate',
    'lighting',
    'energy',
    'security',
    'multimedia',
    'appliances',
    'environment',
    'protocols',
    'network',
    'notifications',
    'assistants',
    'services',
  ];
  const { categories } = manifest;
  assert.ok(categories.length >= 1 && categories.length <= 3);
  for (const category of categories) {
    assert.ok(vocabulary.includes(category), `unknown category "${category}"`);
  }
});

test('the Gladys floor covers the scene and widget declarations', () => {
  const [major, minor] = manifest.gladys_version.replace(/^>=/, '').split('.').map(Number);
  assert.ok(major > 5 || (major === 5 && minor >= 1), `got ${manifest.gladys_version}`);
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      assert.ok(!(field.key in DEFAULT_CONFIG), `section "${field.key}" stores no value`);
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `config key "${field.key}" is unknown to the code`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `default of "${field.key}"`);
    }
  }
  const methods = manifest.config_schema.find((field) => field.key === 'auth_method');
  assert.deepEqual(
    methods.options.map((option) => option.value).sort(),
    Object.values(AUTH_METHODS).sort(),
  );
});

test('secrets carry no default and every placeholder is a multi-language object', () => {
  const fields = [
    ...manifest.config_schema,
    ...manifest.scene_triggers.flatMap((trigger) => trigger.fields ?? []),
    ...manifest.scene_actions.flatMap((action) => action.fields ?? []),
    ...manifest.widgets.flatMap((widget) => widget.settings ?? []),
  ];
  for (const field of fields) {
    assert.match(field.key, /^[a-z0-9_]+$/);
    if (field.type === 'secret') {
      assert.equal(field.default, undefined, `secret "${field.key}" cannot have a default`);
    }
    if (field.placeholder !== undefined) {
      assert.equal(typeof field.placeholder, 'object', `placeholder of "${field.key}"`);
      assert.ok(['string', 'number', 'secret'].includes(field.type));
    }
    if (field.source !== undefined) {
      assert.equal(field.options, undefined, `"${field.key}": source and options together`);
    }
  }
});

test('every manifest action, scene action and widget has a handler', async () => {
  const gladys = createFakeGladys({ config: {} });
  createTailscaleApp(gladys, {
    fetch: async () => new Response('{}', { status: 500 }),
    timers: { setInterval: () => 0, clearInterval() {} },
  });

  assert.deepEqual(
    manifest.actions.map((action) => action.key),
    Object.values(ACTIONS),
  );
  for (const action of manifest.actions) {
    const ack = await gladys.fake.action(action.key, {});
    assert.notEqual(ack.error, 'not implemented', `action "${action.key}"`);
  }

  assert.deepEqual(
    manifest.scene_actions.map((action) => action.key).sort(),
    Object.values(SCENE_ACTIONS).sort(),
  );
  for (const action of manifest.scene_actions) {
    const ack = await gladys.fake.sceneAction(action.key, {});
    assert.notEqual(ack.error, 'not implemented', `scene action "${action.key}"`);
  }

  assert.deepEqual(
    manifest.widgets.map((widget) => widget.key),
    [TAILNET_WIDGET],
  );
  const ack = await gladys.fake.widgetGet(TAILNET_WIDGET);
  assert.equal(ack.success, true);
  const filter = manifest.widgets[0].settings.find((setting) => setting.key === 'filter');
  assert.deepEqual(
    filter.options.map((option) => option.value).sort(),
    Object.values(WIDGET_FILTERS).sort(),
  );
});

test('the scene triggers the code fires are the ones the manifest declares', () => {
  assert.deepEqual(
    manifest.scene_triggers.map((trigger) => trigger.key).sort(),
    Object.values(SCENE_TRIGGERS).sort(),
  );

  const gladys = createFakeGladys();
  const machine = normalizeMachine(rawDevice(), Date.parse('2026-10-14T12:00:00Z'));
  for (const kind of Object.values(CHANGES)) {
    const event = sceneEventOf(gladys, { kind, machine });
    const trigger = manifest.scene_triggers.find((entry) => entry.key === event.key);
    assert.ok(trigger, `${kind}: trigger "${event.key}" not declared`);
    // The core keeps only the declared keys: anything else would be lost.
    const declared = new Set([
      ...(trigger.fields ?? []).map((field) => field.key),
      ...(trigger.variables ?? []).map((variable) => variable.key),
    ]);
    for (const key of Object.keys(event.data)) {
      if (key !== 'device') {
        assert.ok(declared.has(key), `${event.key}: "${key}" is not declared`);
      }
    }
    for (const [key, value] of Object.entries(event.data)) {
      assert.ok(['string', 'number', 'boolean'].includes(typeof value), `${event.key}.${key}`);
    }
  }

  const states = manifest.scene_triggers
    .find((trigger) => trigger.key === SCENE_TRIGGERS.CONNECTION_CHANGED)
    .fields.find((field) => field.key === 'state')
    .options.map((option) => option.value);
  assert.deepEqual(states.sort(), Object.values(CONNECTION_STATES).sort());
  const approvals = manifest.scene_triggers
    .find((trigger) => trigger.key === SCENE_TRIGGERS.MACHINE_ADDED)
    .fields.find((field) => field.key === 'authorization')
    .options.map((option) => option.value);
  assert.deepEqual(approvals.sort(), Object.values(AUTHORIZATIONS).sort());
});

/** Every multi-language object of the manifest, with where it sits. */
function multiLanguageTexts(node, path = 'manifest') {
  if (Array.isArray(node)) {
    return node.flatMap((child, index) => multiLanguageTexts(child, `${path}[${index}]`));
  }
  if (node === null || typeof node !== 'object') {
    return [];
  }
  const keys = Object.keys(node);
  if (keys.includes('en') && keys.every((key) => /^[a-z]{2}$/.test(key))) {
    return [{ path, text: node }];
  }
  return keys.flatMap((key) => multiLanguageTexts(node[key], `${path}.${key}`));
}

test('every multi-language text of the manifest carries en, fr, de and es', () => {
  // Gladys shows the reader's language and falls back to English: a missing
  // translation shows up in English in the middle of a translated screen.
  const texts = multiLanguageTexts(manifest);
  assert.ok(texts.length > 50, `only ${texts.length} texts found`);
  for (const { path, text } of texts) {
    assert.deepEqual(Object.keys(text).sort(), [...LANGUAGES].sort(), `${path}: languages`);
    for (const language of LANGUAGES) {
      assert.ok(text[language].trim().length > 0, `${path}.${language} is empty`);
    }
  }
});

test('the per-language length limits of the store hold in every language', () => {
  const within = (text, min, max, where) => {
    for (const language of LANGUAGES) {
      const { length } = text[language];
      assert.ok(length >= min && length <= max, `${where}.${language}: ${length} characters`);
    }
  };
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  within(manifest.description, 10, 100, 'description');
  for (const widget of manifest.widgets) {
    within(widget.label, 3, 30, `widget ${widget.key} label`);
    within(widget.description, 1, 100, `widget ${widget.key} description`);
  }
  for (const section of manifest.config_schema.filter((field) => field.type === 'section')) {
    within(section.description, 1, 1000, `section ${section.key} description`);
  }
});

test('the user documentation exists in every language', async () => {
  for (const language of LANGUAGES) {
    const text = await read(`../docs/${language}.md`);
    assert.match(text, /^# Tailscale/, `docs/${language}.md`);
  }
});
