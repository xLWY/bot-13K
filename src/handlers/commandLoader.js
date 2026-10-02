import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Collection } from 'discord.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Commandes autorisees en message prive (slash + prefixe).
const DM_ENABLED_COMMANDS = new Set(['ping', 'diag', 'logtest', 'help', 'avatar']);





function getSubcommandInfo(commandData) {
    const subcommands = [];
    
    if (commandData.options) {
        for (const option of commandData.options) {
if (option.type === 1) {
                subcommands.push(option.name);
} else if (option.type === 2) {
                if (option.options) {
                    for (const subOption of option.options) {
if (subOption.type === 1) {
                            subcommands.push(`${option.name}/${subOption.name}`);
                        }
                    }
                }
            }
        }
    }
    
    return subcommands;
}







async function getAllFiles(directory, fileList = []) {
    const files = await fs.readdir(directory, { withFileTypes: true });
    
    for (const file of files) {
        const filePath = path.join(directory, file.name);
        
        if (file.isDirectory()) {
            if (file.name === 'modules') {
                continue;
            }
            await getAllFiles(filePath, fileList);
        } else if (file.name.endsWith('.js')) {
            fileList.push(filePath);
        }
    }
    
    return fileList;
}






export async function loadCommands(client) {
    client.commands = new Collection();
    const commandsPath = path.join(__dirname, '../commands');
    const commandFiles = await getAllFiles(commandsPath);
    
    logger.info(`Found ${commandFiles.length} command files to load`);
    
    const uniqueCommandNames = new Set();
    
    for (const filePath of commandFiles) {
        try {
            const normalizedPath = filePath.replace(/\\/g, '/');
            
            const commandName = path.basename(filePath, '.js');
            const commandDir = path.dirname(filePath);
            const category = path.basename(commandDir);
            
            const commandModule = await import(`file://${filePath}`);
            const command = commandModule.default || commandModule;
            
            if (!command.data || !command.execute) {
                logger.warn(`Command at ${filePath} is missing required "data" or "execute" property.`);
                continue;
            }
            
            command.category = category;
            command.filePath = normalizedPath;
            
            const primaryCommandName = command.data.name;
            
            if (!uniqueCommandNames.has(primaryCommandName)) {
                uniqueCommandNames.add(primaryCommandName);
                
                client.commands.set(primaryCommandName, command);
            }
            
            const subcommands = getSubcommandInfo(command.data.toJSON());
            
            logger.info(`Loaded command: ${primaryCommandName} from ${normalizedPath} (category: ${category})`);
            
            if (subcommands.length > 0) {
                logger.info(`  - Subcommands: ${subcommands.join(', ')}`);
            }
            
        } catch (error) {
            logger.error(`Error loading command from ${filePath}:`, error);
        }
    }
    
    const commandsWithSubcommands = Array.from(client.commands.values()).filter(cmd => {
        const subcommands = getSubcommandInfo(cmd.data.toJSON());
        return subcommands.length > 0;
    });
    
    const totalSubcommands = commandsWithSubcommands.reduce((total, cmd) => {
        return total + getSubcommandInfo(cmd.data.toJSON()).length;
    }, 0);
    
    const uniqueCommands = new Set();
    for (const [name, command] of client.commands.entries()) {
        if (command.data && command.data.name) {
            uniqueCommands.add(command.data.name);
        }
    }
    
    logger.info(`Loaded ${uniqueCommands.size} commands`);
    return client.commands;
}







const GLOBAL_DESC_LIMIT = 100;
const GLOBAL_NAME_LIMIT = 32;
const REGISTRATION_TIMEOUT_MS = 30000;

function withTimeout(promise, label, ms = REGISTRATION_TIMEOUT_MS) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))
    ]);
}

