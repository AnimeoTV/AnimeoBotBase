import Discord, { Collection }  from "discord.js"
import { TLRU }                 from "tlru";


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
            placeholder?    : string;
            required?       : boolean;
        }[];
    };
}

export type InteractionFlowReplyOptions            = InteractionFlowSchemaEmbed | InteractionFlowSchemaModal;
export type InteractionFlowNextFunction            = () => void;
export type InteractionFlowMiddlewareFunction<T>   = (context: InteractionFlowContext<T>, next: InteractionFlowNextFunction) => any;

export interface InteractionFlowContext<T> {
    readonly store          : Partial<T>;
    readonly interaction    : Discord.Interaction;
    readonly hasStore       : boolean;
    readonly isWildcard     : boolean;
    reply(schema: InteractionFlowReplyOptions): Promise<any>;
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

        if (value)
            store.delete(key);

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

function buildEmbed(schema: InteractionFlowSchemaEmbed, suffix?: string): Discord.BaseMessageOptions {
    return {
        content: schema.content,
        embeds: [
            {
                color       : schema.data.color,
                title       : schema.data.title,
                description : schema.data.description,
                footer      : schema.data.footer,

                thumbnail: schema.data.thumbnail
                    ? { url: schema.data.thumbnail }
                    : undefined,

                image: schema.data.image
                    ? { url: schema.data.image }
                    : undefined,
            },
        ],
        components: (schema.data.components || []).map((components) => {
            return <Discord.APIActionRowComponent<Discord.APIMessageActionRowComponent>>{
                type        : Discord.ComponentType.ActionRow,
                components  : components.map((component) => {
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
        }),
    };
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

                const reply = async (schema: InteractionFlowReplyOptions): Promise<any> => {
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
                                                placeholder : field.placeholder,
                                                required    : field.required,
                                            },
                                        ],
                                    })),
                                });

                            } else {
                                throw new Error("You can't show a modal on this type of interaction.");
                            }
                        }

                        case ReplyType.Embed: {
                            const message: Discord.BaseMessageOptions = buildEmbed(schema, saveStore());

                            return (interaction.isMessageComponent() || (interaction.isModalSubmit() && interaction.isFromMessage()))
                                ? interaction.update(message)
                                : interaction.reply({
                                    ...message,
                                    ephemeral: true,
                                });
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