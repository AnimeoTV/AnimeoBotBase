import * as Discord     from"discord.js";
import { Collection }   from "discord.js"
import { TLRU }         from "tlru";


//////////////////////////////////////
//  GLOBAL
//////////////////////////////////////


type GlobalRoute = {
    context : InteractionFlowContextProviderBase;
    route   : InteractionFlowRoute<any>;
};

const GlobalContexts    = [] as InteractionFlowContextProviderBase[];
const GlobalRoutes      = new Collection<string, GlobalRoute>();


//////////////////////////////////////
//  TYPES
//////////////////////////////////////


export enum ReplyType {
    Embed,
    MultiEmbed,
    Modal,
};

export enum ReplyComponentType {
    Button,
    StringSelect,
};

export type InteractionComponentType = (InteractionFlowSchemaButton | InteractionFlowSchemaButtonLink | InteractionFlowSchemaStringSelect);

export interface InteractionFlowSchemaButton {
    type        : ReplyComponentType.Button;
    style?      : Exclude<Discord.ButtonStyle, InteractionFlowSchemaButtonLink["style"]>;
    emoji?      : Discord.EmojiResolvable;
    label       : string;
    next        : string;
    disabled?   : boolean;
}

export interface InteractionFlowSchemaButtonLink {
    type        : ReplyComponentType.Button;
    style       : Discord.ButtonStyle.Link;
    emoji?      : Discord.EmojiResolvable;
    label       : string;
    url         : string;
    disabled?   : boolean;
}

export interface InteractionFlowSchemaStringSelect {
    type        : ReplyComponentType.StringSelect;
    placeholder : string;
    next        : string;
    options     : Discord.SelectMenuComponentOptionData[];
}

export interface InteractionFlowSchemaEmbed {
    type        : ReplyType.Embed;
    content?    : string;
    data: {
        title       : string;
        description : string;
        color?      : number;
        thumbnail?  : string;
        image?      : string;
        footer?     : Discord.APIEmbedFooter;
        components? : InteractionComponentType[][];
    };
}

export interface InteractionFlowSchemaMultiEmbed {
    type        : ReplyType.MultiEmbed;
    content?    : string;
    embeds: {
        title       : string;
        description : string;
        color?      : number;
        thumbnail?  : string;
        image?      : string;
        footer?     : Discord.APIEmbedFooter;
    }[];
    components? : InteractionComponentType[][];
}

export interface InteractionFlowSchemaModal {
    type    : ReplyType.Modal;
    next    : string;
    data: {
        title: string;
        fields: {
            style?          : Discord.TextInputStyle,
            name            : string;
            label           : string;
            minLength?      : number;
            maxLength?      : number;
            value?          : string;
            placeholder?    : string;
            required?       : boolean;
        }[];
    };
}

export type InteractionFlowReplyOptions            = InteractionFlowSchemaEmbed | InteractionFlowSchemaMultiEmbed | InteractionFlowSchemaModal;
export type InteractionFlowNextFunction            = () => void;
export type InteractionFlowMiddlewareFunction<T>   = (context: InteractionFlowContext<T>, next: InteractionFlowNextFunction) => any;

export type InteractionFlowReplyExtraOptions = {
    new?: boolean;
};

export interface InteractionFlowContext<T> {
    readonly store          : Partial<T>;
    readonly interaction    : Discord.Interaction;
    readonly hasStore       : boolean;
    readonly isWildcard     : boolean;
    reply(schema: InteractionFlowReplyOptions, options?: InteractionFlowReplyExtraOptions): Promise<any>;
}

export interface InteractionFlowRoute<T> {
    readonly path           : string;
    readonly middlewares    : InteractionFlowMiddlewareFunction<T>[];
}

export interface InteractionFlowContextProviderBase {
    execute(interaction: Discord.Interaction, exactMatch?: boolean): Promise<void>;
};

export interface InteractionFlowContextProvider<T> extends InteractionFlowContextProviderBase {
    readonly dataStore      : TLRU<string, Partial<T> | null>;
    readonly middlewares    : InteractionFlowMiddlewareFunction<T>[];
    readonly routes         : InteractionFlowRoute<T>[];
    defaultMiddlewareRequireStore(context: InteractionFlowContext<T>, next: InteractionFlowNextFunction): any;
    addMiddleware(middleware: InteractionFlowMiddlewareFunction<T>): this;
    addRoute(path: string, middlewares: InteractionFlowMiddlewareFunction<T> | InteractionFlowMiddlewareFunction<T>[]): this;
};


//////////////////////////////////////
//  MANAGER
//////////////////////////////////////


