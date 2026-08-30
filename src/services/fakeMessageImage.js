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
    page: '#313338',
    name: '#F2F3F5',
    body: '#DBDEE3',
    muted: '#949BA4',
    time: '#80848E'
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

/**
 * Paranoid cleaning of arbitrary user input so only glyphs the Inter font can
 * actually draw survive (same allowlist as statsImage).
 */
function sanitizeName(name) {
    let s = String(name || '')
        .normalize('NFKC')
        .replace(/[^\u0020-\u007E\u00A0-\u024F\u0300-\u036F\u0370-\u03FF\u0400-\u04FF\u1E00-\u1EFF\u2000-\u206F\u20AC\u2018-\u201F]/g, '')
        .replace(/([\u0300-\u036F\u1AB0-\u1AFF\u1DC0-\u1DFF])\1{2,}/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
    return s || 'Membre';
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

function timeLabel(timestamp) {
    const d = new Date(timestamp);
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    return `Aujourd'hui à ${hm}`;
}

/**
 * Renders a Discord-chat style mockup: dark channel background, rounded
 * avatar, bold username + timestamp row, message text wrapped below.
 */
export async function renderFakeMessageImage({ name, avatarUrl, message, timestamp = new Date() }) {
    const W = 720;
    const pad = 16;
    const avatarSize = 40;
    const gap = 12;
    const nameSize = 16;
    const bodySize = 16;
    const lineHeight = 24;
    const timeSize = 12;

    const bodyX = pad + avatarSize + gap;
    const bodyW = W - pad - bodyX;

    const measureCanvas = createCanvas(W, 10);
    const measure = measureCanvas.getContext('2d');
    measure.font = `400 ${bodySize}px ${FONT.regular}`;
    const lines = wrapText(measure, message, bodyW);

    const bodyStart = pad + 34;
    const H = pad + bodyStart + Math.max(1, lines.length) * lineHeight + pad;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = COLORS.page;
    ctx.fillRect(0, 0, W, H);

    const avatar = await loadImage(avatarUrl).catch(() => null);
    ctx.save();
    circle(ctx, pad + avatarSize / 2, pad + avatarSize / 2, avatarSize / 2);
    ctx.clip();
    if (avatar) {
        ctx.drawImage(avatar, pad, pad, avatarSize, avatarSize);
    } else {
        const grad = ctx.createLinearGradient(pad, pad, pad + avatarSize, pad + avatarSize);
        grad.addColorStop(0, '#39413F');
        grad.addColorStop(1, '#2B4546');
        ctx.fillStyle = grad;
        ctx.fillRect(pad, pad, avatarSize, avatarSize);
        ctx.fillStyle = '#FFFFFF';
        ctx.font = `700 ${Math.floor(avatarSize * 0.42)}px ${FONT.bold}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(sanitizeName(name).charAt(0).toUpperCase(), pad + avatarSize / 2, pad + avatarSize / 2 + 1);
    }
    ctx.restore();

    const cleanName = sanitizeName(name);
    ctx.font = `600 ${nameSize}px ${FONT.semibold}`;
    ctx.fillStyle = COLORS.name;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    const timeText = timeLabel(timestamp);
    const nameMax = bodyW - measure.measureText(timeText).width - 14;
    let nameText = cleanName;
    while (nameText.length > 1 && ctx.measureText(`${nameText}…`).width > nameMax) {
        nameText = nameText.slice(0, -1);
    }
    if (nameText !== cleanName) nameText = `${nameText}…`;

    ctx.fillText(nameText, bodyX, pad + 18);
    const nameEnd = bodyX + ctx.measureText(nameText).width;

    ctx.font = `400 ${timeSize}px ${FONT.regular}`;
    ctx.fillStyle = COLORS.time;
    ctx.fillText(timeText, nameEnd + 12, pad + 18);

    ctx.font = `400 ${bodySize}px ${FONT.regular}`;
    ctx.fillStyle = COLORS.body;
    for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], bodyX, bodyStart + i * lineHeight);
    }

    return canvas.toBuffer('image/png');
}