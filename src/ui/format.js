/**
 * Formatage pur, sans dépendance Discord.
 *
 * Ce module est volontairement indépendant de `discord.js` : il peut être
 * importé et testé même quand les dépendances ne sont pas installées.
 * `src/ui/kit.js` réexporte ces helpers pour les commandes.
 */

const numberFormatter = new Intl.NumberFormat('fr-FR');

export function formatNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? numberFormatter.format(n) : '?';
}

export function truncate(value, max = 100, marker = '…') {
    const text = String(value ?? '');
    if (text.length <= max) return text;
    return `${text.slice(0, Math.max(0, max - marker.length)).trimEnd()}${marker}`;
}

export function discordTimestamp(value, format = 'R') {
    if (!value) return 'inconnu';
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
    if (!Number.isFinite(time)) return 'inconnu';
    return `<t:${Math.floor(time / 1000)}:${format}>`;
}

export function progressBar(value, total, width = 12) {
    const requested = Number(width);
    const size = Math.min(20, Math.max(1, Math.floor(Number.isFinite(requested) ? requested : 12)));
    const max = Math.max(0, Number(total) || 0);
    const current = Math.min(max, Math.max(0, Number(value) || 0));
    if (max === 0) return '░'.repeat(size);
    const filled = Math.round((current / max) * size);
    return '█'.repeat(filled) + '░'.repeat(size - filled);
}

export function statusLabel(enabled, enabledText = 'Activé', disabledText = 'Désactivé') {
    return enabled ? `✅ ${enabledText}` : `❌ ${disabledText}`;
}

export function keyValue(label, value) {
    return `**${label} :** ${value}`;
}

export function bulletLines(values, prefix = '•') {
    const items = (Array.isArray(values) ? values : [values]).filter((v) => v !== null && v !== undefined && v !== '');
    return items.length ? items.map((item) => `${prefix} ${item}`).join('\n') : '`Aucun`';
}

export function formatDuration(ms) {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    if (total < 60) return `${total} s`;
    const minutes = Math.floor(total / 60);
    if (minutes < 60) return `${minutes} min ${total % 60} s`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h ${minutes % 60} min`;
    return `${Math.floor(hours / 24)} j ${hours % 24} h`;
}

export function plural(count, singular, pluralForm = `${singular}s`) {
    return `${formatNumber(count)} ${Number(count) === 1 ? singular : pluralForm}`;
}

export function percent(value, total) {
    const max = Number(total) || 0;
    if (max <= 0) return 0;
    return Math.min(100, Math.max(0, Math.round((Number(value) || 0) / max * 100)));
}
