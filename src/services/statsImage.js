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

const COLORS = {
    pageA: '#101216',
    pageB: '#181B20',
    card: '#1E2126',
    cardBorder: '#2D3138',
    row: '#23262C',
    divider: '#2A2E35',
    text: '#F4F6FA',
    muted: '#9AA1AC',
    accent: '#7489FF',
    accentSoft: '#A6B4FF',
    accentBg: 'rgba(129, 144, 255, 0.16)',
    accentGradA: '#5C6CFF',
    accentGradB: '#9A6BFF',
    gold: '#FFC857',
    silver: '#C7CDD8',
    bronze: '#E08B57',
    onMedal: '#14161A',
    track: '#2B2F37'
};

const MEDALS = [COLORS.gold, COLORS.silver, COLORS.bronze];

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
        map.set(url, await loadImage(url).catch(() => null));
    }));
    return map;
}

/**
 * Renders an avatar (circle or rounded square) with optional colored ring
 * and a letter fallback when the image is missing.
 */
function drawAvatar(ctx, image, x, y, size, { radius = size / 2, ring = null, fallbackText = '?', hue = 0 } = {}) {
    const c = radius === size / 2
        ? { cx: x + size / 2, cy: y + size / 2, r: radius }
        : null;

    ctx.save();
    if (c) {
        circle(ctx, c.cx, c.cy, c.r);
    } else {
        rounded(ctx, x, y, size, size, radius);
    }
    ctx.clip();

    if (image) {
        ctx.drawImage(image, x, y, size, size);
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
        ctx.fillText(fallbackText, x + size / 2, y + size / 2 + 1);
    }
    ctx.restore();

    if (ring) {
        ctx.save();
        ctx.strokeStyle = ring;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.9;
        if (c) {
            ctx.beginPath();
            ctx.arc(c.cx, c.cy, c.r + 1.5, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            rounded(ctx, x - 1.5, y - 1.5, size + 3, size + 3, radius + 1.5);
            ctx.stroke();
        }
        ctx.restore();
    }
}

function drawRankBadge(ctx, index, x, y, size) {
    ctx.save();
    if (index < 3) {
        const color = MEDALS[index];
        const grad = ctx.createLinearGradient(x, y, x + size, y + size);
        grad.addColorStop(0, '#FFFFFF');
        grad.addColorStop(0.25, color);
        grad.addColorStop(1, shade(color, -30));
        circle(ctx, x + size / 2, y + size / 2, size / 2);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = COLORS.onMedal;
        ctx.font = `700 ${Math.floor(size * 0.5)}px ${FONT.bold}`;
    } else {
        rounded(ctx, x, y, size, size, size / 2);
        ctx.fillStyle = '#262A32';
        ctx.fill();
        ctx.strokeStyle = COLORS.cardBorder;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = COLORS.muted;
        ctx.font = `700 ${Math.floor(size * 0.5)}px ${FONT.bold}`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), x + size / 2, y + size / 2 + 1);
    ctx.restore();
}

function drawValuePill(ctx, text, x, y, height) {
    ctx.font = `700 ${Math.floor(height * 0.52)}px ${FONT.bold}`;
    const textWidth = ctx.measureText(text).width;
    const pillWidth = textWidth + 28;
    const pillX = x - pillWidth;
    const pillY = y - height / 2;
    rounded(ctx, pillX, pillY, pillWidth, height, height / 2);
    ctx.fillStyle = COLORS.accentBg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(129,144,255,0.28)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = COLORS.accentSoft;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, pillX + pillWidth / 2, pillY + height / 2 + 1);
    return pillWidth;
}

function drawGradientBar(ctx, x, y, width, height, fraction) {
    rounded(ctx, x, y, width, height, height / 2);
    ctx.fillStyle = COLORS.track;
    ctx.fill();
    const fillWidth = Math.max(0, Math.min(1, fraction)) * width;
    if (fillWidth >= 2) {
        const grad = ctx.createLinearGradient(x, 0, x + fillWidth, 0);
        grad.addColorStop(0, COLORS.accentGradA);
        grad.addColorStop(1, COLORS.accentGradB);
        rounded(ctx, x, y, fillWidth, height, height / 2);
        ctx.fillStyle = grad;
        ctx.fill();
    }
}

function drawSectionHeader(ctx, x, yTop, label) {
    const dotSize = 16;
    const grad = ctx.createLinearGradient(x, yTop, x + dotSize, yTop + dotSize);
    grad.addColorStop(0, COLORS.accentGradA);
    grad.addColorStop(1, COLORS.accentGradB);
    rounded(ctx, x, yTop, dotSize, dotSize, 5);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.font = `700 15px ${FONT.bold}`;
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(label.toUpperCase(), x + dotSize + 12, yTop + dotSize - 1);
}

