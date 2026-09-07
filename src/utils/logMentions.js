const USER_MENTION_RE = /<@!?(\d{17,20})>/g;

async function getUserLabel(client, guild, userId) {
    if (guild?.members?.cache?.has(userId)) {
        return { mention: true, label: `<@${userId}>` };
    }

    try {
        const cached = client.users?.cache?.get(userId);
        const user = cached || (await client.users?.fetch?.(userId).catch(() => null));
        if (user?.username) {
            return { mention: false, label: `@${user.username}` };
        }
    } catch {
        // fall through
    }

    return { mention: false, label: `@${userId}` };
}

export async function resolveLogMentions(client, guild, text) {
    if (typeof text !== 'string' || !text.includes('<@')) {
        return text;
    }

    const ids = [...text.matchAll(USER_MENTION_RE)]
        .map(match => match[1])
        .filter((value, index, array) => array.indexOf(value) === index);

    if (ids.length === 0) {
        return text;
    }

    const labels = new Map();
    for (const id of ids) {
        labels.set(id, (await getUserLabel(client, guild, id)).label);
    }

    return text.replace(USER_MENTION_RE, (match, id) => labels.get(id) ?? match);
}