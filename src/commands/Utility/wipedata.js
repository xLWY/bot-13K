import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getConfirmationButtons } from '../../utils/components.js';
import { createEmbed, errorEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { brandFooter } from '../../ui/kit.js';

const NO_MENTIONS = { parse: [], repliedUser: false };

export default {
    data: new SlashCommandBuilder()
        .setName('wipedata')
        .setDescription('Supprimer toutes tes données personnelles du bot (irréversible)'),

    async execute(interaction, guildConfig, client) {
        try {
            const embed = createEmbed({
                title: 'Données concernées',
                description: 'La suppression efface définitivement les enregistrements ci-dessous, sans possibilité de récupération.',
                color: 'warning',
                fields: [
                    { name: 'Économie', value: 'Portefeuille, banque, achats et objets', inline: false },
                    { name: 'Progression', value: 'Niveaux, XP et compteurs', inline: false },
                    { name: 'Profil', value: 'Anniversaire et données enregistrées', inline: false },
                    {
                        name: 'Portée',
                        value: 'Toutes les données liées à ton identifiant sur ce serveur',
                        inline: false,
                    },
                ],
                footer: brandFooter('Confirmation sensible'),
            });

            await InteractionHelper.safeReply(interaction, {
                content: '**Action irréversible** — confirme avec les boutons ci-dessous pour supprimer tes données sur ce serveur.',
                embeds: [embed],
                components: [getConfirmationButtons('wipedata')],
                flags: MessageFlags.Ephemeral,
                allowedMentions: NO_MENTIONS,
            });

            logger.info(`Wipedata command executed - confirmation prompt shown`, {
                userId: interaction.user.id,
                guildId: interaction.guildId
            });
        } catch (error) {
            logger.error(`Wipedata command execution failed`, {
                error: error.message,
                stack: error.stack,
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: 'wipedata'
            });
            await InteractionHelper.safeReply(interaction, {
                embeds: [errorEmbed('Impossible d’ouvrir la confirmation. Réessaie dans un instant.')],
                flags: MessageFlags.Ephemeral,
                allowedMentions: NO_MENTIONS,
            });
        }
    },
};
