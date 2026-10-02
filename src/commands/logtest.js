import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getColor } from '../config/bot.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { isBotOwner, getBotOwnerIds } from '../utils/ownerIds.js';
import { sendLogToOwners, ownerDmHealth } from '../utils/ownerLogRelay.js';
import { logger } from '../utils/logger.js';

export default {
    data: new SlashCommandBuilder()
        .setName('logtest')
        .setDescription('* Teste l envoi des logs en message prive (owner)')
        .setDMPermission(true),

    category: 'debug',

    async execute(interaction, config, client) {
        if (!isBotOwner(interaction.user.id)) {
            await InteractionHelper.safeReply(interaction, {
                content: '`logtest` est reserve au owner du bot.',
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
                    { name: 'Salon d origine', value: `\`${interaction.guildId ?? 'DM'}\``, inline: true },
                    { name: 'Declenche', value: `\`${interaction.user.tag}\``, inline: true },
                    { name: 'Horodatage', value: `<t:${Math.floor(Date.now() / 1000)}:f>`, inline: true },
                )
                .setTimestamp();

            const result = await sendLogToOwners(client, () => ({ embeds: [embed] }));

            const health = ownerDmHealth();
            const healthLine = health.length === 0
                ? '`aucune donnee`'
                : health.map(h => `\`${h.ownerId}\` erreurs=${h.failures}`).join(' | ');

            let verdict;
            if (ownerIds.length === 0) {
                verdict = '\u{1F534} **Aucun owner configure** - verifie `OWNER_IDS` sur Railway.';
            } else if (result.delivered > 0) {
                verdict = `\u{1F7E2} **DM livre a ${result.delivered} owner(s)** - les logs arrivent.`;
            } else {
                verdict = '\u{1F534} **Echec de l envoi en MP.**\n' +
                    'Ouvre les DM du bot et active **Partage de serveur** dans ses parametres.';
            }

            await InteractionHelper.safeReply(interaction, {
                embeds: [
                    new EmbedBuilder()
                        .setColor(result.delivered > 0 ? getColor('success') : getColor('error'))
                        .setTitle('\u{1F9EA} Resultat du test')
                        .setDescription(verdict)
                        .addFields(
                            { name: 'Owners configures', value: ownerIds.length ? ownerIds.map(id => `\`${id}\``).join('\n') : '`aucun`', inline: false },
                            { name: 'DM livres', value: `\`${result.delivered}\``, inline: true },
                            { name: 'DM echoues', value: `\`${result.failed}\``, inline: true },
                            { name: 'Etat', value: healthLine, inline: false },
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
