import { getBotOwnerIds } from './ownerIds.js';
import { logger } from './logger.js';

const MIN_GAP_MS = 1100;
const MAX_RETRIES = 3;
const WARN_EVERY = 10;

const state = new Map();

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getEntry(ownerId) {
    if (!state.has(ownerId)) {
        state.set(ownerId, { chain: Promise.resolve(), lastSent: 0, failures: 0 });
    }
    return state.get(ownerId);
}

async function deliverToOwner(client, ownerId, buildPayload) {
    const entry = getEntry(ownerId);

    entry.chain = entry.chain.then(async () => {
        const gap = Math.max(0, entry.lastSent + MIN_GAP_MS - Date.now());
        if (gap > 0) await sleep(gap);

        for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
            try {
                const user = await client.users.fetch(ownerId);
                if (!user || typeof user.send !== 'function') {
                    throw new Error('user.send indisponible');
                }

                const payload = typeof buildPayload === 'function' ? buildPayload() : buildPayload;
                if (!payload) {
                    entry.lastSent = Date.now();
                    return { ok: true, skipped: true };
                }

                await user.send(payload);
                entry.lastSent = Date.now();

                if (entry.failures > 0) {
                    logger.info(`ownerLogRelay: DM retabli vers ${ownerId} apres ${entry.failures} echec(s).`);
                    entry.failures = 0;
                }
                return { ok: true };
            } catch (error) {
                const code = error?.code || error?.message;

                if (attempt < MAX_RETRIES) {
                    await sleep(attempt * 700);
                    continue;
                }

                entry.failures += 1;
                if (entry.failures === 1 || entry.failures % WARN_EVERY === 0) {
                    logger.warn(
                        `ownerLogRelay: DM impossible vers ${ownerId} (${code}) - ${entry.failures} echec(s) cumule(s). ` +
                        'Active "Partage de serveur" dans les DM du bot, sinon les logs sont perdus.',
                    );
                }
                return { ok: false, code };
            }
        }

        return { ok: false, code: 'unknown' };
    });

    return entry.chain;
}

/**
 * Envoie un log au(x) proprietaire(s) du bot en message prive.
 * Les envois sont serialises par owner afin de ne pas declencher
 * le rate limit des DM, avec re-tentatives automatiques.
 */
export async function sendLogToOwners(client, buildPayload) {
    const ownerIds = getBotOwnerIds();

    if (!ownerIds.length) {
        return { delivered: 0, failed: 0, ownerIds: [] };
    }

    const results = await Promise.all(ownerIds.map(id => deliverToOwner(client, id, buildPayload)));

    const delivered = results.filter(r => r.ok).length;
    const failed = results.length - delivered;

    return { delivered, failed, ownerIds };
}

export function ownerDmHealth() {
    return [...state.entries()].map(([ownerId, entry]) => ({
        ownerId,
        failures: entry.failures,
        lastSent: entry.lastSent,
    }));
}

export function resetOwnerDmWarnings() {
    state.clear();
}
