import { logger } from './logger.js';

const DEFAULT_TEMPLATES = {
    welcome: 'Bienvenue {user} sur **{server}** ! 🎉\n\nNous sommes ravis de t\'accueillir parmi nous. N\'oublie pas de te présenter et de lire les salons pour découvrir le serveur !',
    goodbye: '{user.tag} a quitté le serveur.'
};

function replaceAll(message, token, value) {
    if (value === undefined || value === null) {
        return message;
    }
    return message.split(token).join(String(value));
}






export function formatWelcomeMessage(message, data) {
    
    if (typeof message !== 'string') return '';
    if (!message) return '';
    if (!data || typeof data !== 'object') return message;

    const user = data?.user;
    const guild = data?.guild;

    
    if (!user || typeof user !== 'object') {
        logger.warn('Invalid user object passed to formatWelcomeMessage');
    }
    if (!guild || typeof guild !== 'object') {
        logger.warn('Invalid guild object passed to formatWelcomeMessage');
    }

    const tokens = {
        '{user}': user?.toString?.() || 'Utilisateur',
        '{user.mention}': user?.toString?.() || 'Utilisateur',
        '{user.tag}': user?.tag || 'Inconnu#0000',
        '{user.username}': user?.username || 'Inconnu',
        '{username}': user?.username || 'Inconnu',
        '{user.discriminator}': user?.discriminator || '0000',
        '{user.id}': user?.id || 'inconnu',
        '{server}': guild?.name || 'Serveur',
        '{server.name}': guild?.name || 'Serveur',
        '{guild.name}': guild?.name || 'Serveur',
        '{guild.id}': guild?.id || 'inconnu',
        '{guild.memberCount}': guild?.memberCount?.toString?.() || '0',
        '{memberCount}': guild?.memberCount?.toString?.() || '0',
        '{membercount}': guild?.memberCount?.toString?.() || '0'
    };

    let result = message;
    for (const [token, value] of Object.entries(tokens)) {
        if (value === undefined || value === null) continue;
        result = replaceAll(result, token, String(value));
    }

    return result;
}

export function getDefaultWelcomeMessage() {
    return DEFAULT_TEMPLATES.welcome;
}

export function getDefaultGoodbyeMessage() {
    return DEFAULT_TEMPLATES.goodbye;
}


