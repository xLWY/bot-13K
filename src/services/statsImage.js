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
    bg: '#1F2227',
    card: '#2B2D31',
    cardBorder: '#3E4149',
    row: '#34363C',
    text: '#F2F3F5',
    subtext: '#9AA0A9',
    accent: '#5865F2',
    accentSoft: '#8EA1FF',
    medalGold: '#F0B232',
    medalSilver: '#C0C4CC',
    medalBronze: '#CD7F32',
    divider: '#3A3D43',
    barBg: '#232428'
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

function roundRect(ctx, x, y, w, h, r) {
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

function drawAvatar(ctx, image, x, y, size, fallbackText, fallbackHue) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    if (image) {
        ctx.clip();
        ctx.drawImage(image, x, y, size, size);
        ctx.restore();
        return;
    }
    ctx.fillStyle = `hsl(${(fallbackHue || 0) % 360}, 45%, 38%)`;
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `600 ${Math.floor(size * 0.42)}px ${FONT.semibold}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(fallbackText, x + size / 2, y + size / 2 + 1);
    ctx.restore();
}

function drawRank(ctx, index, x, y, size) {
    const medalColors = [COLORS.medalGold, COLORS.medalSilver, COLORS.medalBronze];
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    if (index < 3) {
        ctx.fillStyle = medalColors[index];
        ctx.fill();
        ctx.fillStyle = '#1F2227';
    } else {
        ctx.fillStyle = COLORS.row;
        ctx.fill();
        ctx.strokeStyle = COLORS.cardBorder;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = COLORS.subtext;
    }
    ctx.font = `700 ${Math.floor(size * 0.52)}px ${FONT.bold}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), x + size / 2, y + size / 2 + 1);
    ctx.restore();
}

function drawBar(ctx, x, y, width, height, fraction) {
    roundRect(ctx, x, y, width, height, height / 2);
    ctx.fillStyle = COLORS.barBg;
    ctx.fill();
    const fillWidth = Math.max(0, Math.min(1, fraction)) * width;
    if (fillWidth > 0) {
        roundRect(ctx, x, y, fillWidth, height, height / 2);
        ctx.fillStyle = COLORS.accent;
        ctx.fill();
    }
}

function drawColumnHeader(ctx, x, y, label) {
    ctx.save();
    roundRect(ctx, x, y - 10, 14, 14, 4);
    ctx.fillStyle = COLORS.accent;
    ctx.fill();
    ctx.font = `700 16px ${FONT.bold}`;
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(label.toUpperCase(), x + 22, y);
    ctx.restore();
}

function computeFraction(entries) {
    const max = Math.max(0, ...entries.map((e) => e.value));
    return max > 0
        ? entries.map((e) => e.value / max)
        : entries.map(() => 0);
}

function dateLabel(timestamp) {
    return new Date(timestamp).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
}