function validateForGlobal(commandJson, seenNames) {
    const name = commandJson.name;
    const errors = [];

    if (!name) errors.push('missing name');
    if (name && !/^[-_\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u.test(name)) {
        errors.push(`invalid name "${name}"`);
    }
    if (name && seenNames.has(name)) errors.push(`duplicate name "${name}"`);
    if (name) seenNames.add(name);

    if (!commandJson.description) errors.push('missing description');
    if (commandJson.description && commandJson.description.length > GLOBAL_DESC_LIMIT) {
        errors.push(`description ${commandJson.description.length}/${GLOBAL_DESC_LIMIT} chars`);
    }

    for (const option of commandJson.options || []) {
        if (option.name && option.name.length > GLOBAL_NAME_LIMIT) {
            errors.push(`option "${option.name}" name too long (${option.name.length})`);
        }
        if (!option.description) errors.push(`option "${option.name}" missing description`);
        if (option.description && option.description.length > GLOBAL_DESC_LIMIT) {
            errors.push(`option "${option.name}" description ${option.description.length}/${GLOBAL_DESC_LIMIT} chars`);
        }
        for (const sub of option.options || []) {
            if (sub.name && sub.name.length > GLOBAL_NAME_LIMIT) {
                errors.push(`sub-option "${option.name}/${sub.name}" name too long (${sub.name.length})`);
            }
            if (!sub.description) errors.push(`sub-option "${option.name}/${sub.name}" missing description`);
            if (sub.description && sub.description.length > GLOBAL_DESC_LIMIT) {
                errors.push(`sub-option "${option.name}/${sub.name}" description ${sub.description.length}/${GLOBAL_DESC_LIMIT} chars`);
            }
        }
    }

    return errors;
}

async function registerGlobalCommands(client, commands) {
    try {
        await withTimeout(client.application.commands.set(commands), 'Global registration');
        logger.info(`Successfully registered ${commands.length} global commands (usable in DM)`);
        return { registered: commands.length, failed: [] };
    } catch (error) {
        logger.error('Bulk global registration rejected by Discord:', error.message);
        if (error.message.includes('timed out')) {
            logger.error('Global bulk registration timed out - skipping to keep the bot responsive.');
            return { registered: 0, failed: [{ name: '*', error: error.message }] };
        }

        if (process.env.NODE_ENV === 'production') {
            logger.error('Production: skipping per-command fallback to avoid a rate-limit storm.');
            return { registered: 0, failed: [{ name: '*', error: error.message }] };
        }

        logger.error('Falling back to one-by-one registration to identify the offending command(s)...');

        const accepted = [];
        const failed = [];

        for (const commandJson of commands) {
            const candidate = [...accepted, commandJson];
            try {
                await client.application.commands.set(candidate);
                accepted.push(commandJson);
            } catch (perCommandError) {
                failed.push({ name: commandJson.name, error: perCommandError.message });
                logger.error(`  REJECTED "${commandJson.name}": ${perCommandError.message}`);
            }
        }

        try {
            await client.application.commands.set(accepted);
            logger.info(`Global registration finished: ${accepted.length} accepted, ${failed.length} rejected`);
        } catch (finalError) {
            logger.error('Final global registration failed:', finalError.message);
        }

        return { registered: accepted.length, failed };
    }
}

export async function registerCommands(client, guildId) {
    try {
        const commands = [];
        let totalSubcommands = 0;
const registeredNames = new Set();
        
        for (const command of client.commands.values()) {
            if (command.hiddenFromSlash) {
                logger.debug(`Skipping slash registration for hidden command: ${command.data.name}`);
                continue;
            }
            if (command.data && typeof command.data.toJSON === 'function') {
                const commandName = command.data.name;
                
                logger.debug(`Processing command for registration: ${commandName}`);
                
                if (!registeredNames.has(commandName)) {
                    registeredNames.add(commandName);
                    const commandJson = command.data.toJSON();
                    if (DM_ENABLED_COMMANDS.has(commandName)) {
                        commandJson.dm_permission = true;
                    }

                    commands.push(commandJson);
                    
                    const subcommands = getSubcommandInfo(commandJson);
                    totalSubcommands += subcommands.length;
                    
                    if (process.env.NODE_ENV !== 'production') {
                        logger.debug(`Registering command: ${commandName}`);
                    }
                } else {
                    logger.debug(`Skipping duplicate command: ${commandName}`);
                }
            } else {
                logger.warn(`Command missing data or toJSON method: ${command}`);
            }
        }
        
        const totalCommandsWithSubs = commands.length + totalSubcommands;

        const seenNames = new Set();
        const validCommands = [];
        const rejected = [];

        for (const commandJson of commands) {
            const errors = validateForGlobal(commandJson, seenNames);
            if (errors.length > 0) {
                rejected.push({ name: commandJson.name, errors });
                logger.error(`Command "${commandJson.name}" is NOT valid for global registration: ${errors.join('; ')}`);
            } else {
                validCommands.push(commandJson);
            }
        }

        if (rejected.length > 0) {
            logger.error(`${rejected.length} command(s) rejected locally and excluded from registration`);
        }

        const globalResult = await registerGlobalCommands(client, validCommands);

        if (globalResult.failed.length > 0) {
            logger.error('Commands Discord refused despite passing local validation:');
            for (const item of globalResult.failed) {
                logger.error(`  - ${item.name}: ${item.error}`);
            }
        }

        if (guildId) {
            
            logger.info(`Preparing to register ${totalCommandsWithSubs} commands for guild ${guildId}`);
            
            logger.info('Validating commands before registration...');
            
            let validationErrors = [];
            commands.forEach((cmd, index) => {
                if (cmd.name && cmd.name.length > 32) {
                    validationErrors.push(`Command ${cmd.name} has name longer than 32 chars: "${cmd.name}" (${cmd.name.length} chars)`);
                }
                if (cmd.description && cmd.description.length > 110) {
                    validationErrors.push(`Command ${cmd.name} has description longer than 110 chars: "${cmd.description}" (${cmd.description.length} chars)`);
                }
                
                if (cmd.options) {
                    cmd.options.forEach((option, optIndex) => {
                        if (option.name && option.name.length > 32) {
                            validationErrors.push(`Command ${cmd.name} option ${option.name} has name longer than 32 chars: "${option.name}" (${option.name.length} chars)`);
                        }
                        if (option.description && option.description.length > 110) {
                            validationErrors.push(`Command ${cmd.name} option ${option.name} has description longer than 110 chars: "${option.description}" (${option.description.length} chars)`);
                        }
                        
                        if (option.choices) {
                            option.choices.forEach((choice, choiceIndex) => {
                                if (choice.name && choice.name.length > 110) {
                                    validationErrors.push(`Command ${cmd.name} option ${option.name} choice ${choice.name} has name longer than 110 chars: "${choice.name}" (${choice.name.length} chars)`);
                                }
                                if (choice.value && choice.value.length > 100) {
                                    validationErrors.push(`Command ${cmd.name} option ${option.name} choice ${choice.name} has value longer than 100 chars: "${choice.value}" (${choice.value.length} chars)`);
                                }
                            });
                        }
                        
                        if (option.options) {
                            option.options.forEach((subOption, subOptIndex) => {
                                if (subOption.name && subOption.name.length > 32) {
                                    validationErrors.push(`Command ${cmd.name} subcommand ${option.name} option ${subOption.name} has name longer than 32 chars: "${subOption.name}" (${subOption.name.length} chars)`);
                                }
                                if (subOption.description && subOption.description.length > 110) {
                                    validationErrors.push(`Command ${cmd.name} subcommand ${option.name} option ${subOption.name} has description longer than 110 chars: "${subOption.description}" (${subOption.description.length} chars)`);
                                }
                                
                                if (subOption.choices) {
                                    subOption.choices.forEach((choice, choiceIndex) => {
                                        if (choice.name && choice.name.length > 110) {
                                            validationErrors.push(`Command ${cmd.name} subcommand ${option.name} option ${subOption.name} choice ${choice.name} has name longer than 110 chars: "${choice.name}" (${choice.name.length} chars)`);
                                        }
                                        if (choice.value && choice.value.length > 100) {
                                            validationErrors.push(`Command ${cmd.name} subcommand ${option.name} option ${subOption.name} choice ${choice.name} has value longer than 100 chars: "${choice.value}" (${choice.value.length} chars)`);
                                        }
                                    });
                                }
                            });
                        }
                    });
                }
            });
            
            if (validationErrors.length > 0) {
                logger.error('Command validation failed. Errors:');
                validationErrors.forEach(error => logger.error(`  - ${error}`));
                throw new Error(`Command validation failed with ${validationErrors.length} errors`);
            }
            
            logger.info('Command validation passed');
            
            const guild = await client.guilds.fetch(guildId);
            
            const existingCommands = await withTimeout(guild.commands.fetch(), 'Guild command fetch');
            logger.info(`Found ${existingCommands.size} existing guild commands`);
            
            const MAX_COMMANDS = 100;
            let commandsToRegister = commands;

            if (commands.length > MAX_COMMANDS) {
                logger.warn(`Command count (${commands.length}) exceeds Discord limit (${MAX_COMMANDS}), truncating...`);
                commandsToRegister = commands.slice(0, MAX_COMMANDS);
                logger.info(`Truncated to ${commandsToRegister.length} commands for registration`);
            }

            try {
                logger.info(`Registering ${commandsToRegister.length} guild commands...`);
                await withTimeout(guild.commands.set(commandsToRegister), 'Guild registration');
                logger.info(`Successfully registered ${commandsToRegister.length} guild commands`);

                const registeredCommands = await withTimeout(guild.commands.fetch(), 'Guild command verification');
                if (registeredCommands.size !== commandsToRegister.length) {
                    logger.warn(`Warning: Expected ${commandsToRegister.length} commands, but Discord reports ${registeredCommands.size} registered`);
                } else {
                    logger.info(`Verification passed: ${registeredCommands.size} commands successfully registered`);
                }
                
            } catch (error) {
                logger.error('Failed to register commands:', error);
                
                if (existingCommands.size > 0) {
                    logger.info('Attempting to restore previous commands due to registration failure...');
                    try {
                        await guild.commands.set(existingCommands.map(cmd => cmd));
                        logger.info('Successfully restored previous commands');
                    } catch (restoreError) {
                        logger.error('Failed to restore previous commands:', restoreError);
                    }
                }
                
                throw error;
            }
        } else {
            logger.info('No guildId configured: only global commands are registered');
        }
    } catch (error) {
        logger.error('Error registering commands:', error);
        throw error;
    }
}







export async function reloadCommand(client, commandName) {
    const command = client.commands.get(commandName);
    
    if (!command) {
        return { success: false, message: `Command "${commandName}" not found` };
    }
    
    try {
        const commandPath = path.resolve(command.filePath);
        const moduleUrl = pathToFileURL(commandPath);
        moduleUrl.searchParams.set('t', Date.now().toString());

        const newCommand = (await import(moduleUrl.href)).default;
        
        client.commands.set(commandName, newCommand);
        
        logger.info(`Reloaded command: ${commandName}`);
        return { success: true, message: `Successfully reloaded command "${commandName}"` };
    } catch (error) {
        logger.error(`Error reloading command "${commandName}":`, error);
        return { success: false, message: `Error reloading command: ${error.message}` };
    }
}


