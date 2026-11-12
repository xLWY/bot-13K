const ownerIdCache = { value: null, warned: false };

function normalize(rawValue) {
    return String(rawValue || '')
        .split(',')
        .map((id) => id.trim().replace(/^["']|["']$/g, '').trim())
        .filter(Boolean);
}

export function getBotOwnerIds() {
    if (ownerIdCache.value !== null) {
        return ownerIdCache.value;
    }

    const raw = [
        process.env.OWNER_IDS,
        process.env.BOT_OWNER_IDS,
        process.env.OWNER_ID,
        process.env.BOT_OWNER_ID,
    ].filter(Boolean).join(',');
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
            console.warn('[ownerIds] No valid OWNER_IDS found; trying the Discord application owner as fallback.');
            console.warn('[ownerIds] You can also set OWNER_IDS on Render to your Discord user id (digits only, no quotes).');
        }
    }

    return ids;
}

export function isBotOwner(userId) {
    if (!userId) return false;
    return getBotOwnerIds().includes(String(userId));
}

export function getApplicationOwnerIds(application) {
    const owner = application?.owner;
    if (!owner) return [];

    if (owner.members instanceof Map) {
        return [...owner.members.keys()].filter(Boolean).map(String);
    }

    return owner.id ? [String(owner.id)] : [];
}

export function addBotOwnerIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return getBotOwnerIds();

    const merged = new Set(getBotOwnerIds());
    for (const id of ids) {
        const normalized = String(id ?? '').trim();
        if (/^\d{17,20}$/.test(normalized)) {
            merged.add(normalized);
        }
    }

    ownerIdCache.value = [...merged];
    return ownerIdCache.value;
}
