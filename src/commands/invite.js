import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { errorEmbed } from '../utils/embeds.js';
import { buildBotInviteUrl, RECOMMENDED_INVITE_PERMISSIONS } from '../utils/inviteUrl.js';
import { brandFooter, brandedEmbed, statField } from '../ui/kit.js';
import { logger } from '../utils/logger.js';

const CONTEXT = 'Invitation';

function buildPayload(client) {
    const clientId = client?.config?.bot?.clientId || process.env.CLIENT_ID || client?.user?.id;
    const url = buildBotInviteUrl(clientId, RECOMMENDED_INVITE_PERMISSIONS);

    if (!url) {
        return {
            embeds: [errorEmbed('Identifiant du bot indisponible. Réessaie dans un instant.').setFooter(brandFooter(CONTEXT))],
            allowedMentions: { parse: [] },
        };
    }

    const embed = brandedEmbed({
        title: 'Ajouter 13K à ton serveur',
        description: 'Ouvre le lien, choisis ton serveur et valide les permissions. Les commandes slash sont ajoutées en même temps que le bot.',
        color: 'info',
        fields: [
            statField('Permissions', 'recommandées'),
            statField('Portée', 'bot + commandes'),
        ],
    }, client, CONTEXT);

    return {
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Ajouter le bot à un serveur')
                .setStyle(ButtonStyle.Link)
                .setURL(url),
        )],
        allowedMentions: { parse: [] },
    };
}

export default {
    data: new SlashCommandBuilder()
        .setName('invite')
        .setDescription('Obtenir le lien pour ajouter le bot à un serveur')
        .setDMPermission(true),

    category: 'general',
    aliases: ['botinvite'],

    async execute(interaction, config, client) {
        try {
            const payload = buildPayload(client);
            const options = interaction.inGuild()
                ? { ...payload, flags: MessageFlags.Ephemeral }
                : payload;
            await InteractionHelper.safeReply(interaction, options);
        } catch (error) {
            logger.error('Error in /invite:', error);
            await InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('Impossible de générer le lien. Réessaie dans un instant.').setFooter(brandFooter(CONTEXT))],
                flags: MessageFlags.Ephemeral,
                allowedMentions: { parse: [] },
            }).catch(() => {});
        }
    },
};
