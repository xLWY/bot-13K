import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getColor } from '../config/bot.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { isBotOwner, getBotOwnerIds } from '../utils/ownerIds.js';
import { sendLogToOwners, ownerDmHealth } from '../utils/ownerLogRelay.js';
import { logger } from '../utils/logger.js';

export default {
    data: new SlashCommandBuilder()
        .setName('logtest')
        .setDescription("* Teste l'envoi des logs en message privé (propriétaire)")
        .setDMPermission(true),

    category: 'debug',

    async execute(interaction, config, client) {
        if (!isBotOwner(interaction.user.id)) {
            await InteractionHelper.safeReply(interaction, {
                content: '`logtest` est réservé au propriétaire du bot.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        try {
            const ownerIds = getBotOwnerIds();

            const embed = new EmbedBuilder()
                .setColor(getColor('info'))
                .setTitle('\u{1F4E4} Test de log')
                .setDescription('Si tu lis ceci, les logs en message prive fonctionnent.')
                .addFields(
                    { name: 'Salon d\'origine', value: `\`${interaction.guild?.name ?? 'MP'}\``, inline: true },
                    { name: 'Déclenché par', value: `\`${interaction.user.tag}\``, inline: true },
                    { name: 'Horodatage', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true },
                )
                .setTimestamp();

            const result = await sendLogToOwners(client, () => ({ embeds: [embed] }));

            const health = ownerDmHealth();
            const healthLine = health.length === 0
                ? '`aucune donnée`'
                : health.map(h => `erreurs=${h.failures}`).join(' | ');

            let verdict;
            if (ownerIds.length === 0) {
                verdict = '\u{1F534} **Aucun propriétaire configuré** — vérifie `OWNER_IDS` sur Render.';
            } else if (result.delivered > 0) {
                verdict = `\u{1F7E2} **DM livré à ${result.delivered} propriétaire(s)** — les logs arrivent.`;
            } else {
                verdict = '\u{1F534} **Échec de l\'envoi en MP.**\n' +
                    'Ouvre les DM du bot et active **Partage de serveur** dans ses paramètres.';
            }

            await InteractionHelper.safeReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setColor(result.delivered > 0 ? getColor('success') : getColor('error'))
                        .setTitle('\u{1F9EA} Résultat du test')
                        .setDescription(verdict)
                        .addFields(
                            { name: 'Propriétaires configurés', value: ownerIds.length ? `\`${ownerIds.length}\`` : '`aucun`', inline: false },
                            { name: 'DM livrés', value: `\`${result.delivered}\``, inline: true },
                            { name: 'DM échoués', value: `\`${result.failed}\``, inline: true },
                            { name: 'État', value: healthLine, inline: false },
                        )
                        .setTimestamp(),
                ],
                flags: MessageFlags.Ephemeral,
            });
        } catch (error) {
            logger.error('Error in /logtest:', error);
            await InteractionHelper.sendErrorNotice(interaction, 'Erreur pendant le test.').catch(() => {});
        }
    },
};
