import path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { logger } from '../utils/logger.js';
import { formatVoiceDuration } from './statsService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');

const FONT = {
    regular: 'Inter',
    medium: 'Inter Medium',
    semibold: 'Inter SemiBold',
    bold: 'Inter Bold'
};

// Statbot-inspired dark palette.
const COLORS = {
    pageA: '#202225',
    pageB: '#1A1D21',
    panel: '#2B2D31',
    panelBorder: '#3A3C40',
    divider: '#35373B',
    text: '#FFFFFF',
    body: '#DBDEE3',
    muted: '#9AA1AC',
    faint: '#6A7078',
    blueA: '#4E7DFF',
    orangeA: '#F4752B',
    orangeB: '#7A3410'
};

function registerFonts() {
    const files = [
        ['Inter-Regular.ttf', FONT.regular],
        ['Inter-Medium.ttf', FONT.medium],
        ['Inter-SemiBold.ttf', FONT.semibold],
        ['Inter-Bold.ttf', FONT.bold]
    ];
    for (const [fileName, family] of files) {
        try {
            GlobalFonts.registerFromPath(path.join(FONTS_DIR, fileName), family);
        } catch (error) {
            logger.warn(`Failed to register font ${fileName}:`, error.message);
        }
    }
}
registerFonts();

function rounded(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

function circle(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();
}

function fitText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let truncated = text;
    while (truncated.length > 1 && ctx.measureText(`${truncated}…`).width > maxWidth) {
        truncated = truncated.slice(0, -1);
    }
    return `${truncated}…`;
}

async function preloadAvatars(urls) {
    const map = new Map();
    await Promise.all(urls.map(async (url) => {
        if (!url || map.has(url)) return;
        const image = await loadImage(url).catch(() => null);
        map.set(url, image);
    }));
    return map;
}

