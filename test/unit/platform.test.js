import test from 'node:test';
import assert from 'node:assert/strict';
import { formatKeys } from '../../src/platform.js';

test('mac keeps symbols', () => {
  assert.equal(formatKeys('⇧⌘Z', true), '⇧⌘Z');
});

test('windows shows Ctrl, Shift and Alt', () => {
  assert.equal(formatKeys('⌘Z', false), 'Ctrl+Z');
  assert.equal(formatKeys('⇧⌘Z', false), 'Ctrl+Shift+Z');
  assert.equal(formatKeys('⌘C ⌘X ⌘V ⌘D', false), 'Ctrl+C Ctrl+X Ctrl+V Ctrl+D');
  assert.equal(formatKeys('⌘] / ⌘[', false), 'Ctrl+] / Ctrl+[');
  assert.equal(formatKeys('⌘0 / ⌘1 / ⌘2', false), 'Ctrl+0 / Ctrl+1 / Ctrl+2');
  assert.equal(formatKeys('Пробел + ⌘ или Z + перо', false), 'Пробел + Ctrl или Z + перо');
  assert.equal(formatKeys('⌘ при перетаскивании', false), 'Ctrl при перетаскивании');
  assert.equal(formatKeys('⌥ + перетаскивание', false), 'Alt + перетаскивание');
  assert.equal(formatKeys('⌘,', false), 'Ctrl+,');
});
