import { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { createEmbed, errorEmbed, successEmbed, warningEmbed } from '../utils/embeds.js';
import { isBotOwner, getBotOwnerIds } from '../utils/ownerIds.js';
import { sendLogToOwners, ownerDmHealth } from '../utils/ownerLogRelay.js';
import { logger } from '../utils/logger.js';
import { brandFooter, discordTimestamp, formatNumber } from '../ui/kit.js';

const CONTEXT = 'Test de log';

function errorPage(message) {
    return errorEmbed(message).setFooter(brandFooter(CONTEXT));
}

async function sendError(interaction, message) {
    await InteractionHelper.safeReply(interaction, {
        embeds: [errorPage(message)],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [], repliedUser: false },
    });
}

function buildLogEmbed(interaction) {
    return createEmbed({
        title: 'Test de log',
        description: 'Si tu lis ceci, les logs en message privé fonctionnent.',
        color: 'info',
        fields: [
            { name: 'Salon d’origine', value: `\`${interaction.guild?.name ?? 'MP'}\``, inline: true },
            { name: 'Déclenché par', value: `\`${interaction.user.tag}\``, inline: true },
            { name: 'Horodatage', value: discordTimestamp(Date.now(), 'f'), inline: true },
        ],
        footer: brandFooter(CONTEXT),
    });
}

function buildHealthField() {
    const health = ownerDmHealth();
    if (health.length === 0) return 'Aucune donnée pour l’instant.';

    const visible = health.slice(0, 8);
    const lines = visible.map((entry) => {
        const status = entry.failures > 0 ? '🔴' : '🟢';
        return [
            `${status} \`${entry.ownerId}\``,
            `erreurs : \`${formatNumber(entry.failures)}\``,
            `dernier ${discordTimestamp(entry.lastSent, 'R')}`,
        ].join(' • ');
    });
    if (health.length > visible.length) lines.push('…');
    return lines.join('\n');
}

function buildResultEmbed(result, ownerCount) {
    let embed;
    if (ownerCount === 0) {
        embed = warningEmbed(
            'Aucun propriétaire configuré. Vérifie `OWNER_IDS` sur Render.',
            '⚠️ Configuration manquante',
        );
    } else if (result.delivered > 0) {
        embed = successEmbed(
            `Le journal a été livré à ${formatNumber(result.delivered)} propriétaire(s) en message privé.`,
            '✅ Test réussi',
        );
    } else {
        embed = errorEmbed(
            'Aucun message privé n’a été livré. Ouvre les DM du bot et active **Partage de serveur** dans ses paramètres.',
        ).setTitle('❌ Échec du test');
    }

    const status = ownerCount === 0
        ? '⚠️ Configuration à vérifier'
        : result.delivered > 0 ? '🟢 Opérationnel' : '🔴 En échec';

    return embed
        .addFields(
            { name: 'État', value: status, inline: false },
            {
                name: 'Propriétaires configurés',
                value: ownerCount ? `\`${formatNumber(ownerCount)}\`` : '`aucun`',
                inline: true,
            },
            { name: 'MP livrés', value: `\`${formatNumber(result.delivered)}\``, inline: true },
            { name: 'MP échoués', value: `\`${formatNumber(result.failed)}\``, inline: true },
            { name: 'Suivi des envois', value: buildHealthField(), inline: false },
        )
        .setFooter(brandFooter(CONTEXT));
}

export default {
    data: new SlashCommandBuilder()
        .setName('logtest')
        .setDescription('Teste l’envoi des logs en message privé (propriétaire, utilisable en MP)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .setDMPermission(true),

    category: 'debug',
    ownerOnly: true,

    async execute(interaction, config, client) {
        if (!isBotOwner(interaction.user.id)) {
            await sendError(interaction, 'Cette commande est réservée au propriétaire du bot.');
            return;
        }

        try {
            const result = await sendLogToOwners(client, () => ({ embeds: [buildLogEmbed(interaction)] }));
            const ownerCount = getBotOwnerIds().length;

            await InteractionHelper.safeReply(interaction, {
                embeds: [buildResultEmbed(result, ownerCount)],
                flags: MessageFlags.Ephemeral,
                allowedMentions: { parse: [], repliedUser: false },
            });
        } catch (error) {
            logger.error('Error in /logtest:', error);
            await sendError(interaction, 'Impossible de terminer le test. Réessaie dans un instant.');
        }
    },
};
