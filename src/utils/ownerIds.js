const ownerIdCache = { value: null, warned: false };

function normalize(rawValue) {
    return String(rawValue || '')
        .split(',')
        .map((id) => id.trim().replace(/^["']|["']$/g, '').trim())
        .filter(Boolean);
}

export function getBotOwnerIds() {
    if (ownerIdCache.value) {
        return ownerIdCache.value;
    }

    const raw = process.env.OWNER_IDS || process.env.BOT_OWNER_IDS || '';
    const candidates = normalize(raw);

    const ids = [];
    const invalid = [];

    for (const candidate of candidates) {
        if (/^\d{17,20}$/.test(candidate)) {
            if (!ids.includes(candidate)) ids.push(candidate);
        } else {
            invalid.push(candidate);
        }
    }

    ownerIdCache.value = ids;

    if (!ownerIdCache.warned) {
        ownerIdCache.warned = true;
        console.warn(`[ownerIds] OWNER_IDS parsed -> ${ids.length} valid id(s)${ids.length ? ` [${ids.join(', ')}]` : ''}`);
        if (invalid.length > 0) {
            console.warn(`[ownerIds] IGNORED invalid OWNER_IDS entries: ${invalid.join(', ')} (remove quotes/spaces, digits only)`);
        }
        if (ids.length === 0) {
            console.warn('[ownerIds] CRITICAL: no valid owner id -> owner features and DM commands are DISABLED.');
            console.warn('[ownerIds] Set OWNER_IDS in Railway to your Discord user id (digits only, no quotes).');
        }
    }

    return ids;
}

export function isBotOwner(userId) {
    if (!userId) return false;
    return getBotOwnerIds().includes(String(userId));
}
