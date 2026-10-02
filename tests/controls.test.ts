import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTROLS, globalShortcut } from '../src/client/ui/controls.js';

test('M is the city map with or without Shift, and voice mute never steals it', () => {
  assert.equal(globalShortcut({ code: 'KeyM', key: 'm' }, false), 'map');
  assert.equal(globalShortcut({ code: 'KeyM', key: 'M' }, false), 'map');
  assert.equal(globalShortcut({ code: 'KeyM', key: 'M' }, true), null);
  assert.equal(globalShortcut({ code: 'Slash', key: '?' }, true), 'controls');
  assert.equal(globalShortcut({ code: 'KeyU', key: 'U' }, false), 'mute');
  assert.equal(globalShortcut({ code: 'KeyU', key: 'u' }, true), 'mute');
  assert.equal(globalShortcut({ code: 'KeyZ', key: 'z' }, false), null);
  assert.ok(CONTROLS.Walking.some(([keys, action]) => keys.includes('Z') && action === 'Change camera'));
  assert.ok(CONTROLS.Racing.some(([keys]) => keys.includes('Backspace')));
  assert.ok(CONTROLS.Driving.some(([keys]) => keys.includes('X')));
  assert.deepEqual(CONTROLS.Arena.find(([, action]) => action === 'Slide while running')?.[0], ['Shift + C']);
  assert.deepEqual(CONTROLS.Everywhere.find(([, action]) => action === 'Mute / unmute voice')?.[0], ['U']);
});
