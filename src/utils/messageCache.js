// Cache memoire des messages recents.
// Discord ne fournit pas le contenu d'un message supprime s'il n'est plus
// dans le cache interne de discord.js (message envoye avant le demarrage du
// bot, cache expire, etc.). On garde donc une copie legere des derniers
// messages pour pouvoir afficher leur contenu dans les logs de suppression.

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12 heures
const DEFAULT_MAX_ENTRIES = 5000;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

const cache = new Map();
const silentDeleteIds = new Map();
const SILENT_DELETE_TTL_MS = 60 * 1000;
let ttlMs = DEFAULT_TTL_MS;
let maxEntries = DEFAULT_MAX_ENTRIES;

function truncate(value, max) {
  const str = String(value ?? '');
  return str.length > max ? `${str.substring(0, max - 3)}...` : str;
}

function serializeAttachments(attachments) {
  if (!attachments) return [];
  const list = attachments.values ? [...attachments.values()] : [...attachments];
  return list.slice(0, 10).map((attachment) => ({
    name: truncate(attachment.name ?? 'fichier', 100),
    url: attachment.url ?? attachment.proxyURL ?? '',
    contentType: attachment.contentType ?? null,
    size: attachment.size ?? null,
  }));
}

export function cacheMessage(message) {
  if (!message?.id || !message.guildId) return null;

  const existing = cache.get(message.id);
  const hasContent = typeof message.content === 'string' && message.content.length > 0;
  const content = hasContent ? message.content : (existing?.content ?? '');
  const attachments = message.attachments?.size
    ? serializeAttachments(message.attachments)
    : (existing?.attachments ?? []);

  const entry = {
    id: message.id,
    guildId: message.guildId,
    channelId: message.channelId ?? message.channel?.id ?? existing?.channelId ?? null,
    authorId: message.author?.id ?? existing?.authorId ?? null,
    authorTag: message.author?.tag ?? existing?.authorTag ?? null,
    authorBot: message.author?.bot ?? existing?.authorBot ?? false,
    content,
    createdTimestamp: message.createdTimestamp ?? existing?.createdTimestamp ?? null,
    attachments,
    cachedAt: Date.now(),
  };

  cache.set(message.id, entry);

  if (cache.size > maxEntries) {
    const overflow = cache.size - maxEntries;
    let removed = 0;
    for (const key of cache.keys()) {
      cache.delete(key);
      removed += 1;
      if (removed >= overflow) break;
    }
  }

  return entry;
}

export function getCachedMessage(messageId) {
  if (!messageId) return null;
  const entry = cache.get(messageId);
  if (!entry) return null;

  if (Date.now() - entry.cachedAt > ttlMs) {
    cache.delete(messageId);
    return null;
  }

  return entry;
}

// Marque une suppression comme volontaire (ex: commande prefixe nettoyee
// automatiquement) pour ne pas la journaliser comme une suppression de membre.
export function markMessageDeletionSilent(messageId) {
  if (!messageId) return;
  silentDeleteIds.set(messageId, Date.now() + SILENT_DELETE_TTL_MS);
}

export function isMessageDeletionSilent(messageId) {
  if (!messageId) return false;
  const expiresAt = silentDeleteIds.get(messageId);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    silentDeleteIds.delete(messageId);
    return false;
  }
  return true;
}

export function clearMessageDeletionSilent(messageId) {
  if (!messageId) return;
  silentDeleteIds.delete(messageId);
}

function sweep() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.cachedAt > ttlMs) {
      cache.delete(key);
    }
  }
  for (const [key, expiresAt] of silentDeleteIds) {
    if (now > expiresAt) {
      silentDeleteIds.delete(key);
    }
  }
}

const sweeper = setInterval(sweep, SWEEP_INTERVAL_MS);
if (typeof sweeper.unref === 'function') sweeper.unref();

// Utile pour les tests ou un futur reglage via variable d'environnement.
export function configureMessageCache({ ttl, maxEntries: max } = {}) {
  if (Number.isFinite(ttl) && ttl > 0) ttlMs = ttl;
  if (Number.isFinite(max) && max > 0) maxEntries = max;
}

export function getMessageCacheSize() {
  return cache.size;
}
