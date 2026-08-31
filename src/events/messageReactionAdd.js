import { Events } from 'discord.js';
import { handleReactionRoleEvent } from '../services/verifyreactService.js';

export default {
    name: Events.MessageReactionAdd,
    once: false,

    async execute(reaction, user, client) {
        if (!reaction || user?.bot) return;

        try {
            if (reaction.partial) {
                await reaction.fetch();
            }
            if (reaction.message?.partial) {
                await reaction.message.fetch();
            }
        } catch (error) {
            return;
        }

        await handleReactionRoleEvent(client, reaction, user, 'add');
    }
};