/**
 * Métadonnées partagées des commandes.
 *
 * Une seule source de vérité pour les libellés de catégories et les listes
 * DM/global : avant ce module, `commandLoader.js`, `help.js` et
 * `prefixCommands.js` maintenaient trois copies qui pouvaient diverger.
 */

// Libellés affichés dans /help. Les clés sont les valeurs de `command.category`.
export const CATEGORY_LABELS = {
    commands: 'Général',
    general: 'Général',
    debug: 'Diagnostic',
    Owner: 'Propriétaire',
    Moderation: 'Modération',
    Reaction_roles: 'Rôles par réaction',
    JoinToCreate: 'Salons temporaires',
    ServerStats: 'Statistiques',
    Settings: 'Paramètres',
    Ticket: 'Tickets',
    Utility: 'Utilitaire',
    Utilitaire: 'Utilitaire',
    Giveaway: 'Giveaways',
    Welcome: 'Bienvenue',
};

// Commandes autorisées en message privé (slash + préfixe).
export const DM_ENABLED_COMMANDS = new Set([
    'ping', 'diag', 'logtest', 'help', 'avatar', 'ownerrole', 'manage',
    'invite', 'botinfo',
]);

// Commandes enregistrées aussi globalement pour fonctionner en MP.
// Les commandes owner sont protégées par `ownerOnly` et un contrôle
// `isBotOwner()` dans leur `execute()` : le flag seul ne suffit pas.
export const GLOBAL_COMMANDS = new Set(['ownerrole', 'manage', 'invite', 'botinfo']);

export function getCategoryLabel(category) {
    return CATEGORY_LABELS[category] || category || 'Divers';
}
