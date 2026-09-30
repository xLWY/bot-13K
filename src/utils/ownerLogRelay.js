import { getBotOwnerIds } from './ownerIds.js';
import { logger } from './logger.js';

const warnedOwners = new Set();

/**
 * Envoie un log au(x) proprietaire(s) du bot en message prive.
 * Retourne le nombre de DM livres afin de pouvoir basculer
 * sur le salon de logs si aucun owner n'est joignable.
 */
export async function sendLogToOwners(client, buildPayload) {
    const ownerIds = getBotOwnerIds();

    if (!ownerIds.length) {
        return { delivered: 0, failed: 0, ownerIds: [] };
    }

    let delivered = 0;
    let failed = 0;

    await Promise.all(ownerIds.map(async (id) => {
        try {
            const user = await client.users.fetch(id);
            if (!user || typeof user.send !== 'function') {
                failed += 1;
                return;
            }
            const payload = typeof buildPayload === 'function' ? buildPayload() : buildPayload;
            if (!payload) {
                return;
            }
            await user.send(payload);
            delivered += 1;
        } catch (error) {
            failed += 1;
            if (!warnedOwners.has(id)) {
                warnedOwners.add(id);
                logger.warn(
                    `ownerLogRelay: DM impossible vers ${id} (${error.code || error.message}). ` +
                    'Active "Partage de serveur" pour cet utilisateur, sinon les logs seront perdus.',
                );
            }
        }
    }));

    return { delivered, failed, ownerIds };
}

export async function canDmOwners(client) {
    const ownerIds = getBotOwnerIds();
    if (!ownerIds.length) return false;
    try {
        await client.users.fetch(ownerIds[0]);
        return true;
    } catch {
        return false;
    }
}

export function resetOwnerDmWarnings() {
    warnedOwners.clear();
}