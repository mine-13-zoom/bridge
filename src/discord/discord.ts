import {
    Client,
    Collection,
    ColorResolvable,
    EmbedBuilder,
    TextChannel,
    Message,
} from 'discord.js';
import recursiveWalkDir from '@util/recursive-walk-dir';
import winston from 'winston';
import path from 'path';
import loadEvents from '@util/load-events';
import Bridge from '../bridge';
import { OnlinePlayersTracker } from '@util/online-players';
import env from '@util/env';

export default class Discord extends Client {
    public readonly commands: Collection<string, Command> = new Collection();
    public memberChannel?: TextChannel;
    public officerChannel?: TextChannel;
    public onlinePlayersChannel?: TextChannel;
    private onlinePlayersTracker = new OnlinePlayersTracker();
    private onlinePlayersMessage?: Message;
    private onlinePlayersInterval?: NodeJS.Timeout;

    public async send(
        channel: 'gc' | 'oc',
        content: string,
        color: ColorResolvable = 0x36393f,
        pad = false,
    ) {
        const embed = new EmbedBuilder()
            .setDescription(pad ? `${'-'.repeat(54)}\n${content}\n${'-'.repeat(54)}` : content)
            .setColor(color);

        if (channel === 'gc') {
            await this.memberChannel?.send({ embeds: [embed] });
        } else {
            await this.officerChannel?.send({ embeds: [embed] });
        }
    }

    public async loadCommands() {
        const callback = async (currentDir: string, file: string) => {
            if (!(file.endsWith('.ts') || file.endsWith('.js')) || file.endsWith('.d.ts')) return;

            const command = (await import(path.join(currentDir, file))).default as Command;

            if (!command.data) {
                winston.warn(`The command ${path.join(currentDir, file)} doesn't have a name!`);
                return;
            }

            if (!command.run) {
                winston.warn(
                    `The command ${command.data.name} doesn't have an executable function!`,
                );
                return;
            }

            this.commands.set(command.data.name, command);
        };

        await recursiveWalkDir(
            path.join(__dirname, 'commands/'),
            callback,
            'Error while loading commands:',
        );
    }

    public async loadEvents(bridge: Bridge) {
        await loadEvents(path.join(__dirname, 'events/'), this, bridge);
    }

    public async startOnlinePlayersUpdater(bridge: Bridge) {
        if (!env.ONLINE_PLAYERS_CHANNEL_ID) {
            winston.info('ONLINE_PLAYERS_CHANNEL_ID not set, skipping online players auto-updater');
            return;
        }

        this.onlinePlayersChannel = (await this.channels.fetch(
            env.ONLINE_PLAYERS_CHANNEL_ID,
        )) as TextChannel;

        if (!this.onlinePlayersChannel) {
            winston.error(
                `Could not find online players channel with ID ${env.ONLINE_PLAYERS_CHANNEL_ID}`,
            );
            return;
        }

        // Send initial message
        await this.updateOnlinePlayersMessage(bridge);

        // Update every minute
        this.onlinePlayersInterval = setInterval(async () => {
            await this.updateOnlinePlayersMessage(bridge);
        }, 60000);
    }

    private async updateOnlinePlayersMessage(bridge: Bridge) {
        try {
            const data = await this.onlinePlayersTracker.updateOnlinePlayers(
                bridge.mineflayer.botInstance,
            );
            data.totalCount = bridge.totalCount;

            const embed = this.onlinePlayersTracker.createEmbed(data);

            if (this.onlinePlayersMessage) {
                await this.onlinePlayersMessage.edit({ embeds: [embed] });
            } else {
                const messages = await this.onlinePlayersChannel!.messages.fetch({ limit: 1 });
                const botMessage = messages.find((m) => m.author.id === this.user!.id);

                if (botMessage) {
                    this.onlinePlayersMessage = botMessage;
                    await botMessage.edit({ embeds: [embed] });
                } else {
                    this.onlinePlayersMessage = await this.onlinePlayersChannel!.send({
                        embeds: [embed],
                    });
                }
            }
        } catch (error) {
            winston.error('Error updating online players message:', error);
        }
    }

    public stopOnlinePlayersUpdater() {
        if (this.onlinePlayersInterval) {
            clearInterval(this.onlinePlayersInterval);
            this.onlinePlayersInterval = undefined;
        }
    }
}
