import Discord from "discord.js";


////////////////////////////////////////////////
//  UTILS
////////////////////////////////////////////////


export type MySlashCommand = {
    definition: Discord.RESTPostAPIApplicationCommandsJSONBody | Discord.RESTPostAPIApplicationCommandsJSONBody[];
    onInteraction(interaction: Discord.CommandInteraction): Discord.Awaitable<any>;
    onSetup?(client: Discord.Client<true>): Discord.Awaitable<any>;
};

export type MySlashCommandSyncResult = {
    currentCommandCount     : number;
    newCommandCount         : number;
    deletedCommandCount     : number;
    updatedCommandCount     : number;
};


////////////////////////////////////////////////
//  SYNC
////////////////////////////////////////////////


export function registerCommands(client: Discord.Client<true>, commands: MySlashCommand[]): Promise<MySlashCommandSyncResult> {
    const __commands      : Map<string, MySlashCommand>     = new Map<string, MySlashCommand>;
    const __definitions   : MySlashCommand["definition"][]  = [];

    // Sort commands.
    for (const command of commands) {

        // Setup commands.
        command.onSetup?.(client);

        // Push command and definition.
        if (Array.isArray(command.definition)) {
            for (const definition of command.definition) {
                __commands.set(definition.name, command);
                __definitions.push(definition);
            }

        } else {
            __commands.set(command.definition.name, command);
            __definitions.push(command.definition);
        }
    }

    // Assign commands.
    client.__commands = __commands;

    // Sync commands.
    return syncCommands(client, __definitions);
}

export function callCommands(interaction: Discord.CommandInteraction): Discord.Awaitable<any> {
    return interaction.client.__commands.get(interaction.commandName)?.onInteraction(interaction);
}

export async function syncCommands(client: Discord.Client<true>, commands: any[], guildId?: string): Promise<MySlashCommandSyncResult> {
    const currentCommands   = await client.application.commands.fetch({ guildId });
    const newCommands       = commands.filter((command) => !currentCommands.some((c) => c.name === command.name));
    const deletedCommands   = currentCommands.filter((command) => !commands.some((c) => c.name === command.name)).toJSON();
    const updatedCommands   = commands.filter((command) => currentCommands.some((c) => c.name === command.name));
    let updatedCommandCount = 0;

    for (const newCommand of newCommands)
        await client.application.commands.create(newCommand, guildId);

    for (const deletedCommand of deletedCommands)
        await deletedCommand.delete();

    for (const updatedCommand of updatedCommands) {
        const newCommand = updatedCommand;
        const previousCommand = currentCommands.find((c) => c.name === updatedCommand.name);

        if (previousCommand) {
            let modified = false;
            if (previousCommand.description !== newCommand.description) modified = true;
            if (!Discord.ApplicationCommand.optionsEqual(previousCommand.options ?? [], newCommand.options ?? [])) modified = true;
            if (modified) {
                await previousCommand.edit(newCommand);
                updatedCommandCount++;
            }
        }
    }

    return {
        currentCommandCount     : currentCommands.size,
        newCommandCount         : newCommands.length,
        deletedCommandCount     : deletedCommands.length,
        updatedCommandCount,
    };
}
