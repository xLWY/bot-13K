/**
 * Petite boîte à outils UI partagée par les commandes.
 *
 * Objectif : une même grammaire visuelle partout (embeds, pagination,
 * badges, formats de nombres) pour éviter que chaque commande réinvente
 * sa propre mise en page.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';

export const BRAND = Object.freeze({
    name: '13K',
    footer: '13K Bot • /help pour explorer les commandes',
});

export function brandFooter(extra = null) {
    return { text: extra ? `${extra} • ${BRAND.footer}` : BRAND.footer };
}

export function formatNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? new Intl.NumberFormat('fr-FR').format(n) : '?';
}

export function discordTimestamp(value, format = 'R') {
    if (!value) return 'inconnu';
    const time = new Date(value).getTime();
    if (!Number.isFinite(time)) return 'inconnu';
    return `<t:${Math.floor(time / 1000)}:${format}>`;
}

export function guildIconUrl(guild, size = 128) {
    try {
        return typeof guild?.iconURL === 'function'
            ? guild.iconURL({ size, extension: 'png' })
            : null;
    } catch {
        return null;
    }
}

export function progressBar(value, total, width = 12) {
    const max = Math.max(0, Number(total) || 0);
    const current = Math.min(max, Math.max(0, Number(value) || 0));
    if (max === 0) return '░'.repeat(width);
    const filled = Math.round((current / max) * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/**
 * Ligne de navigation standardisée : ◀ | page/total | ▶
 * Le bouton central est désactivé : il sert uniquement d'indicateur.
 */
export function buildNavRow({ page, pageCount, prevId, nextId, indicatorId }) {
    if (pageCount <= 1) return [];

    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(prevId)
            .setLabel('◀')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page <= 0),
        new ButtonBuilder()
            .setCustomId(indicatorId)
            .setLabel(`${page + 1} / ${pageCount}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId(nextId)
            .setLabel('▶')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= pageCount - 1),
    )];
}

/**
 * Menu de saut de page. Discord limite un select menu à 25 options :
 * au-delà, on retourne une ligne vide et les boutons ◀ ▶ suffisent.
 */
export function buildPageJumpRow({ page, pageCount, customId, placeholder = 'Aller à une page' }) {
    if (pageCount < 2 || pageCount > 25) return [];

    const options = Array.from({ length: pageCount }, (_, index) => ({
        label: `Page ${index + 1}${index === page ? ' •' : ''}`,
        value: String(index),
        default: index === page,
    }));

    return [new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(customId)
            .setPlaceholder(placeholder)
            .addOptions(options),
    )];
}