function getInteractionParams<T>(
    interaction : Exclude<Discord.Interaction, Discord.AutocompleteInteraction>,
    store       : TLRU<string, Partial<T> | null>,
): { id: string, store: Partial<T> | null } {

    // Special case for commands.
    if (interaction.isCommand())
        return { id: interaction.commandName, store: null };

    // The format should be "command;store_id".
    const args = interaction.customId.split(";");

    const pickStore = (key: string): Partial<T> | null => {
        const value = store.get(key);

        // @TODO: What can we do here to prevent replay ?
        // We can't delete the key from the store for modal components,
        // it will break the session if the user cancel the modal.
        // if (value)
        //     store.delete(key);

        return value || null;
    };

    return {
        id      : args[0] as string,
        store   : args[1]
            ? pickStore(args[1])
            : null,
    };
}

function createMiddlewareChain<T>(context: InteractionFlowContext<T>, middlewares: InteractionFlowMiddlewareFunction<T>[], next?: () => void) {
    let idx = 0;

    return function __next(): void {
        const middleware = middlewares[idx++];

        middleware
            ? middleware(context, __next)
            : next?.();
    };
}

function getNextValue(next: string, suffix?: string): string {
    return suffix
        ? next + ";" + suffix
        : next;
}

function buildEmbed(schema: InteractionFlowSchemaEmbed | InteractionFlowSchemaMultiEmbed, suffix?: string): Discord.BaseMessageOptions {
    function buildSingleEmbed(schema: InteractionFlowSchemaEmbed["data"]) {
        return {
            color       : schema.color,
            title       : schema.title,
            description : schema.description,
            footer      : schema.footer,

            thumbnail: schema.thumbnail
                ? { url: schema.thumbnail }
                : undefined,

            image: schema.image
                ? { url: schema.image }
                : undefined,
        };
    }

    function buildSingleComponentRow(schema: InteractionComponentType[]): Discord.APIActionRowComponent<Discord.APIMessageActionRowComponent> {
        return {
            type        : Discord.ComponentType.ActionRow,
            components  : schema.map((component) => {
                if (component.type === ReplyComponentType.Button) {
                    if (component.style === Discord.ButtonStyle.Link) {
                        return <Discord.APIButtonComponentWithURL>({
                            type        : Discord.ComponentType.Button,
                            style       : component.style,
                            emoji       : component.emoji,
                            label       : component.label,
                            url         : component.url,
                            disabled    : component.disabled,
                        });

                    } else {
                        return <Discord.APIButtonComponentWithCustomId>({
                            type        : Discord.ComponentType.Button,
                            style       : component.style,
                            emoji       : component.emoji,
                            label       : component.label,
                            custom_id   : getNextValue(component.next, suffix),
                            disabled    : component.disabled,
                        });
                    }

                } else {
                    return <Discord.APIStringSelectComponent>({
                        type        : Discord.ComponentType.StringSelect,
                        placeholder : component.placeholder,
                        custom_id   : getNextValue(component.next, suffix),
                        options     : component.options,
                    });
                }
            }),
        };
    }

    if (schema.type === ReplyType.MultiEmbed) {
        return {
            content     : schema.content,
            embeds      : schema.embeds.map(buildSingleEmbed),
            components  : (schema.components || []).map(buildSingleComponentRow),
        };

    } else {
        return {
            content     : schema.content,
            embeds      : [ buildSingleEmbed(schema.data) ],
            components  : (schema.data.components || []).map(buildSingleComponentRow),
        };
    }
}

