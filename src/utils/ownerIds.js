const ownerIdCache = { value: null };

export function getBotOwnerIds() {
    if (ownerIdCache.value) {
        return ownerIdCache.value;
    }

    const raw = process.env.OWNER_IDS || process.env.BOT_OWNER_IDS || '';
    const ids = raw
        .split(',')
        .map(id => id.trim())
        .filter(id => /^\d{17,20}$/.test(id));

    ownerIdCache.value = ids;
    return ids;
}

export function isBotOwner(userId) {
    if (!userId) return false;
    return getBotOwnerIds().includes(String(userId));
}
