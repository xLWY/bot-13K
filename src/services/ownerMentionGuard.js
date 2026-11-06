import { logModerationAction } from '../utils/moderation.js';
import { getBotOwnerIds } from '../utils/ownerIds.js';
import { logger } from '../utils/logger.js';

const OWNER_MENTION_TIMEOUT_MS = 2 * 60 * 1000;
const OWNER_MENTION_REASON = 'Mention du propriétaire du bot';

function formatTimeoutDuration(ms) {
  const seconds = Math.max(0, Math.round(Number(ms) / 1000));
  if (seconds >= 3600) return `${Math.round(seconds / 3600)} h`;
  if (seconds >= 60) return `${Math.round(seconds / 60)} min`;
  return `${seconds} s`;
}

function findMentionedOwner(message, ownerIds) {
  if (!message || ownerIds.length === 0) return null;

  const mentionedUsers = message.mentions?.users;
  if (!mentionedUsers) return null;

  for (const ownerId of ownerIds) {
    if (mentionedUsers.has(ownerId)) return ownerId;
  }

  return null;
}

/**
 * Supprime le message et applique un timeout de 2 minutes à toute personne
 * (sauf le propriétaire lui-même) qui mentionne un owner du bot.
 */
export async function handleOwnerMention(message, client) {
  try {
    if (!message?.guild || !message.author?.id || message.author.bot || message.system) {
      return false;
    }

    const ownerIds = getBotOwnerIds();
    if (ownerIds.length === 0 || ownerIds.includes(message.author.id)) {
      return false;
    }

    const mentionedOwnerId = findMentionedOwner(message, ownerIds);
    if (!mentionedOwnerId) return false;

    let deleted = false;
    try {
      await message.delete();
      deleted = true;
    } catch (error) {
      logger.debug(`Owner mention guard: suppression impossible pour ${message.id}: ${error.message}`);
    }

    const member =
      message.member ||
      await message.guild.members.fetch(message.author.id).catch(() => null);

    const existingTimeoutEnds = Number(member?.communicationDisabledUntilTimestamp) || 0;
    const remainingExistingTimeoutMs = Math.max(0, existingTimeoutEnds - Date.now());
    const timeoutDurationMs = Math.max(OWNER_MENTION_TIMEOUT_MS, remainingExistingTimeoutMs);
    const extendedExistingTimeout = remainingExistingTimeoutMs > OWNER_MENTION_TIMEOUT_MS;
    const timeoutStartedAt = Date.now();

    let timedOut = false;
    if (member?.moderatable) {
      timedOut = await member
        .timeout(timeoutDurationMs, OWNER_MENTION_REASON)
        .then(() => true)
        .catch((error) => {
          logger.debug(`Owner mention guard: timeout impossible pour ${member.user.tag}: ${error.message}`);
          return false;
        });
    }

    const action = timedOut
      ? 'Member Timed Out'
      : deleted
        ? 'Messages Purged'
        : 'Owner Mention Guard';

    const metadata = {
      userId: member?.id || message.author.id,
      moderatorId: client.user.id,
      ownerMentionGuard: 'Mention du propriétaire',
      ownerMentioned: `<@${mentionedOwnerId}>`
    };

    if (deleted) metadata.deletedMessages = 1;
    if (timedOut) {
      metadata.durationMinutes = Math.max(2, Math.round(timeoutDurationMs / 60000));
      metadata.timeoutEnds = new Date(timeoutStartedAt + timeoutDurationMs).toISOString();
      if (extendedExistingTimeout) {
        metadata.existingTimeoutPreserved = true;
      }
    } else {
      metadata.timeoutFailed = true;
    }
    if (!deleted) metadata.deletionFailed = true;

    void logModerationAction({
      client,
      guild: message.guild,
      event: {
        action,
        target: `<@${message.author.id}>`,
        executor: `<@${client.user.id}>`,
        reason: action === 'Owner Mention Guard'
          ? `${OWNER_MENTION_REASON} — aucune sanction appliquée (permissions du bot insuffisantes)`
          : OWNER_MENTION_REASON,
        duration: timedOut ? formatTimeoutDuration(timeoutDurationMs) : undefined,
        metadata
      }
    }).catch((error) => {
      logger.debug(`Owner mention guard: journalisation impossible: ${error.message}`);
    });

    logger.info(
      `Owner mention guard: ${message.author.tag} a mentionné le propriétaire ` +
      `dans ${message.guild.name} (${deleted ? 'message supprimé' : 'suppression échouée'}, ` +
      `${timedOut ? `timeout ${formatTimeoutDuration(timeoutDurationMs)}` : 'timeout échoué'})`
    );

    return true;
  } catch (error) {
    logger.error('Owner mention guard error:', error);
    return false;
  }
}
