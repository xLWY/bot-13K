import { EmbedBuilder } from 'discord.js';
import { getColor } from '../config/bot.js';





export const MessageTemplates = {
    SUCCESS: {
        DATA_UPDATED: (action, description) => new EmbedBuilder()
            .setColor(getColor('success'))
            .setTitle(`✅ ${action.charAt(0).toUpperCase() + action.slice(1)} réussi`)
            .setDescription(description)
            .setTimestamp(),
        
        COMMAND_EXECUTED: (command) => new EmbedBuilder()
            .setColor(getColor('success'))
            .setTitle('✅ Commande exécutée')
            .setDescription(`Commande \`${command}\` exécutée avec succès`)
            .setTimestamp()
    },

    ERRORS: {
        DATABASE_ERROR: (operation) => new EmbedBuilder()
            .setColor(getColor('error'))
            .setTitle('🗄️ Erreur de base de données')
            .setDescription(`J'ai des problèmes avec ma base de données pendant ${operation}. Réessaie plus tard.`)
            .setTimestamp(),
        
        INSUFFICIENT_FUNDS: (currency, description) => new EmbedBuilder()
            .setColor(getColor('warning'))
            .setTitle('💰 Fonds insuffisants')
            .setDescription(description || `Tu n'as pas assez de ${currency} pour cette opération.`)
            .setTimestamp(),
        
        PERMISSION_DENIED: (permission) => new EmbedBuilder()
            .setColor(getColor('error'))
            .setTitle('🚫 Permission refusée')
            .setDescription(`Tu as besoin de la permission \`${permission}\` pour utiliser cette commande.`)
            .setTimestamp(),
        
        INVALID_INPUT: (field) => new EmbedBuilder()
            .setColor(getColor('warning'))
            .setTitle('❌ Entrée invalide')
            .setDescription(`Le ${field || 'contenu'} que tu as fourni est invalide. Vérifie et réessaie.`)
            .setTimestamp()
    },

    INFO: {
        LOADING: (description) => new EmbedBuilder()
            .setColor(getColor('warning'))
            .setTitle('⏳ Chargement...')
            .setDescription(description || 'Veuillez patienter pendant que je traite ta demande.')
            .setTimestamp(),
        
        PROCESSING: (description) => new EmbedBuilder()
            .setColor(getColor('info'))
            .setTitle('⚙️ Traitement en cours')
            .setDescription(description || 'Traitement de ta demande...')
            .setTimestamp()
    }
};

export const ContextualMessages = {
    configUpdated: (title, configLines) => new EmbedBuilder()
        .setColor(getColor('success'))
        .setTitle(`✅ ${title} mis à jour`)
        .setDescription(configLines.join('\n'))
        .setTimestamp()
};

export default MessageTemplates;



