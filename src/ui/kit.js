/**
 * Design system 13K v2.
 *
 * - `src/ui/format.js` contient le formatage pur (testable sans discord.js).
 * - Ce module ajoute les composants Discord et les primitives de mise en page
 *   utilisées par toutes les commandes : en-tête de marque, cartes, KPI,
 *   états vides/erreur et pagination standardisée.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { createEmbed } from '../utils/embeds.js';
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
} from './format.js';

export {
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
};

export const BRAND = Object.freeze({
    name: '13K',
    footer: '13K Bot • /help pour explorer les commandes',
});

export function brandFooter(extra = null) {
    return { text: extra ? `${extra} • ${BRAND.footer}` : BRAND.footer };
}

export function brandAuthor(client, label = BRAND.name) {
    const iconURL = typeof client?.user?.displayAvatarURL === 'function'
        ? client.user.displayAvatarURL({ size: 64 })
        : null;
    return iconURL ? { name: label, iconURL } : { name: label };
}

/** Embed avec en-tête et pied de page 13K appliqués par défaut. */
export function brandedEmbed(options = {}, client = null, context = null) {
    return createEmbed({
        ...options,
        author: options.author ?? (client ? brandAuthor(client) : null),
        footer: options.footer ?? brandFooter(context),
    });
}

/** Champ KPI compact, aligné avec ses voisins grâce à `inline: true`. */
export function statField(name, value) {
    return { name, value: `\`${value}\``, inline: true };
}

/** Champ « carte » : index sur deux chiffres, titre court, lignes courtes. */
export function cardField(index, title, lines, max = 1024) {
    const position = String(index).padStart(2, '0');
    return {
        name: truncate(`${position} · ${title}`, 256),
        value: truncate((Array.isArray(lines) ? lines : [lines]).join('\n'), max),
        inline: false,
    };
}

/** Champ de statut avec pastille sémantique unique. */
export function statusField(enabled, label, enabledText = 'Activé', disabledText = 'Désactivé') {
    return { name: label, value: statusLabel(enabled, enabledText, disabledText), inline: true };
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