function drawAvatar(ctx, image, x, y, size, { ring = null, fallbackText = '?', hue = 0 } = {}) {
    const cx = x + size / 2;
    const cy = y + size / 2;

    ctx.save();
    circle(ctx, cx, cy, size / 2);
    ctx.clip();

    if (image) {
        ctx.drawImage(image, x - Math.max(0, (size - image.width) / 2), y - Math.max(0, (size - image.height) / 2), size, size);
    } else {
        const grad = ctx.createLinearGradient(x, y, x + size, y + size);
        grad.addColorStop(0, `hsl(${(hue || 0) % 360}, 60%, 52%)`);
        grad.addColorStop(1, `hsl(${((hue || 0) + 40) % 360}, 60%, 42%)`);
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, size, size);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `700 ${Math.floor(size * 0.46)}px ${FONT.bold}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(fallbackText, cx, cy + 1);
    }
    ctx.restore();

    if (ring) {
        ctx.save();
        ctx.strokeStyle = ring;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, size / 2 + 1, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}

function dateLabel(timestamp) {
    return new Date(timestamp).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
}

/**
 * Prefers the cleaned display name; if it is fully unusable, falls back to the
 * (usually plainer) global username before settling on a generic label.
 */
function displayNameFor(entry) {
    const cleaned = sanitizeDisplayName(entry.name);
    if (cleaned !== 'Membre') return cleaned;
    const fallback = sanitizeDisplayName(entry.username);
    return fallback !== 'Membre' ? fallback : 'Membre';
}

function hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 0xff;
    const g = (n >> 8) & 0xff;
    const b = n & 0xff;
    return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Cleans a user-supplied name for canvas rendering. Keeps only characters the
 * Inter font can actually draw: ASCII + Latin (incl. accents), Greek,
 * Cyrillic, common punctuation/currency. Everything else — CJK kanji/kana,
 * Hangul, emoji, invisible/control chars, zalgo combining marks — is removed
 * so names never render as hollow boxes.
 */
function sanitizeDisplayName(name) {
    let s = String(name || '')
        .normalize('NFKC')
        .replace(/[^\u0020-\u007E\u00A0-\u024F\u0300-\u036F\u0370-\u03FF\u0400-\u04FF\u1E00-\u1EFF\u2000-\u206F\u20AC\u2018-\u201F]/g, '')
        .replace(/([\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF])\1{2,}/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
    return s || 'Membre';
}

/**
 * Fills the page: very dark background, a barely-there colored bloom in the
 * top-left corner and a faint top-right glow. Kept subtle by design.
 */
function drawStatPage(ctx, W, H, accent) {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, COLORS.pageA);
    bg.addColorStop(1, COLORS.pageB);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const bloom = ctx.createRadialGradient(-W * 0.05, -H * 0.05, 10, -W * 0.05, -H * 0.05, W * 0.45);
    bloom.addColorStop(0, hexToRgba(accent, 0.22));
    bloom.addColorStop(0.5, hexToRgba(accent, 0.06));
    bloom.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(W * 0.98, -H * 0.05, 10, W * 0.98, -H * 0.05, W * 0.35);
    glow.addColorStop(0, 'rgba(255,255,255,0.05)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
}

function drawHeader(ctx, X, Y, { title, subtitle }) {
    ctx.font = `700 42px ${FONT.bold}`;
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(title, X, Y + 46);

    ctx.font = `500 19px ${FONT.regular}`;
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.fillText(subtitle, X, Y + 78);
}

function drawSectionTitle(ctx, X, Y, label, accent) {
    ctx.font = `700 20px ${FONT.bold}`;
    ctx.fillStyle = accent;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(label.toUpperCase(), X, Y);
}

/**
 * Renders the "Top" card: a dominant horizontal bar chart of Top Messages
 * with avatars, then a compact Top Vocal list. 1280px wide, dark canvas.
 */
export async function renderTopImage({
    guildName,
    guildIconUrl,
    startedAt,
    memberCount,
    messageEntries,
    voiceEntries,
    totalMessages,
    totalVoiceSeconds
}) {
    const W = 1280;
    const pad = 32;
    const headerH = 92;
    const sectionH = 40;
    const rowH = 30;
    const rowGap = 8;
    const listH = 33;
    const listGap = 7;
    const sectionGap = 30;

    const chartCount = Math.max(0, Math.min(messageEntries.length, 6));
    const listCount = Math.max(0, Math.min(voiceEntries.length, 8));

    const H = pad + headerH
        + sectionH + chartCount * (rowH + rowGap)
        + sectionGap + sectionH + listCount * (listH + listGap)
        + pad;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    drawStatPage(ctx, W, H, COLORS.orangeA);

    const avatars = await preloadAvatars(
        [...messageEntries, ...voiceEntries].map((e) => e.avatarUrl).filter(Boolean)
    );

    drawHeader(ctx, pad, pad, {
        title: 'Top',
        subtitle: `${guildName || 'Serveur'} · ${memberCount} membre(s) suivi(s) · depuis le ${dateLabel(startedAt)}`
    });

    const grandTotalMessages = totalMessages ?? messageEntries.reduce((sum, e) => sum + e.value, 0);
    const grandTotalVoice = totalVoiceSeconds ?? voiceEntries.reduce((sum, e) => sum + e.value, 0);
    ctx.font = `600 18px ${FONT.semibold}`;
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(
        `${grandTotalMessages.toLocaleString('fr-FR')} messages · ${formatVoiceDuration(grandTotalVoice)} en vocal`,
        W - pad,
        pad + 46
    );

    const maxValue = Math.max(1, ...messageEntries.map((e) => e.value));

    // --- Top Messages: dominant bar chart ---
    let y = pad + headerH;
    drawSectionTitle(ctx, pad, y + 10, 'Top Messages', COLORS.orangeA);
    y += sectionH;

    const labelW = 240;
    const rankSize = 24;
    const barTrackH = 8;
    const barTrackX = pad + labelW;
    const valueW = 90;
    const barTrackW = W - pad - barTrackX - valueW - 8;

    for (let i = 0; i < chartCount; i++) {
        const entry = messageEntries[i];
        const rowTop = y + i * (rowH + rowGap);
        const rowCenter = rowTop + rowH / 2;
        const leader = i === 0;

        circle(ctx, pad + rankSize / 2, rowCenter, rankSize / 2);
        ctx.fillStyle = leader ? 'rgba(255,255,255,0.12)' : COLORS.panel;
        ctx.fill();
        ctx.strokeStyle = leader ? 'rgba(255,255,255,0.5)' : COLORS.panelBorder;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = leader ? COLORS.text : COLORS.muted;
        ctx.font = `700 12px ${FONT.bold}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), pad + rankSize / 2, rowCenter + 0.5);

        const avatarX = pad + rankSize + 14;
        const avatarSize = 26;
        drawAvatar(ctx, avatars.get(entry.avatarUrl) || null, avatarX, rowCenter - avatarSize / 2, avatarSize, {
            fallbackText: displayNameFor(entry).charAt(0).toUpperCase(),
            hue: i * 47 + 190
        });

        const nameX = avatarX + avatarSize + 12;
        ctx.font = `600 17px ${FONT.semibold}`;
        ctx.fillStyle = COLORS.body;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(fitText(ctx, displayNameFor(entry), 170), nameX, rowCenter - 1);

        const trackY = rowCenter - barTrackH / 2;
        rounded(ctx, barTrackX, trackY, barTrackW, barTrackH, barTrackH / 2);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fill();

        const fraction = entry.value / maxValue;
        const fillW = Math.max(4, fraction * barTrackW);
        const grad = ctx.createLinearGradient(barTrackX, 0, barTrackX + fillW, 0);
        grad.addColorStop(0, '#F0A868');
        grad.addColorStop(0.55, COLORS.orangeA);
        grad.addColorStop(1, COLORS.orangeB);
        rounded(ctx, barTrackX, trackY, fillW, barTrackH, barTrackH / 2);
        ctx.globalAlpha = leader ? 1 : 0.55;
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.font = `700 17px ${FONT.bold}`;
        ctx.fillStyle = leader ? COLORS.text : COLORS.muted;
        ctx.textAlign = 'right';
        ctx.fillText(entry.value.toLocaleString('fr-FR'), W - pad, rowCenter - 1);
    }

    // --- Top Vocal: compact list ---
    y = pad + headerH + sectionH + chartCount * (rowH + rowGap) + sectionGap;
    drawSectionTitle(ctx, pad, y + 10, 'Top Vocal', COLORS.blueA);
    y += sectionH;

    for (let i = 0; i < listCount; i++) {
        const entry = voiceEntries[i];
        const rowTop = y + i * (listH + listGap);
        const rowCenter = rowTop + listH / 2;
        const leader = i === 0;

        if (i > 0) {
            ctx.strokeStyle = COLORS.divider;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(pad, rowTop);
            ctx.lineTo(W - pad, rowTop);
            ctx.stroke();
        }

        const rankSize = 20;
        circle(ctx, pad + rankSize / 2, rowCenter, rankSize / 2);
        ctx.fillStyle = leader ? 'rgba(255,255,255,0.12)' : COLORS.panel;
        ctx.fill();
        ctx.strokeStyle = leader ? 'rgba(255,255,255,0.5)' : COLORS.panelBorder;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.font = `700 11px ${FONT.bold}`;
        ctx.fillStyle = leader ? COLORS.text : COLORS.muted;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), pad + rankSize / 2, rowCenter + 0.5);

        const avatarX = pad + rankSize + 12;
        const avatarSize = 24;
        drawAvatar(ctx, avatars.get(entry.avatarUrl) || null, avatarX, rowCenter - avatarSize / 2, avatarSize, {
            fallbackText: displayNameFor(entry).charAt(0).toUpperCase(),
            hue: i * 47 + 190
        });

        const nameX = avatarX + avatarSize + 12;
        ctx.font = `600 16px ${FONT.semibold}`;
        ctx.fillStyle = COLORS.body;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(fitText(ctx, displayNameFor(entry), 420), nameX, rowCenter);

        ctx.font = `600 16px ${FONT.semibold}`;
        ctx.fillStyle = leader ? COLORS.text : COLORS.muted;
        ctx.textAlign = 'right';
        ctx.fillText(formatVoiceDuration(entry.value), W - pad, rowCenter);
    }

    return canvas.toBuffer('image/png');
}