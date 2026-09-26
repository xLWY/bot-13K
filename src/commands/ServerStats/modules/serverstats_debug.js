import { EmbedBuilder } from 'discord.js';
import { logger } from '../../../utils/logger.js';
import { getServerCounters } from '../../../services/serverstatsService.js';

function describe(value) {
    if (value === null) return '`null`';
    if (value === undefined) return '`undefined`';
    const type = Array.isArray(value) ? 'array' : typeof value;
    let size = '';
    if (Array.isArray(value)) size = ` (${value.length} élément(s))`;
    else if (typeof value === 'string') size = ` (${value.length} caractères)`;
    else if (value && typeof value === 'object') {
        try {
            size = ` (${Object.keys(value).length} clé(s))`;
        } catch {
            size = '';
        }
    }
    return `\`${type}\`${size}`;
}

export async function handleDebug(interaction, client) {
    const guildId = interaction.guild.id;

    let raw;
    let readError = null;

    try {
        raw = await client.db.get(`counters:${guildId}`);
    } catch (error) {
        readError = error;
        raw = undefined;
    }

    const counters = await getServerCounters(client, guildId);

    const rawPreview = (() => {
        if (raw === undefined) return '`undefined`';
        try {
            const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
            if (!text) return '`""` (vide)';
            return `\`\`\`json\n${text.substring(0, 900)}\n\`\`\``;
        } catch {
            return '`illisible`';
        }
    })();

    logger.error(`[SERVERSTATS DEBUG] guild=${guildId} rawType=${describe(raw)} parsed=${counters.length} readError=${readError?.message || 'none'} raw=${JSON.stringify(raw).substring(0, 900)}`);

    const dbStatus = (() => {
        try {
            return client.db?.getStatus?.() || null;
        } catch {
            return null;
        }
    })();

    const isDegraded = dbStatus?.isDegraded === true;

    const embed = new EmbedBuilder()
        .setTitle('🔍 Diagnostic des compteurs')
        .setColor(isDegraded || readError || counters.length === 0 ? 0xed4245 : 0x57f287)
        .addFields(
            {
                name: '📦 Valeur brute en base',
                value: `${describe(raw)}\n${rawPreview}`,
                inline: false,
            },
            {
                name: '✅ Compteurs exploitables',
                value: `\`${counters.length}\`\n${counters.length ? counters.map(c => `• \`${c.id}\` → ${c.type} → <#${c.channelId}>`).join('\n') : '`Aucun` — le panel affichera "Aucun".'}`,
                inline: false,
            },
            {
                name: '🔌 État de la base',
                value: isDegraded
                    ? '`⚠️ MODE MÉMOIRE` — PostgreSQL indisponible. Tout est perdu au prochain redémarrage. **C\'est la cause de la disparition.**'
                    : `\`${dbStatus?.connectionType || 'inconnu'}\`${dbStatus?.isDegraded === false ? ' — persistant, OK' : ''}`,
                inline: false,
            },
            {
                name: '🗄️ Type de backend',
                value: `\`${client.db?.constructor?.name || 'inconnu'}\``,
                inline: false,
            },
        )
        .setFooter({ text: 'Ce diagnostic est éphémère et ne modifie rien.' })
        .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: 64 });
}
