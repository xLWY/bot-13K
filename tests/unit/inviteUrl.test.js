import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBotInviteUrl, RECOMMENDED_INVITE_PERMISSIONS } from '../../src/utils/inviteUrl.js';

test('buildBotInviteUrl encodes bot + applications.commands scopes', () => {
    const url = buildBotInviteUrl('123456789012345678', 8n);
    const parsed = new URL(url);

    assert.equal(parsed.origin, 'https://discord.com');
    assert.equal(parsed.pathname, '/oauth2/authorize');
    assert.equal(parsed.searchParams.get('client_id'), '123456789012345678');
    assert.equal(parsed.searchParams.get('scope'), 'bot applications.commands');
    assert.equal(parsed.searchParams.get('permissions'), '8');
});

test('buildBotInviteUrl uses the recommended permission set by default', () => {
    const url = buildBotInviteUrl('42');
    assert.equal(new URL(url).searchParams.get('permissions'), String(RECOMMENDED_INVITE_PERMISSIONS));
});

test('buildBotInviteUrl returns null without a client id', () => {
    assert.equal(buildBotInviteUrl(null), null);
    assert.equal(buildBotInviteUrl(''), null);
});
