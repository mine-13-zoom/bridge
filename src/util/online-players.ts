import { EmbedBuilder } from 'discord.js';

export interface OnlinePlayersData {
    players: { [rank: string]: string[] };
    onlineCount: number;
    totalCount: number;
}

export class OnlinePlayersTracker {
    private isUpdating = false;
    private lastUpdate: OnlinePlayersData = {
        players: {},
        onlineCount: 0,
        totalCount: 0,
    };

    private readonly regex = {
        bound: /-----------------------------------------------------/,
        guildRank: /-- (.+) --/,
        playerOnlineStatus: /([^ ]+) ●/g,
        onlineMembers: /Online Members: (\d+)/g,
    };

    async updateOnlinePlayers(mineflayerBot: any): Promise<OnlinePlayersData> {
        if (this.isUpdating) {
            return this.lastUpdate;
        }

        this.isUpdating = true;

        return new Promise((resolve) => {
            let boundReceived = 0;
            let currentGuildRank: string | null = null;
            let playerCount: string | undefined;
            const players: { [name: string]: Array<string> } = {};

            const listener = (message: string) => {
                if (this.regex.bound.test(message)) {
                    boundReceived++;
                }

                if (boundReceived === 0) {
                    return;
                }

                if (playerCount === undefined || playerCount === null) {
                    playerCount = this.regex.onlineMembers.exec(message)?.at(1);
                }

                const newGuildRank = this.regex.guildRank.exec(message)?.at(1);
                if (newGuildRank) {
                    currentGuildRank = newGuildRank;
                    return;
                }

                if (boundReceived > 0 && currentGuildRank) {
                    const usernameMatches = message.matchAll(this.regex.playerOnlineStatus);
                    for (const usernameMatch of usernameMatches) {
                        const username = usernameMatch.at(1);
                        if (username) {
                            players[currentGuildRank] ??= [];
                            players[currentGuildRank]?.push(username);
                        }
                    }
                }

                if (boundReceived >= 2) {
                    mineflayerBot.removeListener('messagestr', listener);

                    const onlineCount = parseInt(playerCount || '0');
                    this.lastUpdate = {
                        players,
                        onlineCount,
                        totalCount: 0, // Will be set by the bot
                    };

                    this.isUpdating = false;
                    resolve(this.lastUpdate);
                }
            };

            mineflayerBot.on('messagestr', listener);
            mineflayerBot.chat('/g online');

            // Timeout after 5 seconds
            setTimeout(() => {
                mineflayerBot.removeListener('messagestr', listener);
                this.isUpdating = false;
                resolve(this.lastUpdate);
            }, 5000);
        });
    }

    createEmbed(data: OnlinePlayersData): EmbedBuilder {
        const embed = new EmbedBuilder()
            .setColor('Green')
            .setTitle(`Online Players [${data.onlineCount}/${data.totalCount}]`)
            .setTimestamp();

        if (Object.keys(data.players).length === 0) {
            embed.addFields({
                name: 'No players online',
                value: 'There are currently no guild members online.',
            });
        } else {
            Object.entries(data.players).forEach(([guildRank, usernames]) => {
                embed.addFields({
                    name: guildRank,
                    value:
                        usernames.length > 0
                            ? `\`${usernames.join(' ')}\``
                            : 'No players in this rank',
                });
            });
        }

        return embed;
    }

    getLastUpdate(): OnlinePlayersData {
        return this.lastUpdate;
    }
}
