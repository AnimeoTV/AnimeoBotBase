import type { MySlashCommand } from "../src/utils.js";

declare module "discord.js" {

    interface Client<out Ready extends boolean = boolean> {
        __commands: Map<string, MySlashCommand>;
    }
}