/**
 * Renders the "Top" card (messages + voice rankings) as a PNG buffer.
 * @param {object} params
 * @param {string} params.guildName
 * @param {string|null} params.guildIconUrl
 * @param {number} params.startedAt
 * @param {number} params.memberCount
 * @param {Array<{name:string,avatarUrl:string|null,value:number}>} params.messageEntries
 * @param {Array<{name:string,avatarUrl:string|null,value:number}>} params.voiceEntries
 * @returns {Promise<Buffer>}
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
    const pad = 40;
    const columnGap = 28;
    const columnWidth = (W - pad * 2 - columnGap) / 2;
    const rowHeight = 58;
    const rowGap = 10;
    const rows = Math.max(messageEntries.length, voiceEntries.length);

    const headerHeight = 112;
    const sectionTitleHeight = 44;
    const bodyHeight = rows > 0 ? rows * rowHeight + (rows - 1) * rowGap : 0;
    const footerHeight = 40;
    const H = pad + headerHeight + sectionTitleHeight + bodyHeight + footerHeight;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);

    roundRect(ctx, 14, 14, W - 28, H - 28, 18);
    ctx.fillStyle = COLORS.card;
    ctx.fill();
    ctx.strokeStyle = COLORS.cardBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    const contentX = pad;
    const iconSize = 72;
    const iconY = pad + 16;

    let guildIcon = null;
    if (guildIconUrl) {
        const icons = await preloadAvatars([guildIconUrl]);
        guildIcon = icons.get(guildIconUrl);
    }
    drawAvatar(ctx, guildIcon, contentX, iconY, iconSize, (guildName || 'S').charAt(0).toUpperCase(), 220);

    const titleX = contentX + iconSize + 20;
    ctx.font = `700 28px ${FONT.bold}`;
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(fitText(ctx, guildName || 'Serveur', W - titleX - 20), titleX, iconY + 34);

    ctx.font = `500 14px ${FONT.medium}`;
    ctx.fillStyle = COLORS.subtext;
    ctx.fillText(
        `TOP ACTIVITÉ · ${memberCount} MEMBRES SUIVIS · DEPUIS LE ${dateLabel(startedAt).toUpperCase()}`,
        titleX,
        iconY + 62
    );

    const dividerY = iconY + iconSize + 24;
    ctx.strokeStyle = COLORS.divider;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(contentX, dividerY);
    ctx.lineTo(W - contentX, dividerY);
    ctx.stroke();

    const sectionTop = dividerY + 26;
    drawColumnHeader(ctx, columnX(contentX, 0, columnWidth, columnGap), sectionTop + 10, 'Messages');
    drawColumnHeader(ctx, columnX(contentX, 1, columnWidth, columnGap), sectionTop + 10, 'Vocal');

    const bodyTop = sectionTop + sectionTitleHeight;
    const messageFractions = computeFraction(messageEntries);
    const voiceFractions = computeFraction(voiceEntries);

    const allAvatars = [...messageEntries, ...voiceEntries]
        .map((e) => e.avatarUrl)
        .filter(Boolean);
    const avatarImages = await preloadAvatars(allAvatars);

    const rankSize = 26;
    const avatarSize = 44;
    const avatarGap = 14;

    const drawColumnRows = (entries, fractions, col) => {
        const colX = columnX(contentX, col, columnWidth, columnGap);
        entries.forEach((entry, index) => {
            const rowTop = bodyTop + index * (rowHeight + rowGap);

            drawRank(ctx, index, colX, rowTop + (rowHeight - rankSize) / 2, rankSize);

            const avatarX = colX + rankSize + avatarGap;
            const avatarY = rowTop + (rowHeight - avatarSize) / 2;
            drawAvatar(
                ctx,
                avatarImages.get(entry.avatarUrl) || null,
                avatarX,
                avatarY,
                avatarSize,
                (entry.name || '?').charAt(0).toUpperCase(),
                index * 47 + 190
            );

            const nameX = avatarX + avatarSize + 12;

            ctx.font = `600 15px ${FONT.semibold}`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = COLORS.text;

            const valueText = formatValue(entry.value, col);
            ctx.font = `700 16px ${FONT.bold}`;
            const valueX = colX + columnWidth - ctx.measureText(valueText).width;
            ctx.fillStyle = COLORS.accentSoft;
            ctx.fillText(valueText, valueX, rowTop + 25);

            ctx.font = `600 15px ${FONT.semibold}`;
            ctx.fillStyle = COLORS.text;
            ctx.fillText(fitText(ctx, entry.name || 'Membre', valueX - nameX - 8), nameX, rowTop + 25);

            drawBar(ctx, nameX, rowTop + rowHeight - 9, colX + columnWidth - nameX, 4, fractions[index]);
        });
    };

    drawColumnRows(messageEntries, messageFractions, 0);
    drawColumnRows(voiceEntries, voiceFractions, 1);

    const footerY = H - pad;
    ctx.font = `500 13px ${FONT.regular}`;
    ctx.fillStyle = COLORS.subtext;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Top ${Math.max(messageEntries.length, voiceEntries.length)} · titan-bot · Données cumulées depuis le ${dateLabel(startedAt)}`, W / 2, footerY);

    return canvas.toBuffer('image/png');
}

/**
 * Renders the "User" card (messages + voice + top channels) as a PNG buffer.
 * @param {object} params
 * @param {string} params.displayName
 * @param {string|null} params.avatarUrl
 * @param {number} params.startedAt
 * @param {number} params.messages
 * @param {number} params.messageRank
 * @param {number} params.voiceSeconds
 * @param {number} params.voiceRank
 * @param {Array<{name:string,count:number}>} params.channels
 * @returns {Promise<Buffer>}
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
    const pad = 40;
    const headerHeight = 128;
    const tilesHeight = 120;
    const sectionTitleHeight = 44;
    const channelRowHeight = 44;
    const channelRowGap = 8;
    const channelRows = Math.min(5, channels.length);
    const channelsHeight = channelRows > 0 ? channelRows * channelRowHeight + (channelRows - 1) * channelRowGap : 0;
    const footerHeight = 40;
    const H = pad + headerHeight + tilesHeight + sectionTitleHeight + channelsHeight + footerHeight + (channelRows > 0 ? 0 : 28);

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);

    roundRect(ctx, 14, 14, W - 28, H - 28, 18);
    ctx.fillStyle = COLORS.card;
    ctx.fill();
    ctx.strokeStyle = COLORS.cardBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    const iconSize = 84;
    const iconY = pad + 16;

    let avatar = null;
    if (avatarUrl) {
        const avatars = await preloadAvatars([avatarUrl]);
        avatar = avatars.get(avatarUrl);
    }
    drawAvatar(ctx, avatar, pad, iconY, iconSize, (displayName || '?').charAt(0).toUpperCase(), 258);

    const titleX = pad + iconSize + 20;
    ctx.font = `700 30px ${FONT.bold}`;
    ctx.fillStyle = COLORS.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(fitText(ctx, displayName || 'Membre', W - titleX - 20), titleX, iconY + 38);

    ctx.font = `500 14px ${FONT.medium}`;
    ctx.fillStyle = COLORS.subtext;
    ctx.fillText(`STATISTIQUES · DEPUIS LE ${dateLabel(startedAt).toUpperCase()}`, titleX, iconY + 68);

    const dividerY = iconY + iconSize + 20;
    ctx.strokeStyle = COLORS.divider;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, dividerY);
    ctx.lineTo(W - pad, dividerY);
    ctx.stroke();

    const tilesTop = dividerY + 24;
    const tilesWidth = (W - pad * 2 - 20) / 2;

    const drawTile = (tileX, label, valueText, rankText) => {
        roundRect(ctx, tileX, tilesTop, tilesWidth, tilesHeight, 14);
        ctx.fillStyle = COLORS.row;
        ctx.fill();

        ctx.font = `700 13px ${FONT.semibold}`;
        ctx.fillStyle = COLORS.subtext;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(label.toUpperCase(), tileX + 22, tilesTop + 28);

        ctx.font = `700 40px ${FONT.bold}`;
        ctx.fillStyle = COLORS.accentSoft;
        ctx.fillText(valueText, tileX + 22, tilesTop + 76);

        ctx.font = `500 15px ${FONT.medium}`;
        ctx.fillStyle = COLORS.subtext;
        ctx.textAlign = 'right';
        ctx.fillText(rankText, tileX + tilesWidth - 22, tilesTop + 76);
        ctx.textAlign = 'left';
    };

    drawTile(pad, 'Messages', messages.toLocaleString('fr-FR'), `#${messageRank} au classement`);
    drawTile(pad + tilesWidth + 20, 'Temps vocal', formatVoiceDuration(voiceSeconds), `#${voiceRank} au classement`);

    const sectionTop = tilesTop + tilesHeight + 18;
    const channelsTop = sectionTop + sectionTitleHeight;

    if (channels.length > 0) {
        drawColumnHeader(ctx, pad, sectionTop + 10, 'Top salons');

        const maxCount = Math.max(1, ...channels.map((c) => c.count));
        channels.slice(0, 5).forEach((channel, index) => {
            const rowTop = channelsTop + index * (channelRowHeight + channelRowGap);

            roundRect(ctx, pad, rowTop, W - pad * 2, channelRowHeight, 10);
            ctx.fillStyle = COLORS.row;
            ctx.fill();

            ctx.font = `600 15px ${FONT.semibold}`;
            ctx.fillStyle = COLORS.text;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(fitText(ctx, channel.name || 'Salon inconnu', W - pad * 2 - 180), pad + 18, rowTop + 26);

            const countText = channel.count.toLocaleString('fr-FR');
            ctx.font = `600 15px ${FONT.semibold}`;
            ctx.fillStyle = COLORS.accentSoft;
            ctx.textAlign = 'right';
            ctx.fillText(countText, W - pad - 18, rowTop + 26);

            drawBar(ctx, pad + 18, rowTop + channelRowHeight - 8, W - pad * 2 - 36, 4, channel.count / maxCount);
        });
    } else {
        drawColumnHeader(ctx, pad, sectionTop + 10, 'Top salons');
        ctx.font = `500 14px ${FONT.regular}`;
        ctx.fillStyle = COLORS.subtext;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText('Aucun message enregistré.', pad, channelsTop + 2);
    }

    const footerY = H - pad;
    ctx.font = `500 13px ${FONT.regular}`;
    ctx.fillStyle = COLORS.subtext;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Données cumulées depuis le ${dateLabel(startedAt)} · titan-bot`, W / 2, footerY);

    return canvas.toBuffer('image/png');
}

function columnX(contentX, columnIndex, columnWidth, columnGap) {
    return contentX + columnIndex * (columnWidth + columnGap);
}

function formatValue(value, columnIndex) {
    return columnIndex === 1 ? formatVoiceDuration(value) : value.toLocaleString('fr-FR');
}