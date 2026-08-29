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
 * Fills the page: very dark background + Statbot-style colored "splash"
 * (diagonal gradient blob) anchored in the top-left corner, plus soft
 * decorative circles and a faint top-right glow.
 */
function drawStatPage(ctx, W, H, accent, accentB) {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, COLORS.pageA);
    bg.addColorStop(1, COLORS.pageB);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    const splashH = Math.round(H * 0.3);
    const grad = ctx.createLinearGradient(0, 0, W * 0.62, splashH);
    grad.addColorStop(0, accent);
    grad.addColorStop(0.4, accentB);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, splashH + 80);

    ctx.globalAlpha = 0.07;
    ctx.fillStyle = '#FFFFFF';
    const dx = W * 0.09;
    circle(ctx, dx + 70, 70, 130);
    ctx.fill();
    ctx.globalAlpha = 0.05;
    circle(ctx, dx + 300, 150, 200);
    ctx.fill();
    ctx.globalAlpha = 0.045;
    ctx.fillRect(dx - 40, splashH - 90, 620, 3);

    ctx.globalAlpha = 1;
    ctx.restore();
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
 * Leaderboard row (rank + avatar + name + value) + subtle separators.
 */
function drawRankRow(ctx, opts) {
    const {
        colX, colW, rowTop, rowH, entry, index, avatarImages, accent, accentB, valueText, maxEntries
    } = opts;

    if (index > 0) {
        ctx.strokeStyle = COLORS.divider;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(colX, rowTop);
        ctx.lineTo(colX + colW, rowTop);
        ctx.stroke();
    }

    const rankSize = 38;
    const rankX = colX;
    const rankY = rowTop + (rowH - rankSize) / 2;
    if (index < 3) {
        const grad = ctx.createLinearGradient(rankX, rankY, rankX + rankSize, rankY + rankSize);
        grad.addColorStop(0, index === 0 ? '#FFD75E' : index === 1 ? '#DDE3EA' : '#F0A868');
        grad.addColorStop(1, index === 0 ? '#E8A622' : index === 1 ? '#A6B0BD' : '#C76A2A');
        circle(ctx, rankX + rankSize / 2, rankY + rankSize / 2, rankSize / 2);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.fillStyle = '#10141A';
        ctx.font = `700 ${Math.floor(rankSize * 0.46)}px ${FONT.bold}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(index + 1), rankX + rankSize / 2, rankY + rankSize / 2 + 1);
    } else {
        rounded(ctx, rankX, rankY, rankSize, rankSize, roundSmall(rankSize));
        ctx.fillStyle = COLORS.panel;
        ctx.fill();
        ctx.strokeStyle = COLORS.panelBorder;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = COLORS.muted;
        ctx.font = `700 ${Math.floor(rankSize * 0.44)}px ${FONT.bold}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(index + 1), rankX + rankSize / 2, rankY + rankSize / 2 + 1);
    }

    const avatarSize = 40;
    const avatarX = colX + rankSize + 14;
    const avatarY = rowTop + (rowH - avatarSize) / 2;
    drawAvatar(ctx, avatarImages.get(entry.avatarUrl) || null, avatarX, avatarY, avatarSize, {
        ring: index < 3 ? '#FFFFFF66' : null,
        fallbackText: (entry.name || '?').charAt(0).toUpperCase(),
        hue: index * 47 + 190
    });

    const nameX = avatarX + avatarSize + 14;
    const nameMaxW = colW - (nameX - colX) - 170;
    ctx.font = `600 19px ${FONT.semibold}`;
    ctx.fillStyle = COLORS.body;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(fitText(ctx, entry.name || 'Membre', nameMaxW), nameX, rowTop + rowH / 2 - 3);

    ctx.font = `700 20px ${FONT.bold}`;
    ctx.fillStyle = accent;
    ctx.textAlign = 'right';
    ctx.fillText(valueText, colX + colW - 6, rowTop + rowH / 2 - 3);
}

function drawValueBar(ctx, x, y, w, h, fraction, accent) {
    rounded(ctx, x, y, w, h, h / 2);
    ctx.fillStyle = COLORS.panel;
    ctx.fill();
    const fillW = Math.max(0, Math.min(1, fraction)) * w;
    if (fillW >= 2) {
        const grad = ctx.createLinearGradient(x, 0, x + fillW, 0);
        grad.addColorStop(0, accent);
        grad.addColorStop(1, accent);
        rounded(ctx, x, y, fillW, h, h / 2);
        ctx.fillStyle = grad;
        ctx.fill();
    }
}

function roundSmall(size) {
    return Math.max(8, Math.round(size * 0.28));
}

/**
 * Renders the "Top" card (Top Messages / Top Vocal), Statbot style: 1280px
 * wide, orange splash, two leaderboard columns.
 */
export async function renderTopImage({
    guildName,
    guildIconUrl,
    startedAt,
    memberCount,
    messageEntries,
    voiceEntries
}) {
    const W = 1280;
    const pad = 28;
    const headerH = 120;
    const sectionH = 52;
    const rowH = 62;
    const rowGap = 4;
    const footerH = 46;
    const colGap = 72;
    const colW = (W - pad * 2 - colGap) / 2;
    const rows = Math.max(messageEntries.length, voiceEntries.length);

    const H = pad * 2 + headerH + sectionH + rows * rowH + (rows - 1) * rowGap + footerH;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    drawStatPage(ctx, W, H, COLORS.orangeA, COLORS.orangeB);

    const top = pad;
    drawHeader(ctx, pad, top, {
        title: 'Top',
        subtitle: `${guildName || 'Serveur'} · ${memberCount} membre(s) suivi(s) · depuis le ${dateLabel(startedAt)}`
    });

    const avatars = await preloadAvatars(
        [...messageEntries, ...voiceEntries].map((e) => e.avatarUrl).filter(Boolean)
    );

    const sectionsTop = top + headerH;
    drawSectionTitle(ctx, pad, sectionsTop + 12, 'Top Messages', COLORS.orangeA);
    drawSectionTitle(ctx, pad + colW + colGap, sectionsTop + 12, 'Top Vocal', COLORS.blueA);

    // Vertical divider between columns.
    const divX = pad + colW + colGap / 2;
    ctx.strokeStyle = COLORS.divider;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(divX, sectionsTop + 4);
    ctx.lineTo(divX, H - pad - footerH);
    ctx.stroke();

    const rowsTop = sectionsTop + sectionH;

    const drawColumn = (entries, colIndex, accent, isVoice) => {
        const colX = pad + colIndex * (colW + colGap);
        entries.forEach((entry, index) => {
            const rowTop = rowsTop + index * (rowH + rowGap);
            const valueText = isVoice
                ? formatVoiceDuration(entry.value)
                : entry.value.toLocaleString('fr-FR');
            drawRankRow(ctx, {
                colX,
                colW,
                rowTop,
                rowH,
                entry,
                index,
                avatarImages: avatars,
                accent,
                valueText,
                maxEntries: entries.length
            });
            drawValueBar(
                ctx,
                colX + 52 + 14 + 14,
                rowTop + rowH - 9,
                colW - 52 - 42 - 24,
                3,
                index === 0 ? 1 : 0.4,
                accent
            );
        });
    };

    drawColumn(messageEntries, 0, COLORS.orangeA, false);
    drawColumn(voiceEntries, 1, COLORS.blueA, true);

    ctx.font = `500 15px ${FONT.regular}`;
    ctx.fillStyle = COLORS.faint;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`s?t · données cumulées depuis le ${dateLabel(startedAt)}`, W / 2, H - pad / 2 - 2);

    return canvas.toBuffer('image/png');
}