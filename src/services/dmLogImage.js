import path from 'path';
import { fileURLToPath } from 'url';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { logger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');

const FONT = {
    regular: 'Inter',
    semibold: 'Inter SemiBold',
    bold: 'Inter Bold'
};

const COLORS = {
    page: '#202225',
    card: '#2B2D31',
    divider: '#3B3D41',
    title: '#F2F3F5',
    label: '#72767D',
    body: '#DCDDDE',
    muted: '#8E9297'
};

function registerFonts() {
    const files = [
        ['Inter-Regular.ttf', FONT.regular],
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

function circle(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();
}

function roundedRect(ctx, x, y, w, h, r) {
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

function sanitize(text) {
    let s = String(text || '')
        .normalize('NFKC')
        .replace(/[^\u0020-\u007E\u00A0-\u024F\u0300-\u036F\u0370-\u03FF\u0400-\u04FF\u1E00-\u1EFF\u2000-\u206F\u20AC\u2018-\u201F]/g, '')
        .replace(/([\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF])\1{2,}/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
    return s || '…';
}

function wrapText(ctx, text, maxWidth) {
    const lines = [];
    const paragraphs = String(text).split(/\r?\n/);
    for (const paragraph of paragraphs) {
        if (!paragraph) {
            lines.push('');
            continue;
        }
        const words = paragraph.split(/\s+/);
        let line = '';
        for (const word of words) {
            const test = line ? `${line} ${word}` : word;
            if (ctx.measureText(test).width > maxWidth && line) {
                lines.push(line);
                line = word;
            } else {
                line = test;
            }
        }
        if (line) lines.push(line);
    }
    return lines.length ? lines : [''];
}

function dateLabel(timestamp) {
    const d = new Date(timestamp);
    const date = new Intl.DateTimeFormat('fr-FR', {
        timeZone: 'Europe/Paris',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    }).format(d);
    const time = new Intl.DateTimeFormat('fr-FR', {
        timeZone: 'Europe/Paris',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).format(d);
    return `${time} · ${date}`;
}

/**
 * Renders a DM-sent log card: big guild logo at top-left, header + target +
 * moderator at top-right, message content in full width at the bottom.
 */
export async function renderDmLogImage({
    guildName,
    guildIconUrl,
    targetName,
    moderatorName,
    content,
    timestamp = new Date()
}) {
    const W = 760;
    const M = 16;
    const x0 = 28;
    const y0 = 28;
    const avatarSize = 96;
    const gap = 24;
    const rightX = x0 + avatarSize + gap;
    const bodyW = W - x0 - rightX;

    const bodySize = 16;
    const lineHeight = 24;

    const measureCanvas = createCanvas(W, 10);
    const measure = measureCanvas.getContext('2d');
    measure.font = `400 ${bodySize}px ${FONT.regular}`;
    const contentText = String(content || '').substring(0, 800);
    const lines = wrapText(measure, contentText || '*pas de contenu*', bodyW);

    const firstBodyBaseline = 194;
    const lastBaseline = firstBodyBaseline + (lines.length - 1) * lineHeight;
    const H = lastBaseline + 26 + 12;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = COLORS.page;
    ctx.fillRect(0, 0, W, H);

    roundedRect(ctx, 12, 12, W - 24, H - 24, 12);
    ctx.fillStyle = COLORS.card;
    ctx.fill();

    let avatar = null;
    if (guildIconUrl) {
        avatar = await loadImage(guildIconUrl).catch(() => null);
    }
    ctx.save();
    circle(ctx, x0 + avatarSize / 2, y0 + avatarSize / 2, avatarSize / 2);
    ctx.clip();
    if (avatar) {
        ctx.drawImage(avatar, x0, y0, avatarSize, avatarSize);
    } else {
        const grad = ctx.createLinearGradient(x0, y0, x0 + avatarSize, y0 + avatarSize);
        grad.addColorStop(0, '#5865F2');
        grad.addColorStop(1, '#2E3A85');
        ctx.fillStyle = grad;
        ctx.fillRect(x0, y0, avatarSize, avatarSize);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `700 ${Math.floor(avatarSize * 0.4)}px ${FONT.bold}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(sanitize(guildName).charAt(0).toUpperCase() || '?', x0 + avatarSize / 2, y0 + avatarSize / 2 + 2);
    }
    ctx.restore();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    ctx.font = `700 22px ${FONT.bold}`;
    ctx.fillStyle = COLORS.title;
    ctx.fillText('✉ DM Sent', rightX, y0 + 22);

    ctx.font = `500 13px ${FONT.regular}`;
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(`${sanitize(guildName)} · ${dateLabel(timestamp)}`, rightX, y0 + 44);

    ctx.font = `600 16px ${FONT.semibold}`;
    ctx.fillStyle = COLORS.label;
    ctx.fillText('🎯 Target', rightX, y0 + 78);
    ctx.fillStyle = COLORS.title;
    ctx.fillText(sanitize(targetName) || '—', rightX + 98, y0 + 78);

    ctx.fillStyle = COLORS.label;
    ctx.fillText('🛡 Moderator', rightX, y0 + 106);
    ctx.fillStyle = COLORS.title;
    ctx.fillText(sanitize(moderatorName) || '—', rightX + 98, y0 + 106);

    ctx.strokeStyle = COLORS.divider;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, 160);
    ctx.lineTo(W - x0, 160);
    ctx.stroke();

    ctx.font = `700 14px ${FONT.bold}`;
    ctx.fillStyle = COLORS.label;
    ctx.fillText('💬 MESSAGE', x0, 178);

    ctx.font = `400 ${bodySize}px ${FONT.regular}`;
    ctx.fillStyle = COLORS.body;
    for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], x0, firstBodyBaseline + i * lineHeight);
    }

    return canvas.toBuffer('image/png');
}