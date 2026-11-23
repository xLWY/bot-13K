import test from 'node:test';
import assert from 'node:assert/strict';
import {
    bulletLines,
    discordTimestamp,
    formatDuration,
    formatNumber,
    keyValue,
    percent,
    plural,
    progressBar,
    statusLabel,
    truncate,
} from '../../src/ui/format.js';

test('formatNumber uses the French locale and tolerates invalid input', () => {
    assert.equal(formatNumber(1234), '1 234');
    assert.equal(formatNumber(-12.5), '-12,5');
    assert.equal(formatNumber('nope'), '?');
});

test('truncate keeps the marker and removes trailing whitespace', () => {
    assert.equal(truncate('Bonjour', 10), 'Bonjour');
    assert.equal(truncate('Bonjour le monde', 10), 'Bonjour l…');
    assert.equal(truncate('abcdefghij ', 10), 'abcdefghi…');
});

test('discordTimestamp accepts dates, strings and numbers', () => {
    assert.equal(discordTimestamp(new Date(1000), 'R'), '<t:1:R>');
    assert.equal(discordTimestamp('1970-01-01T00:00:01Z', 'F'), '<t:1:F>');
    assert.equal(discordTimestamp(1000), '<t:1:R>');
    assert.equal(discordTimestamp(null), 'inconnu');
});

test('progressBar is bounded and handles empty totals', () => {
    assert.equal(progressBar(5, 10, 4), '██░░');
    assert.equal(progressBar(20, 10, 4), '████');
    assert.equal(progressBar(-5, 10, 4), '░░░░');
    assert.equal(progressBar(1, 0, 4), '░░░░');
});

test('progressBar clamps width between 1 and 20', () => {
    assert.equal(progressBar(1, 1, 0).length, 1);
    assert.equal(progressBar(1, 1, 99).length, 20);
});

test('statusLabel uses the semantic emoji set', () => {
    assert.equal(statusLabel(true), '✅ Activé');
    assert.equal(statusLabel(false), '❌ Désactivé');
    assert.equal(statusLabel(true, 'Ouvert', 'Fermé'), '✅ Ouvert');
});

test('keyValue formats a label/value pair', () => {
    assert.equal(keyValue('Salon', '<#12>'), '**Salon :** <#12>');
});

test('bulletLines renders a list or the empty fallback', () => {
    assert.equal(bulletLines(['a', 'b']), '• a\n• b');
    assert.equal(bulletLines([]), '`Aucun`');
    assert.equal(bulletLines([null, '', 'c']), '• c');
});

test('formatDuration covers seconds, minutes, hours and days', () => {
    assert.equal(formatDuration(5000), '5 s');
    assert.equal(formatDuration(65_000), '1 min 5 s');
    assert.equal(formatDuration(3_661_000), '1 h 1 min');
    assert.equal(formatDuration(90_000_000), '1 j 1 h');
    assert.equal(formatDuration(-1), '0 s');
});

test('plural agrees with the count', () => {
    assert.equal(plural(1, 'serveur'), '1 serveur');
    assert.equal(plural(2, 'serveur'), '2 serveurs');
    assert.equal(plural(1, 'catégorie', 'catégories'), '1 catégorie');
});

test('percent is bounded between 0 and 100', () => {
    assert.equal(percent(1, 4), 25);
    assert.equal(percent(10, 4), 100);
    assert.equal(percent(-2, 4), 0);
    assert.equal(percent(1, 0), 0);
});
