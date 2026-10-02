import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';
import { buildRoleAuditFields } from '../utils/roleLogFields.js';

const MAX_DISPLAYED_PERM_DIFF = 8;

function formatPermList(list) {
  const shown = list.slice(0, MAX_DISPLAYED_PERM_DIFF).map(p => `\`${p}\``).join('\n');
  return list.length > MAX_DISPLAYED_PERM_DIFF
    ? `${shown}\n... (+${list.length - MAX_DISPLAYED_PERM_DIFF})`
    : shown;
}

function diffPermissions(oldRole, newRole) {
  const before = new Set(oldRole.permissions.toArray());
  const after = new Set(newRole.permissions.toArray());
  return {
    added: [...after].filter(p => !before.has(p)),
    removed: [...before].filter(p => !after.has(p)),
  };
}

export default {
  name: Events.GuildRoleUpdate,
  once: false,

  async execute(oldRole, newRole) {
    try {
      if (!newRole?.guild || !oldRole) return;
      if (oldRole.id !== newRole.id) return;

      const changes = [];

      if (oldRole.name !== newRole.name) {
        changes.push({
          name: '📝 Nom',
          value: `\`${oldRole.name}\` → \`${newRole.name}\``,
          inline: false
        });
      }

      if (oldRole.hexColor !== newRole.hexColor) {
        changes.push({
          name: '🎨 Couleur',
          value: `\`${oldRole.hexColor}\` → \`${newRole.hexColor}\``,
          inline: true
        });
      }

      if (oldRole.hoist !== newRole.hoist) {
        changes.push({
          name: '👥 Affiché séparément',
          value: `${oldRole.hoist ? 'Oui' : 'Non'} → ${newRole.hoist ? 'Oui' : 'Non'}`,
          inline: true
        });
      }

      if (oldRole.position !== newRole.position) {
        changes.push({
          name: '📊 Position',
          value: `\`${oldRole.position}\` → \`${newRole.position}\``,
          inline: true
        });
      }

      const { added, removed } = diffPermissions(oldRole, newRole);

      if (added.length > 0) {
        changes.push({
          name: '🔑 Permissions ajoutées',
          value: formatPermList(added),
          inline: false
        });
      }

      if (removed.length > 0) {
        changes.push({
          name: '🔓 Permissions retirées',
          value: formatPermList(removed),
          inline: false
        });
      }

      if (changes.length === 0) return;

      const fields = [...changes, ...buildRoleAuditFields(newRole, { includeMemberCount: true })];

      await logEvent({
        client: newRole.client,
        guildId: newRole.guild.id,
        eventType: EVENT_TYPES.ROLE_UPDATE,
        data: {
          description: `Le rôle ${newRole.toString()} a été modifié`,
          fields: fields.slice(0, 25)
        }
      });
    } catch (error) {
      logger.error('Error in roleUpdate event:', error);
    }
  }
};
