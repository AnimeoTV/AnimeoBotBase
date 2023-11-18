import "./extends.js";
import Discord                              from "discord.js";
import { registerCommands, callCommands }   from "./utils.js";
import type { MySlashCommand }              from "./utils.js";
import InteractionManager                   from "./interaction.js";


////////////////////////////////////////////////
//  TYPES
////////////////////////////////////////////////


type DiscordBotOptions = Discord.ClientOptions & {
    proxied?    : boolean;
    commands?   : MySlashCommand[];
};


////////////////////////////////////////////////
//  BOT BASE
////////////////////////////////////////////////


/**
 *  @param  {Discord.ClientOptions} options
 *  @return {Discord.Client}
 */
export function createBot(options: DiscordBotOptions) {
    const client = new Discord.Client(options);

    client.on("ready", async () => {
        if (client.isReady()) {
            try {
                if (options.commands)
                    await registerCommands(client, options.commands);

                console.log(`${client.user.tag} is ready !`);

            } catch (err) {
                console.error(err);
                client.destroy();
            }
        }
    });

    client.on("interactionCreate", (interaction) => {
        if (interaction.isCommand())
            return callCommands(interaction);

        return InteractionManager.execute(interaction);
    });

    // Extend "voice" events list.
    client.on("voiceStateUpdate", (before, after) => {

        // Moving, Joining, Disconnecting.
        if (before.channel != after.channel) {
            if (before.channel == null)
                return void client.emit("voiceChannelJoin", after);

            if (after.channel  == null)
                return void client.emit("voiceChannelQuit", before, after);

            client.emit("voiceChannelQuit", before);
            client.emit("voiceChannelJoin", after, before);
            return;
        }

        // Mute or deaf.
        if (before.mute != after.mute || before.deaf != after.deaf)
            return void client.emit("voiceMuteOrDeaf", before, after);
    });

    return client;
}

// Export interactions
export * from "./interaction.js";
export { default as InteractionManager } from "./interaction.js";
