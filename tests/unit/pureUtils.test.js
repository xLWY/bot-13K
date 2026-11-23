import test from 'node:test';
import assert from 'node:assert/strict';

import { getMonthName } from '../../src/utils/dateUtils.js';
import {
  getDefaultErrorCodeByType,
  getErrorMetadata,
  resolveErrorCode,
} from '../../src/utils/errorRegistry.js';
import {
  assertAllowlistedIdentifier,
  quoteIdentifier,
} from '../../src/utils/sqlIdentifiers.js';
import {
  formatTicketStaffRoles,
  getTicketStaffRoleIds,
} from '../../src/utils/ticketStaffRoles.js';

test('getTicketStaffRoleIds merges modern and legacy keys, deduping and filtering', () => {
  assert.deepEqual(
    getTicketStaffRoleIds({
      ticketStaffRoleIds: ['123456789012345678', 'bad', '123456789012345678'],
      ticketStaffRoleId: '876543210987654321',
    }),
    ['123456789012345678', '876543210987654321']
  );
});

test('getTicketStaffRoleIds tolerates missing config', () => {
  assert.deepEqual(getTicketStaffRoleIds(null), []);
  assert.deepEqual(getTicketStaffRoleIds({}), []);
});

test('formatTicketStaffRoles renders mentions or the fallback label', () => {
  assert.equal(
    formatTicketStaffRoles({ ticketStaffRoleIds: ['123456789012345678'] }),
    '<@&123456789012345678>'
  );
  assert.equal(formatTicketStaffRoles({}), '`Non défini`');
});

test('assertAllowlistedIdentifier enforces format and allowlist', () => {
  const allowlist = new Set(['guild_id', 'user_id']);
  assert.equal(assertAllowlistedIdentifier('guild_id', allowlist), 'guild_id');
  assert.throws(() => assertAllowlistedIdentifier('', allowlist), /non-empty string/);
  assert.throws(() => assertAllowlistedIdentifier('guild id', allowlist), /unsafe characters/);
  assert.throws(() => assertAllowlistedIdentifier('secret', allowlist), /not in the allowlist/);
  assert.equal(quoteIdentifier('guild_id'), '"guild_id"');
});

test('getMonthName maps 1-12 and refuses out-of-range values', () => {
  assert.equal(getMonthName(1), 'Jan');
  assert.equal(getMonthName(12), 'Dec');
  assert.equal(getMonthName(0), 'Invalid Month');
  assert.equal(getMonthName(13), 'Invalid Month');
});

test('error registry normalizes codes and resolves precedence', () => {
  assert.equal(getErrorMetadata(' rate_limited ').retryable, true);
  assert.equal(getErrorMetadata('NOT_A_CODE').severity, 'high');
  assert.equal(getDefaultErrorCodeByType('database'), 'DATABASE_ERROR');
  assert.equal(getDefaultErrorCodeByType('nope'), 'UNKNOWN_ERROR');

  assert.equal(
    resolveErrorCode({
      errorType: 'database',
      error: { code: 'DISCORD_API_ERROR', context: { errorCode: 'config_error' } },
      context: { errorCode: ' validation_failed ' },
    }),
    'VALIDATION_FAILED'
  );
  assert.equal(
    resolveErrorCode({ errorType: 'network', error: { code: 'CUSTOM_CODE' } }),
    'CUSTOM_CODE'
  );
  assert.equal(resolveErrorCode({ errorType: 'permission' }), 'PERMISSION_DENIED');
});
