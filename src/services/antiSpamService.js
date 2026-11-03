import { PermissionFlagsBits } from 'discord.js';
import { getGuildConfig } from './guildConfig.js';
import { logModerationAction } from '../utils/moderation.js';
import { DEFAULT_ANTISPAM_CONFIG } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

const CONFIG_CACHE_TTL_MS = 30_000;
const HISTORY_MAX_AGE_MS = 3 * 60 * 1000;
const MAX_TRACKED_MESSAGES = 60;
const PUNISH_COOLDOWN_MS = 30_000;

const configCache = new Map();
const userHistory = new Map();

function clampInt(value, min, max, fallback) {
  if (value === undefined || value === null || value === '') return fallback;

  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

export function normalizeAntiSpamConfig(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};

  return {
    enabled: typeof source.enabled === 'boolean'
      ? source.enabled
      : DEFAULT_ANTISPAM_CONFIG.enabled,
    messagesPerWindow: clampInt(
      source.messagesPerWindow,
      3,
      50,
      DEFAULT_ANTISPAM_CONFIG.messagesPerWindow
    ),
    windowSeconds: clampInt(
      source.windowSeconds,
      2,
      60,
      DEFAULT_ANTISPAM_CONFIG.windowSeconds
    ),
    duplicateThreshold: clampInt(
      source.duplicateThreshold,
      2,
      20,
      DEFAULT_ANTISPAM_CONFIG.duplicateThreshold
    ),
    duplicateWindowSeconds: clampInt(
      source.duplicateWindowSeconds,
      5,
      120,
      DEFAULT_ANTISPAM_CONFIG.duplicateWindowSeconds
    ),
    mentionLimit: clampInt(
      source.mentionLimit,
      1,
      25,
      DEFAULT_ANTISPAM_CONFIG.mentionLimit
    ),
    timeoutSeconds: clampInt(
      source.timeoutSeconds,
      30,
      28 * 24 * 60 * 60,
      DEFAULT_ANTISPAM_CONFIG.timeoutSeconds
    ),
    deleteMessages: typeof source.deleteMessages === 'boolean'
      ? source.deleteMessages
      : DEFAULT_ANTISPAM_CONFIG.deleteMessages,
    notify: typeof source.notify === 'boolean'
      ? source.notify
      : DEFAULT_ANTISPAM_CONFIG.notify,
    ignoredChannels: stringArray(source.ignoredChannels),
    ignoredRoles: stringArray(source.ignoredRoles),
    ignoredUsers: stringArray(source.ignoredUsers)
  };
}

export async function getAntiSpamConfig(client, guildId, { force = false } = {}) {
  const cached = configCache.get(guildId);
  if (!force && cached && cached.expiresAt > Date.now()) {
    return cached.config;
  }

  const guildConfig = await getGuildConfig(client, guildId);
  const config = normalizeAntiSpamConfig(guildConfig?.antiSpam);

  configCache.set(guildId, {
    config,
    expiresAt: Date.now() + CONFIG_CACHE_TTL_MS
  });

  return config;
}

export function invalidateAntiSpamConfig(guildId) {
  configCache.delete(guildId);
}

