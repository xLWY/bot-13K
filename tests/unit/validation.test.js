import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateCustomId,
  validateDiscordId,
  validateEnum,
  validateNumber,
  validateRange,
  validateRequiredProps,
  validateString,
  validateUrl,
} from '../../src/utils/validation.js';

test('validateString truncates over-long strings but rejects other types', () => {
  assert.equal(validateString('hello'), 'hello');
  assert.equal(validateString('abcdef', 'field', 3), 'abc');
  assert.equal(validateString('', 'field'), null);
  assert.equal(validateString(42, 'field'), null);
});

test('validateNumber rejects NaN and negative values', () => {
  assert.equal(validateNumber(5), 5);
  assert.equal(validateNumber(-1), null);
  assert.equal(validateNumber(Number.NaN), null);
  assert.equal(validateNumber('5'), null);
});

test('validateDiscordId requires 18 to 20 digits', () => {
  assert.equal(validateDiscordId('123456789012345678'), '123456789012345678');
  assert.equal(validateDiscordId('12345678901234567'), null);
  assert.equal(validateDiscordId('<@123456789012345678>'), null);
});

test('validateCustomId restricts characters and length', () => {
  assert.equal(validateCustomId('ticket_close:1'), null);
  assert.equal(validateCustomId('ticket_close'), 'ticket_close');
  assert.equal(validateCustomId('a'.repeat(101)), null);
  assert.equal(validateCustomId(''), null);
});

test('validateRequiredProps checks presence, not truthiness', () => {
  assert.equal(validateRequiredProps({ a: null }, ['a']), true);
  assert.equal(validateRequiredProps({ a: 1 }, ['a', 'b']), false);
  assert.equal(validateRequiredProps(null, ['a']), false);
});

test('validateUrl accepts absolute URLs only', () => {
  assert.equal(validateUrl('https://example.com/path'), 'https://example.com/path');
  assert.equal(validateUrl('not a url'), null);
  assert.equal(validateUrl(''), null);
});

test('validateRange and validateEnum enforce their bounds', () => {
  assert.equal(validateRange(5, 1, 10), 5);
  assert.equal(validateRange(11, 1, 10), null);
  assert.equal(validateRange('5', 1, 10), null);
  assert.equal(validateEnum('a', ['a', 'b']), 'a');
  assert.equal(validateEnum('c', ['a', 'b']), null);
});
