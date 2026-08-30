import { Events } from "discord.js";
import { logger, startupLog } from "../utils/logger.js";
import config from "../config/application.js";
import { reconcileReactionRoleMessages } from "../services/reactionRoleService.js";
import { seedActiveVoiceSessions } from "./voiceStateUpdate.js";

export default {
  name: Events.ClientReady,
  once: true,

  async execute(client) {
    try {
      client.user.setPresence(config.bot.presence);

      startupLog(`Ready! Logged in as ${client.user.tag}`);
      startupLog(`Serving ${client.guilds.cache.size} guild(s)`);
      startupLog(`Loaded ${client.commands.size} commands`);

      for (const [, guild] of client.guilds.cache) {
        const presenceCount = guild.presences.cache.size;
        if (presenceCount === 0) {
          logger.warn(
            `[Presence diagnostic] Guild "${guild.name}" has an EMPTY presence cache ` +
            `(${guild.memberCount} members) — the GuildPresences intent is likely disabled, ` +
            `or the bot was not restarted after enabling it. Online counters will be frozen/stale. ` +
            `Check: Discord Developer Portal → Bot → Privileged Gateway Intents → PRESENCE INTENT.`
          );
        }
      }

      seedActiveVoiceSessions(client);

      if (typeof client.updateAllCounters === 'function') {
        client.updateAllCounters().catch((error) => logger.warn('Initial counter sync failed:', error));
      }

      if (typeof client.cleanupTemporaryChannels === 'function') {
        client.cleanupTemporaryChannels().catch((error) => logger.warn('Initial temp channel cleanup failed:', error));
      }

      const reconciliationSummary = await reconcileReactionRoleMessages(client);
      startupLog(
        `Reaction role reconciliation: scanned ${reconciliationSummary.scannedMessages}, removed ${reconciliationSummary.removedMessages}, errors ${reconciliationSummary.errors}`
      );
    } catch (error) {
      logger.error("Error in ready event:", error);
    }
  },
};