function normalizeContent(content) {
  return String(content || '')
    .toLowerCase()
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getHistory(key) {
  let state = userHistory.get(key);
  if (!state) {
    state = {
      messages: [],
      lastPunishedAt: 0
    };
    userHistory.set(key, state);
  }
  return state;
}

function pruneHistory(state, now) {
  state.messages = state.messages.filter((message) => now - message.at <= HISTORY_MAX_AGE_MS);
}

function detectSpam(message, state, config, now) {
  const recentMessages = state.messages.filter(
    (entry) => now - entry.at <= config.windowSeconds * 1000
  );

  if (recentMessages.length >= config.messagesPerWindow) {
    return {
      type: 'rate',
      reason: `${recentMessages.length} messages en ${config.windowSeconds} s`,
      messageCount: recentMessages.length,
      entries: recentMessages
    };
  }

  const content = normalizeContent(message.content);
  if (content.length >= 4) {
    const duplicates = state.messages.filter(
      (entry) =>
        now - entry.at <= config.duplicateWindowSeconds * 1000 &&
        normalizeContent(entry.content) === content
    );

    if (duplicates.length >= config.duplicateThreshold) {
      return {
        type: 'duplicate',
        reason: `${duplicates.length} messages identiques en ${config.duplicateWindowSeconds} s`,
        messageCount: duplicates.length,
        duplicateCount: duplicates.length,
        entries: duplicates
      };
    }
  }

  const mentionCount =
    message.mentions.users.size +
    message.mentions.roles.size +
    (message.mentions.everyone ? 1 : 0);

  if (mentionCount >= config.mentionLimit) {
    return {
      type: 'mentions',
      reason: `${mentionCount} mentions dans un seul message`,
      messageCount: 1,
      mentionCount,
      entries: state.messages.filter((entry) => entry.id === message.id)
    };
  }

  return null;
}

async function deleteTrackedMessages(guild, history, ignoredChannels = []) {
  const byChannel = new Map();

  for (const entry of history) {
    if (!entry.id || !entry.channelId) continue;
    if (!byChannel.has(entry.channelId)) {
      byChannel.set(entry.channelId, []);
    }
    byChannel.get(entry.channelId).push(entry.id);
  }

  let deletedCount = 0;

  for (const [channelId, rawIds] of byChannel) {
    if (ignoredChannels.includes(channelId)) continue;

    const ids = [...new Set(rawIds)].slice(-50);
    if (ids.length === 0) continue;

    const channel =
      guild.channels.cache.get(channelId) ||
      await guild.channels.fetch(channelId).catch(() => null);

    if (!channel?.messages) continue;

    try {
      if (ids.length === 1) {
        const target = await channel.messages.fetch(ids[0]).catch(() => null);
        if (target) {
          await target.delete();
          deletedCount++;
        }
      } else {
        const deleted = await channel.messages.bulkDelete(ids, true);
        deletedCount += deleted.size;
      }
    } catch (bulkError) {
      logger.debug(`Suppression groupée anti-spam impossible : ${bulkError.message}`);

      for (const id of ids) {
        const target = await channel.messages.fetch(id).catch(() => null);
        if (!target) continue;
        await target.delete().then(() => {
          deletedCount++;
        }).catch(() => {});
      }
    }
  }

  return deletedCount;
}

function formatDuration(seconds) {
  if (seconds >= 3600) {
    const hours = Math.round(seconds / 3600);
    return `${hours} h`;
  }
  if (seconds >= 60) {
    const minutes = Math.round(seconds / 60);
    return `${minutes} min`;
  }
  return `${seconds} s`;
}

async function sendNotice(message, member, config, timedOut, deletedCount) {
  if (!config.notify) return;

  let content;
  if (timedOut) {
    content = `⛔ <@${member.id}> a été **réduit au silence** pendant **${formatDuration(config.timeoutSeconds)}** pour spam.`;
  } else if (deletedCount > 0) {
    content = `⛔ <@${member.id}> : messages supprimés pour spam.`;
  } else {
    return;
  }

  const notice = await message.channel
    .send({ content, allowedMentions: { parse: [] } })
    .catch(() => null);

  if (!notice) return;

  const timer = setTimeout(() => {
    notice.delete().catch(() => {});
  }, 10_000);
  timer.unref?.();
}

async function punish({ client, message, member, config, detection, state }) {
  const messagesToDelete = detection.entries?.length
    ? detection.entries
    : state.messages.filter((entry) => entry.id === message.id);

  state.messages = [];
  state.lastPunishedAt = Date.now();

  const timeoutMs = config.timeoutSeconds * 1000;
  let timedOut = false;

  if (member.moderatable) {
    timedOut = await member
      .timeout(timeoutMs, `Anti-spam : ${detection.reason}`)
      .then(() => true)
      .catch((error) => {
        logger.debug(`Timeout anti-spam impossible pour ${member.user.tag} : ${error.message}`);
        return false;
      });
  }

  const deletedCount = config.deleteMessages
    ? await deleteTrackedMessages(message.guild, messagesToDelete, config.ignoredChannels)
    : 0;

  await sendNotice(message, member, config, timedOut, deletedCount);

  const action = timedOut
    ? 'Member Timed Out'
    : deletedCount > 0
      ? 'Messages Purged'
      : null;
  const reason = `Anti-spam automatique : ${detection.reason}`;

  if (action) {
    const metadata = {
      userId: member.id,
      moderatorId: client.user.id,
      autoSpam: true,
      spamMessages: detection.messageCount
    };

    if (deletedCount > 0) metadata.deletedMessages = deletedCount;
    if (detection.duplicateCount) metadata.spamDuplicates = detection.duplicateCount;
    if (detection.mentionCount) metadata.spamMentions = detection.mentionCount;
    if (timedOut) metadata.durationMs = timeoutMs;

    void logModerationAction({
      client,
      guild: message.guild,
      event: {
        action,
        target: `<@${member.id}>`,
        executor: `<@${client.user.id}>`,
        reason,
        duration: timedOut ? formatDuration(config.timeoutSeconds) : undefined,
        metadata
      }
    }).catch((error) => {
      logger.debug(`Journalisation anti-spam impossible : ${error.message}`);
    });

    logger.info(
      `Anti-spam : ${member.user.tag} ${timedOut ? 'réduit au silence' : 'filtré'} ` +
      `dans ${message.guild.name} (${detection.reason})`
    );
  } else {
    logger.warn(
      `Anti-spam : aucune action possible contre ${member.user.tag} dans ${message.guild.name} ` +
      `(permissions du bot insuffisantes)`
    );
  }
}

export async function handleAntiSpam(message, client) {
  try {
    if (!message?.guild || message.author?.bot || message.system) {
      return false;
    }

    const member =
      message.member ||
      await message.guild.members.fetch(message.author.id).catch(() => null);

    if (!member || member.user.bot) {
      return false;
    }

    if (member.id === message.guild.ownerId) {
      return false;
    }

    if (
      member.permissions.has(PermissionFlagsBits.Administrator) ||
      member.permissions.has(PermissionFlagsBits.ManageGuild) ||
      member.permissions.has(PermissionFlagsBits.ManageMessages)
    ) {
      return false;
    }

    const config = await getAntiSpamConfig(client, message.guild.id);
    if (!config.enabled) {
      return false;
    }

    const channelIds = [message.channel.id, message.channel.parentId].filter(Boolean);
    if (channelIds.some((channelId) => config.ignoredChannels.includes(channelId))) {
      return false;
    }

    if (config.ignoredUsers.includes(member.id)) {
      return false;
    }

    if (member.roles.cache.some((role) => config.ignoredRoles.includes(role.id))) {
      return false;
    }

    const now = Date.now();
    const state = getHistory(`${message.guild.id}:${member.id}`);
    pruneHistory(state, now);

    if (state.lastPunishedAt && now - state.lastPunishedAt < PUNISH_COOLDOWN_MS) {
      return false;
    }

    state.messages.push({
      id: message.id,
      channelId: message.channel.id,
      at: now,
      content: message.content || ''
    });

    if (state.messages.length > MAX_TRACKED_MESSAGES) {
      state.messages.splice(0, state.messages.length - MAX_TRACKED_MESSAGES);
    }

    const detection = detectSpam(message, state, config, now);
    if (!detection) {
      return false;
    }

    await punish({ client, message, member, config, detection, state });
    return true;
  } catch (error) {
    logger.debug(`Erreur du filtre anti-spam : ${error.message}`);
    return false;
  }
}

const cleanupTimer = setInterval(() => {
  const now = Date.now();

  for (const [key, state] of userHistory) {
    pruneHistory(state, now);
    if (state.messages.length === 0 && now - state.lastPunishedAt > 60 * 60 * 1000) {
      userHistory.delete(key);
    }
  }

  for (const [guildId, entry] of configCache) {
    if (entry.expiresAt <= now) {
      configCache.delete(guildId);
    }
  }
}, 10 * 60 * 1000);

cleanupTimer.unref?.();