function shade(hex, percent) {
    const num = parseInt(hex.slice(1), 16);
    const amt = Math.round(255 * (Math.abs(percent) / 100));
    const r = percent < 0 ? Math.max(0, (num >> 16) - amt) : Math.min(255, (num >> 16) + amt);
    const g = percent < 0 ? Math.max(0, ((num >> 8) & 0xff) - amt) : Math.min(255, ((num >> 8) & 0xff) + amt);
    const b = percent < 0 ? Math.max(0, (num & 0xff) - amt) : Math.min(255, (num & 0xff) + amt);
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function dateLabel(timestamp) {
    return new Date(timestamp).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
}

function beginCard(ctx, W, H) {
    const pageGrad = ctx.createLinearGradient(0, 0, 0, H);
    pageGrad.addColorStop(0, COLORS.pageA);
    pageGrad.addColorStop(1, COLORS.pageB);
    ctx.fillStyle = pageGrad;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(W / 2, -140, 10, W / 2, -140, 720);
    glow.addColorStop(0, 'rgba(92, 108, 255, 0.28)');
    glow.addColorStop(0.6, 'rgba(92, 108, 255, 0.08)');
    glow.addColorStop(1, 'rgba(92, 108, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    const cardX = 20;
    const cardY = 20;
    const cardW = W - 40;
    const cardH = H - 40;

    rounded(ctx, cardX, cardY + 6, cardW, cardH, 22);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();

    rounded(ctx, cardX, cardY, cardW, cardH, 22);
    ctx.fillStyle = COLORS.card;
    ctx.fill();
    ctx.strokeStyle = COLORS.cardBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    return { cardX, cardY, cardW, cardH };
}

function drawHeader(ctx, W, cardRect, { avatarImage, title, subtitle, avatarHue }) {
    const { cardX, cardY, cardW } = cardRect;
    const headerH = 148;

    ctx.save();
    rounded(ctx, cardX, cardY, cardW, cardRect.cardH, 22);
    ctx.clip();

    const band = ctx.createLinearGradient(0, cardY, 0, cardY + headerH + 60);
    band.addColorStop(0, 'rgba(92, 108, 255, 0.9)');
    band.addColorStop(0.55, 'rgba(154, 107, 255, 0.55)');
    band.addColorStop(1, 'rgba(154, 107, 255, 0)');
    ctx.fillStyle = band;
    ctx.fillRect(cardX, cardY, cardW, headerH + 80);

    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#FFFFFF';
    circle(ctx, cardX + cardW - 90, cardY + 40, 90);
    ctx.fill();
    circle(ctx, cardX + cardW - 190, cardY + 90, 55);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();

    const avatarSize = 92;
    const avatarX = cardX + 44;
    const avatarY = cardY + 26;
    drawAvatar(ctx, avatarImage, avatarX, avatarY, avatarSize, {
        radius: 20,
        ring: 'rgba(255,255,255,0.25)',
        fallbackText: (title || '?').charAt(0).toUpperCase(),
        hue: avatarHue || 0
    });

    const titleX = avatarX + avatarSize + 26;
    ctx.font = `700 30px ${FONT.bold}`;
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(fitText(ctx, title || 'Serveur', W - titleX - 80), titleX, avatarY + 38);

    ctx.font = `700 13px ${FONT.medium}`;
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.textAlign = 'left';
    ctx.fillText(subtitle.toUpperCase(), titleX, avatarY + 66);
}

function drawFooter(ctx, W, H, text) {
    const y = H - 30;
    ctx.font = `500 13px ${FONT.regular}`;
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const labelHalf = ctx.measureText(text).width / 2;
    ctx.fillText(text, W / 2, y);

    ctx.fillStyle = COLORS.accent;
    circle(ctx, W / 2 - labelHalf - 16, y, 3);
    ctx.fill();
    circle(ctx, W / 2 + labelHalf + 16, y, 3);
    ctx.fill();
}

function computeFraction(values) {
    const max = Math.max(0, ...values);
    return max > 0 ? values.map((v) => v / max) : values.map(() => 0);
}

/**
 * Renders the "Top" card (messages + voice rankings) as a PNG buffer.
 */
export async function renderTopImage({
    guildName,
    guildIconUrl,
    startedAt,
    memberCount,
    messageEntries,
    voiceEntries
}) {
    const W = 900;
    const contentX = 60;
    const columnGap = 28;
    const columnWidth = (W - contentX * 2 - columnGap) / 2;
    const rowHeight = 64;
    const rowGap = 6;
    const rows = Math.max(messageEntries.length, voiceEntries.length);

    const headerH = 148;
    const sectionH = 48;
    const bodyH = rows > 0 ? rows * rowHeight + (rows - 1) * rowGap : 0;
    const footerH = 58;
    const H = 40 + headerH + sectionH + bodyH + footerH;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    const cardRect = beginCard(ctx, W, H);

    let guildIcon = null;
    if (guildIconUrl) {
        const icons = await preloadAvatars([guildIconUrl]);
        guildIcon = icons.get(guildIconUrl);
    }
    drawHeader(ctx, W, cardRect, {
        avatarImage: guildIcon,
        title: guildName || 'Serveur',
        subtitle: `Top ${Math.max(messageEntries.length, voiceEntries.length)} membres · ${memberCount} suivis · Dès le ${dateLabel(startedAt)}`,
        avatarHue: 220
    });

    const bodyX = contentX;
    drawSectionHeader(ctx, bodyX, cardRect.cardY + headerH + 4, 'Messages');
    drawSectionHeader(ctx, bodyX + columnWidth + columnGap, cardRect.cardY + headerH + 4, 'Vocal');

    const rowsTop = cardRect.cardY + headerH + sectionH;
    const messageFractions = computeFraction(messageEntries.map((e) => e.value));
    const voiceFractions = computeFraction(voiceEntries.map((e) => e.value));

    const allAvatars = [...messageEntries, ...voiceEntries]
        .map((e) => e.avatarUrl)
        .filter(Boolean);
    const avatarImages = await preloadAvatars(allAvatars);

    const rankSize = 34;
    const avatarSize = 44;
    const nameGap = 12;

    const drawColumnRows = (entries, fractions, colIndex) => {
        const colX = bodyX + colIndex * (columnWidth + columnGap);
        entries.forEach((entry, index) => {
            const rowTop = rowsTop + index * (rowHeight + rowGap);
            const rowBottom = rowTop + rowHeight;

            const avatarX = colX + rankSize + 14;

            if (index > 0) {
                ctx.strokeStyle = COLORS.divider;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(avatarX, rowTop);
                ctx.lineTo(colX + columnWidth, rowTop);
                ctx.stroke();
            }

            drawRankBadge(ctx, index, colX, rowTop + (rowHeight - rankSize) / 2, rankSize);

            const avatarY = rowTop + (rowHeight - avatarSize) / 2;
            drawAvatar(ctx, avatarImages.get(entry.avatarUrl) || null, avatarX, avatarY, avatarSize, {
                ring: index < 3 ? MEDALS[index] : null,
                fallbackText: (entry.name || '?').charAt(0).toUpperCase(),
                hue: index * 47 + 190
            });

            const nameX = avatarX + avatarSize + nameGap;
            ctx.font = `600 16px ${FONT.semibold}`;
            ctx.fillStyle = COLORS.text;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(fitText(ctx, entry.name || 'Membre', colX + columnWidth - nameX - 140), nameX, rowTop + rowHeight / 2 - 3);

            const valueText = formatValue(entry.value, colIndex);
            const pillH = 30;
            drawValuePill(ctx, valueText, colX + columnWidth, rowTop + rowHeight / 2, pillH);

            drawGradientBar(ctx, nameX, rowBottom - 10, colX + columnWidth - nameX, 5, fractions[index]);
        });
    };

    drawColumnRows(messageEntries, messageFractions, 0);
    drawColumnRows(voiceEntries, voiceFractions, 1);

    drawFooter(ctx, W, H, `Données cumulées depuis le ${dateLabel(startedAt)} · xlwy bot`);

    return canvas.toBuffer('image/png');
}

function formatValue(value, columnIndex) {
    return columnIndex === 1 ? formatVoiceDuration(value) : value.toLocaleString('fr-FR');
}

/**
 * Renders the "User" card (messages + voice + top channels) as a PNG buffer.
 */
export async function renderUserImage({
    displayName,
    avatarUrl,
    startedAt,
    messages,
    messageRank,
    voiceSeconds,
    voiceRank,
    channels
}) {
    const W = 900;
    const contentX = 64;
    const headerH = 148;
    const tilesGap = 20;
    const tilesH = 132;
    const tilesWidth = (W - contentX * 2 - tilesGap) / 2;

    const channelRows = channels.slice(0, 5);
    const channelRowH = 56;
    const channelRowGap = 10;
    const channelsH = channelRows.length > 0
        ? channelRows.length * channelRowH + (channelRows.length - 1) * channelRowGap
        : 0;
    const sectionTitleH = 44;
    const footerH = 58;

    const H = 40
        + headerH
        + 20
        + tilesH
        + 18
        + sectionTitleH
        + channelsH
        + footerH;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    const cardRect = beginCard(ctx, W, H);

    let avatar = null;
    if (avatarUrl) {
        const avatars = await preloadAvatars([avatarUrl]);
        avatar = avatars.get(avatarUrl);
    }
    drawHeader(ctx, W, cardRect, {
        avatarImage: avatar,
        title: displayName || 'Membre',
        subtitle: `Statistiques · Dès le ${dateLabel(startedAt)}`,
        avatarHue: 258
    });

    const tilesTop = cardRect.cardY + headerH + 20;

    const drawTile = (tileX, label, valueText, rankText) => {
        rounded(ctx, tileX, tilesTop, tilesWidth, tilesH, 16);
        ctx.fillStyle = COLORS.row;
        ctx.fill();
        ctx.strokeStyle = COLORS.cardBorder;
        ctx.lineWidth = 1;
        ctx.stroke();

        const topLine = ctx.createLinearGradient(tileX, 0, tileX + tilesWidth, 0);
        topLine.addColorStop(0, COLORS.accentGradA);
        topLine.addColorStop(1, COLORS.accentGradB);
        rounded(ctx, tileX, tilesTop, tilesWidth, 6, 3);
        ctx.fillStyle = topLine;
        ctx.fill();

        ctx.font = `700 13px ${FONT.semibold}`;
        ctx.fillStyle = COLORS.muted;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(label.toUpperCase(), tileX + 24, tilesTop + 32);

        ctx.font = `700 38px ${FONT.bold}`;
        ctx.fillStyle = COLORS.accentSoft;
        ctx.fillText(valueText, tileX + 24, tilesTop + 92);

        ctx.font = `700 13px ${FONT.medium}`;
        ctx.fillStyle = COLORS.muted;
        ctx.textAlign = 'right';
        ctx.fillText(rankText, tileX + tilesWidth - 24, tilesTop + 92);
        ctx.textAlign = 'left';
    };

    drawTile(contentX, 'Messages', messages.toLocaleString('fr-FR'), `#${messageRank} au classement`);
    drawTile(contentX + tilesWidth + tilesGap, 'Temps vocal', formatVoiceDuration(voiceSeconds), `#${voiceRank} au classement`);

    const sectionTop = tilesTop + tilesH + 18;
    drawSectionHeader(ctx, contentX, sectionTop, 'Top salons');

    const channelsTop = sectionTop + sectionTitleH;

    if (channelRows.length > 0) {
        const maxCount = Math.max(1, ...channelRows.map((c) => c.count));
        channelRows.forEach((channel, index) => {
            const rowTop = channelsTop + index * (channelRowH + channelRowGap);

            rounded(ctx, contentX, rowTop, W - contentX * 2, channelRowH, 14);
            ctx.fillStyle = COLORS.row;
            ctx.fill();
            ctx.strokeStyle = COLORS.cardBorder;
            ctx.lineWidth = 1;
            ctx.stroke();

            const hashSize = 34;
            const hashX = contentX + 20;
            const hashY = rowTop + (channelRowH - hashSize) / 2;
            const hashGrad = ctx.createLinearGradient(hashX, hashY, hashX + hashSize, hashY + hashSize);
            hashGrad.addColorStop(0, COLORS.accentGradA);
            hashGrad.addColorStop(1, COLORS.accentGradB);
            rounded(ctx, hashX, hashY, hashSize, hashSize, 9);
            ctx.fillStyle = hashGrad;
            ctx.fill();
            ctx.fillStyle = '#FFFFFF';
            ctx.font = `700 18px ${FONT.bold}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('#', hashX + hashSize / 2, hashY + hashSize / 2 + 1);

            const nameX = hashX + hashSize + 14;
            ctx.font = `600 16px ${FONT.semibold}`;
            ctx.fillStyle = COLORS.text;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(fitText(ctx, channel.name || 'Salon inconnu', W - contentX * 2 - 220), nameX, rowTop + channelRowH / 2 - 3);

            const countText = channel.count.toLocaleString('fr-FR');
            const pillH = 28;
            ctx.font = `700 ${Math.floor(pillH * 0.52)}px ${FONT.bold}`;
            const pillWidth = ctx.measureText(countText).width + 24;
            const pillX = W - contentX - pillWidth;
            const pillY = rowTop + (channelRowH - pillH) / 2;
            rounded(ctx, pillX, pillY, pillWidth, pillH, pillH / 2);
            ctx.fillStyle = COLORS.accentBg;
            ctx.fill();
            ctx.fillStyle = COLORS.accentSoft;
            ctx.textAlign = 'center';
            ctx.fillText(countText, pillX + pillWidth / 2, pillY + pillH / 2 + 1);
            ctx.textAlign = 'left';

            drawGradientBar(ctx, nameX, rowTop + channelRowH - 9, W - contentX * 2 - 44, 5, channel.count / maxCount);
        });
    } else {
        ctx.font = `500 15px ${FONT.regular}`;
        ctx.fillStyle = COLORS.muted;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText('Aucun message enregistré.', contentX, channelsTop + 4);
    }

    drawFooter(ctx, W, H, `Données cumulées depuis le ${dateLabel(startedAt)} · xlwy bot`);

    return canvas.toBuffer('image/png');
}