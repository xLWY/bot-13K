import test from 'node:test';
import assert from 'node:assert/strict';

import {
  escapeHtml,
  sanitizeInput,
  sanitizeMarkdown,
  sanitizeMention,
} from '../../src/utils/sanitization.js';

test('sanitizeMarkdown escapes every Discord markdown control character', () => {
  assert.equal(
    sanitizeMarkdown('a*b_c`d[e]f|g~h'),
    'a\\*b\\_c\\`d\\[e\\]f\\|g\\~h'
  );
});

test('sanitizeMarkdown rejects non-strings', () => {
  assert.equal(sanitizeMarkdown(null), '');
  assert.equal(sanitizeMarkdown(42), '');
});

test('sanitizeInput trims, truncates then removes control characters', () => {
  assert.equal(sanitizeInput('  hello\u0000world  ', 8), 'hellowo');
  assert.equal(sanitizeInput('abc\u001Fdef'), 'abcdef');
});

test('sanitizeInput rejects non-strings', () => {
  assert.equal(sanitizeInput(undefined), '');
});

test('sanitizeMention extracts the id from user, channel and role mentions', () => {
  assert.equal(sanitizeMention('<@!123456789012345678>'), '123456789012345678');
  assert.equal(sanitizeMention('<#123456789012345678>'), '123456789012345678');
  assert.equal(sanitizeMention('<@&123456789012345678>'), '123456789012345678');
});

test('sanitizeMention returns null for invalid or non-string input', () => {
  assert.equal(sanitizeMention('not a mention'), null);
  assert.equal(sanitizeMention(123456789012345678), null);
  assert.equal(sanitizeMention(null), null);
});

test('escapeHtml escapes in the right order', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#039;');
  assert.equal(escapeHtml(null), '');
});
