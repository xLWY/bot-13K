/**
 * Construction centralisée du lien OAuth2 d'invitation du bot.
 *
 * Utilisé à la fois par `/manage invite` et par le log de démarrage, pour que
 * le propriétaire puisse récupérer le lien même si les MP Discord sont
 * bloqués de son côté.
 */

// Recommandé : voir + envoyer + intégrer + historique + réactions + emojis
// externes + gérer rôles/salons + kick/ban.
export const RECOMMENDED_INVITE_PERMISSIONS = 268782678n;

export function buildBotInviteUrl(clientId, permissions = RECOMMENDED_INVITE_PERMISSIONS) {
    if (!clientId) return null;

    const params = new URLSearchParams();
    params.set('client_id', String(clientId));
    params.set('scope', 'bot applications.commands');
    params.set('permissions', BigInt(permissions).toString());

    return `https://discord.com/oauth2/authorize?${params.toString().replace(/\+/g, '%20')}`;
}