function createInteractionContext<T>(): InteractionFlowContextProvider<T> {
    const context: InteractionFlowContextProvider<T> = {
        dataStore: new TLRU({
            maxStoreSize    : 1_000,
            maxAgeMs        : 15 * 60_000,
        }),
        middlewares : [],
        routes      : [],

        addMiddleware(middleware) {
            return (
                this.middlewares.push(middleware),
                this
            );
        },

        addRoute(path, middlewares) {
            if (path === "*")
                this.middlewares.push(this.defaultMiddlewareRequireStore);

            return (
                this.routes.push({
                    path,
                    middlewares: Array.isArray(middlewares)
                        ? middlewares
                        : [ middlewares ],
                }),
                this
            );
        },

        async defaultMiddlewareRequireStore({ interaction, hasStore, isWildcard }, next) {
            if (!interaction.isRepliable())
                return;

            if (!isWildcard && !hasStore) {
                const message: Discord.BaseMessageOptions = {
                    embeds: [
                        {
                            title       : "❌  Session expirée",
                            description : "Cette interaction a expirée, réessaie.",
                            color       : Discord.Colors.DarkButNotBlack,
                        },
                    ],
                    components: [],
                };

                return ((interaction.isMessageComponent() || (interaction.isModalSubmit() && interaction.isFromMessage())) && interaction.message.flags.has("Ephemeral"))
                    ? void await interaction.update(message)
                    : void await interaction.reply({ ...message, ephemeral: true });
            }

            next();
        },

        async execute(interaction: Discord.Interaction, exactMatch?: boolean) {
            if (!interaction.isRepliable())
                return;

            const getRoute = (): InteractionFlowRoute<T> | undefined => {
                if (interaction.isStringSelectMenu()) {
                    // @ts-ignore
                    const route = null
                        || this.routes.find((route) => (route.path === params.id + ":" + interaction.values.join(":")))
                        || this.routes.find((route) => (route.path === params.id + ":*"));

                    if (route)
                        return route;
                }

                return this.routes.find((route) => (route.path === params.id))
                    || (exactMatch ? undefined : this.routes[0]);
            }

            const params    = getInteractionParams(interaction, this.dataStore);
            const route     = getRoute();

            if (route) {
                const saveStore = (): string => {
                    const id = Date.now().toString();

                    // Save store.
                    this.dataStore.set(id, context.store);

                    return id;
                };

                const reply = async (schema: InteractionFlowReplyOptions, options: InteractionFlowReplyExtraOptions = {}): Promise<any> => {
                    switch (schema.type) {
                        case ReplyType.Modal: {
                            if (interaction.isCommand() || interaction.isMessageComponent()) {
                                return interaction.showModal({
                                    title       : schema.data.title,
                                    custom_id   : schema.next + ";" + saveStore(),
                                    components  : schema.data.fields.map((field) => <Discord.APIActionRowComponent<Discord.APIModalActionRowComponent>>({
                                        type: Discord.ComponentType.ActionRow,
                                        components: [
                                            {
                                                type        : Discord.ComponentType.TextInput,
                                                style       : field.style,
                                                custom_id   : field.name,
                                                label       : field.label,
                                                value       : field.value,
                                                placeholder : field.placeholder,
                                                min_length  : field.minLength,
                                                max_length  : field.maxLength,
                                                required    : field.required,
                                            },
                                        ],
                                    })),
                                });

                            } else {
                                throw new Error("You can't show a modal on this type of interaction.");
                            }
                        }

                        case ReplyType.MultiEmbed:
                        case ReplyType.Embed: {
                            const message: Discord.BaseMessageOptions = buildEmbed(schema, saveStore());

                            // Force a new message to be sent if the interaction comes from a message.
                            if (options.new && interaction.isMessageComponent()) {
                                if (interaction.deferred || interaction.replied) {
                                    return interaction.followUp({
                                        ...message,
                                        ephemeral: true,
                                    });

                                } else {
                                    return interaction.reply({
                                        ...message,
                                        ephemeral: true,
                                    });
                                }
                            }

                            if (interaction.isMessageComponent() || (interaction.isModalSubmit() && interaction.isFromMessage())) {
                                if (interaction.deferred || interaction.replied) {
                                    return interaction.editReply(message);

                                } else {
                                    return interaction.update(message);
                                }

                            } else {
                                if (interaction.deferred || interaction.replied) {
                                    return interaction.editReply(message);

                                } else {
                                    return interaction.reply({
                                        ...message,
                                        ephemeral: true,
                                    });
                                }
                            }
                        }
                    }
                };

                // Execute middlewares and route.

                const context: InteractionFlowContext<T> = {
                    interaction,
                    store       : params.store || {},
                    hasStore    : params.store ? true : false,
                    isWildcard  : route === this.routes[0],
                    reply,
                };

                createMiddlewareChain(context, this.middlewares, () => {
                    createMiddlewareChain(context, route.middlewares)();
                })();
            }
        },
    };

    GlobalContexts.push(context);

    return context;
}


//////////////////////////////////////
//  UTILS
//////////////////////////////////////


function createMiddleware<T>(cb: InteractionFlowMiddlewareFunction<T>): InteractionFlowMiddlewareFunction<T> {
    return cb;
}

function execute(interaction: Discord.Interaction): Discord.Awaitable<void> {
    for (const contexts of GlobalContexts)
        contexts.execute(interaction, true);
}


//////////////////////////////////////
//  EXPORTS
//////////////////////////////////////


export default {
    buildEmbed,
    createMiddleware,
    createMiddlewareChain,
    createInteractionContext,
    execute,
};
