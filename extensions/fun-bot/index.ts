/**
 * Fun Bot Extension
 * 
 * A playful extension that responds to various messages with funny and entertaining replies.
 * Includes responses to pings, greetings, mentions, and other fun interactions.
 * 
 * Configuration Options:
 * - enabled: Enable/disable the extension (default: true)
 * - greetingResponseChance: Chance to respond to greetings (default: 0.3)
 * - guildRankCooldowns: Guild rank-based cooldown mappings in seconds
 *   - Guild Master: 0s (no cooldown)
 *   - Leader: 5s
 *   - Moderator: 10s
 *   - Member: 30s
 * 
 * @author MiscGuild Bridge Bot Team
 * @version 1.0.0
 */

interface ChatMessageContext {
    message: string;
    username: string;
    channel?: 'Guild' | 'Officer' | 'From' | 'Party' | string;
    rank?: string;
    guildRank?: string;
    timestamp: Date;
    raw: string;
    matches?: RegExpMatchArray;
}

interface ExtensionAPI {
    log: any;
    events: any;
    config: any;
    chat: {
        sendGuildChat: (message: string) => void;
        sendPrivateMessage: (username: string, message: string) => void;
        sendPartyMessage: (message: string) => void;
    };
    discord: {
        sendMessage: (channelId: string, content: any) => Promise<any>;
        sendEmbed: (channelId: string, embed: any) => Promise<any>;
    };
    utils: Record<string, any>;
}

interface ChatPattern {
    id: string;
    extensionId: string;
    pattern: RegExp;
    priority: number;
    description?: string;
    handler: (context: ChatMessageContext, api: ExtensionAPI) => Promise<void> | void;
}

class FunBotExtension {
    readonly manifest = {
        id: 'fun-bot',
        name: 'Fun Bot',
        version: '1.0.0',
        description: 'A playful extension with entertaining responses to various messages',
        author: 'MiscGuild Bridge Bot Team'
    };

    private config: any = {};
    private lastPingTime: number = 0;
    private pingCount: number = 0;
    private recentResponses: Map<string, number> = new Map();
    
    // Cooldown tracking
    private cooldowns: Map<string, number> = new Map();
    private cleanupInterval: NodeJS.Timeout | null = null;

    // Minimal fallback defaults
    private readonly fallbackDefaults = {
        enabled: true,
        greetingResponseChance: 0.3,
        cleanupInterval: 5 * 60 * 1000, // Clean up old cooldowns every 5 minutes
        guildRankCooldowns: {
            'GM': 0,
            'Leader': 10,
            'SBMAIN': 12,
            'Elite': 15,
            'Mod': 20,
            'Member': 60
        }
    };

    async init(context: any, api: ExtensionAPI): Promise<void> {
        api.log.info(`Initializing ${this.manifest.name}...`);
        
        // Workaround: Load config directly if not provided by extension system
        // The extension system has a bug where it doesn't load config.json files properly
        let config = api.config || {};
        
        if (!config || Object.keys(config).length === 0) {
            api.log.warn(`${this.manifest.name}: No config provided by extension system, attempting direct load`);
            try {
                const fs = require('fs');
                const path = require('path');
                // Go one level up from dist/ to find config.json in the extension directory
                const configPath = path.join(__dirname, '..', 'config.json');
                
                if (fs.existsSync(configPath)) {
                    const configContent = fs.readFileSync(configPath, 'utf8');
                    config = JSON.parse(configContent);
                    api.log.info(`${this.manifest.name}: Successfully loaded config directly`);
                } else {
                    api.log.error(`${this.manifest.name}: Config file not found at ${configPath}`);
                }
            } catch (error) {
                api.log.error(`${this.manifest.name}: Failed to load config directly:`, error);
            }
        }
        
        // Validate and set configuration
        this.config = this.validateConfig(config, api);
        
        // Check if extension is disabled
        if (this.config.enabled === false) {
            api.log.warn(`${this.manifest.name} is disabled in configuration`);
            return;
        }
        
        // Start cooldown cleanup interval
        this.startCooldownCleanup();
        
        api.log.info(`Guild rank cooldowns configured`);
        api.log.info(`${this.manifest.name} initialized successfully`);
    }

    async destroy(context: any, api: ExtensionAPI): Promise<void> {
        api.log.info(`Destroying ${this.manifest.name}...`);
        
        // Clear cleanup interval
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        
        // Clear all cooldowns
        this.cooldowns.clear();
    }

    async onEnable(context: any, api: ExtensionAPI): Promise<void> {
        api.log.info(`${this.manifest.name} enabled`);
    }

    async onDisable(context: any, api: ExtensionAPI): Promise<void> {
        api.log.info(`${this.manifest.name} disabled`);
    }

    /**
     * Validate and merge configuration with fallback defaults
     */
    private validateConfig(config: any, api: ExtensionAPI): any {
        if (!config || typeof config !== 'object') {
            api.log.error(`${this.manifest.name}: Invalid configuration provided, using fallbacks`);
            return { ...this.fallbackDefaults };
        }
        
        // Merge with fallback defaults for essential properties only
        const validatedConfig = {
            enabled: config.enabled ?? this.fallbackDefaults.enabled,
            greetingResponseChance: config.greetingResponseChance ?? this.fallbackDefaults.greetingResponseChance,
            cleanupInterval: config.cleanupInterval ?? this.fallbackDefaults.cleanupInterval,
            guildRankCooldowns: config.guildRankCooldowns ?? this.fallbackDefaults.guildRankCooldowns,
            responses: config.responses || {},
            patterns: config.patterns || {},
            commands: config.commands || {}
        };
        
        // Validate required configuration sections
        if (!validatedConfig.responses || Object.keys(validatedConfig.responses).length === 0) {
            api.log.error(`${this.manifest.name}: No responses configured! Extension may not function properly.`);
        }
        
        if (!validatedConfig.guildRankCooldowns) {
            api.log.warn(`${this.manifest.name}: No guild rank cooldowns configured, using defaults.`);
            validatedConfig.guildRankCooldowns = this.fallbackDefaults.guildRankCooldowns;
        }
        
        return validatedConfig;
    }

    async onConfigChange(newConfig: any, oldConfig: any, api: ExtensionAPI): Promise<void> {
        api.log.info(`${this.manifest.name} configuration updated`);
        this.config = this.validateConfig(newConfig, api);
    }

    async healthCheck(api: ExtensionAPI): Promise<boolean> {
        return this.config.enabled !== false;
    }

    /**
     * Define chat patterns that this extension handles
     */
    getChatPatterns(): ChatPattern[] {
        // Don't return patterns if extension is disabled
        if (this.config.enabled === false) {
            return [];
        }

        // Don't return patterns if patterns are disabled
        if (this.config.patterns?.enabled === false) {
            return [];
        }
        
        const priorities = this.config.patterns?.priorities || {
            commands: 5,
            botMention: 5,
            botReference: 15,
            greeting: 20,
            timeGreeting: 18,
            thanks: 12,
            compliments: 30,
            roasts: 30,
            howAreYou: 16,
            whatsUp: 17
        };
        
        return [
            // Ping command
            {
                id: 'fun-ping',
                extensionId: 'fun-bot',
                pattern: /^!ping\b/i,
                priority: priorities.commands,
                description: 'Responds to ping with pong',
                handler: this.handlePing.bind(this)
            },
            // Coinflip command
            {
                id: 'coinflip',
                extensionId: 'fun-bot',
                pattern: /^!(cf|coinflip)\b/i,
                priority: priorities.commands,
                description: 'Flips a coin (heads or tails)',
                handler: this.handleCoinflip.bind(this)
            },
            // Random number command
            {
                id: 'random',
                extensionId: 'fun-bot',
                pattern: /^!random(?:\s+(\d+))?\b/i,
                priority: priorities.commands,
                description: 'Generates a random number (optionally with max limit)',
                handler: this.handleRandom.bind(this)
            },
            // Help command
            {
                id: 'help',
                extensionId: 'fun-bot',
                pattern: /^!help(?:\s+(\w+))?\b/i,
                priority: priorities.commands,
                description: 'Shows help for available commands',
                handler: this.handleHelp.bind(this)
            },
            // TPS command
            {
                id: 'tps',
                extensionId: 'fun-bot',
                pattern: /^!tps\b/i,
                priority: priorities.commands,
                description: 'Shows server TPS information',
                handler: this.handleTPS.bind(this)
            },
            // Bot mentions (MiscManager, bot, etc.) - Only when directly addressed
            {
                id: 'bot-mention',
                extensionId: 'fun-bot',
                pattern: /^@?miscmanager\b|^(hey|hi|hello|yo|sup)\s+@?miscmanager\b/i,
                priority: priorities.botMention,
                description: 'Responds when bot is directly mentioned or addressed',
                handler: this.handleBotMention.bind(this)
            },
            // General bot references - Lower priority, excludes mentions
            {
                id: 'bot-reference',
                extensionId: 'fun-bot',
                pattern: /\b(hey bot|hi bot|hello bot)\b(?!.*\b(miscmanager|misc manager)\b)/i,
                priority: priorities.botReference,
                description: 'Responds to general bot greetings',
                handler: this.handleBotGreeting.bind(this)
            },
            // Greetings - Only respond to some, not all greetings to avoid spam
            {
                id: 'greeting',
                extensionId: 'fun-bot',
                pattern: /^(hello|hi|hey|greetings|sup|yo)\s+(everyone|all|guild|chat)\b/i,
                priority: priorities.greeting,
                description: 'Responds to general greetings directed at everyone',
                handler: this.handleGreeting.bind(this)
            },
            // Good morning/night - Only when directed at bot, everyone, or general greetings
            {
                id: 'time-greeting',
                extensionId: 'fun-bot',
                pattern: /^(good morning|good night|good afternoon|gm|gn)\s*(everyone|all|guild|chat|miscmanager|bot|@miscmanager|@bot)?$|^(good morning|good night|good afternoon|gm|gn)\b.*(bot|miscmanager|everyone|all|guild|chat)/i,
                priority: priorities.timeGreeting,
                description: 'Responds to time-based greetings directed at bot or everyone',
                handler: this.handleTimeGreeting.bind(this)
            },
            // Thank you - Only when directed at bot or miscmanager specifically
            {
                id: 'thanks',
                extensionId: 'fun-bot',
                pattern: /\b(thank you|thanks|thx|ty)\b.*(bot|miscmanager)/i,
                priority: priorities.thanks,
                description: 'Responds to thanks',
                handler: this.handleThanks.bind(this)
            },
            // Compliments to bot - Only match if no MiscManager mention (to avoid conflicts)
            {
                id: 'compliments',
                extensionId: 'fun-bot',
                pattern: /\b(good|great|awesome|amazing|cool|nice|love|best)\b.*\bbot\b(?!.*\b(miscmanager|misc manager)\b)/i,
                priority: priorities.compliments,
                description: 'Responds to compliments directed at bot',
                handler: this.handleCompliment.bind(this)
            },
            // Insults/roasts to bot - Only match if no MiscManager mention (to avoid conflicts)
            {
                id: 'roasts',
                extensionId: 'fun-bot',
                pattern: /\b(bad|suck|trash|garbage|stupid|dumb|worst|a prick)\b.*\bbot\b(?!.*\b(miscmanager|misc manager)\b)/i,
                priority: priorities.roasts,
                description: 'Playfully responds to insults directed at bot',
                handler: this.handleRoast.bind(this)
            },
            // How are you - Only when directed at bot or miscmanager specifically  
            {
                id: 'how-are-you',
                extensionId: 'fun-bot',
                pattern: /\b(how are you|how\'re you|how r u)\b.*(bot|miscmanager)/i,
                priority: priorities.howAreYou,
                description: 'Responds to "how are you" questions',
                handler: this.handleHowAreYou.bind(this)
            },
            // What's up - Only when directed at bot or miscmanager specifically
            {
                id: 'whats-up',
                extensionId: 'fun-bot',
                pattern: /\b(what\'s up|whats up|wassup|wsp)\b.*(bot|miscmanager)/i,
                priority: priorities.whatsUp,
                description: 'Responds to "what\'s up" questions',
                handler: this.handleWhatsUp.bind(this)
            }
        ];
    }

    /**
     * Get a random response from a config array with optional variable substitution
     */
    private getRandomResponse(responseKey: string, variables?: Record<string, string | number>): string {
        const responses = (this.config.responses as any)?.[responseKey] || [];
        if (!responses || responses.length === 0) {
            return `[${responseKey} response not configured]`;
        }
        
        let response = responses[Math.floor(Math.random() * responses.length)];
        
        // Replace variables in the response
        if (variables) {
            for (const [key, value] of Object.entries(variables)) {
                const regex = new RegExp(`\\{${key}\\}`, 'g');
                response = response.replace(regex, String(value));
            }
        }
        
        return response;
    }

    /**
     * Check if user is on cooldown based on guild rank
     */
    private isOnCooldown(
        playerName: string,
        guildRank: string | undefined,
        now: number
    ): number | null {
        // Get guild rank cooldowns configuration
        const rankCooldowns = this.config.guildRankCooldowns || this.fallbackDefaults.guildRankCooldowns;
        let cooldownSeconds: number | undefined;

        // Check for exact guild rank match first
        if (guildRank && rankCooldowns[guildRank]) {
            cooldownSeconds = rankCooldowns[guildRank];
        } else if (guildRank) {
            // Try to match guild rank keywords (case-insensitive)
            if (guildRank.toLowerCase().includes('guild master') || guildRank.toLowerCase().includes('guildmaster') || guildRank.toLowerCase().includes('gm')) {
                cooldownSeconds = rankCooldowns['GM'];
            } else if (guildRank.toLowerCase().includes('leader')) {
                cooldownSeconds = rankCooldowns['Leader'];
            } else if (guildRank.toLowerCase().includes('moderator') || guildRank.toLowerCase().includes('mod')) {
                cooldownSeconds = rankCooldowns['Moderator'];
            } else if (guildRank.toLowerCase().includes('elite')) {
                cooldownSeconds = rankCooldowns['Elite'];
            } else if (guildRank.toLowerCase().includes('member')) {
                cooldownSeconds = rankCooldowns['Member'];
            }
        }

        // Default to Member cooldown if no rank detected
        if (cooldownSeconds === undefined) {
            cooldownSeconds = rankCooldowns['Member'];
        }

        // No cooldown if set to 0
        if (cooldownSeconds === 0) {
            return null;
        }

        const cooldownTime = cooldownSeconds! * 1000; // Convert to milliseconds
        const lastRun = this.cooldowns.get(playerName);
        if (lastRun && now - lastRun < cooldownTime) {
            return Math.ceil((cooldownTime - (now - lastRun)) / 1000);
        }

        return null;
    }

    /**
     * Set cooldown for user
     */
    private setCooldown(playerName: string, now: number): void {
        this.cooldowns.set(playerName, now);
    }

    /**
     * Start cooldown cleanup interval
     */
    private startCooldownCleanup(): void {
        this.cleanupInterval = setInterval(() => {
            this.cleanupOldCooldowns();
        }, this.config.cleanupInterval || this.fallbackDefaults.cleanupInterval);
    }

    /**
     * Clean up old cooldowns
     */
    private cleanupOldCooldowns(): void {
        const now = Date.now();
        const rankCooldowns = this.config.guildRankCooldowns || this.fallbackDefaults.guildRankCooldowns;
        const maxCooldown = Math.max(...Object.values(rankCooldowns).map(v => Number(v))) * 1000;
        
        for (const [playerName, timestamp] of this.cooldowns.entries()) {
            if (now - timestamp > maxCooldown) {
                this.cooldowns.delete(playerName);
            }
        }
    }

    /**
     * Send response based on channel with cooldown check
     */
    private async sendResponse(context: ChatMessageContext, message: string, api: ExtensionAPI): Promise<void> {
        // Double-check that extension is enabled before responding
        if (this.config.enabled === false) {
            api.log.debug(`Fun Bot response suppressed - extension is disabled`);
            return;
        }

        // Check cooldown
        const now = Date.now();
        const cooldownRemaining = this.isOnCooldown(context.username, context.guildRank, now);
        if (cooldownRemaining !== null && cooldownRemaining > 0) {
            api.log.debug(`Fun Bot cooldown active for ${context.username}: ${cooldownRemaining}s remaining`);
            return; // Silently ignore if on cooldown
        }

        // Set cooldown for this user
        this.setCooldown(context.username, now);
        
        api.log.debug(`Fun Bot responding to ${context.username} (${context.guildRank || 'No Rank'})`);
        
        if (context.channel === 'Guild' || context.channel === 'Officer') {
            api.chat.sendGuildChat(message);
        } else if (context.channel === 'From') {
            api.chat.sendPrivateMessage(context.username, message);
        } else if (context.channel === 'Party') {
            api.chat.sendPartyMessage(message);
        }
    }

    /**
     * Handle ping command
     */
    private async handlePing(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        const now = Date.now();
        
        // Add some variety based on how many times pinged recently
        if (now - this.lastPingTime < 30000) { // Within 30 seconds
            this.pingCount++;
        } else {
            this.pingCount = 1;
        }
        
        this.lastPingTime = now;
        
        let response: string;
        
        if (this.pingCount > 5) {
            response = `Pong! (${this.pingCount}x) Okay, I get it, I'm here!`;
        } else if (this.pingCount > 3) {
            response = `Pong! (${this.pingCount}x) Are you testing my patience?`;
        } else {
            response = this.getRandomResponse('ping');
        }
        
        await this.sendResponse(context, response, api);
        
        api.log.info(`Responded to ping from ${context.username} (count: ${this.pingCount})`);
    }

    /**
     * Handle coinflip command
     */
    private async handleCoinflip(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        const outcomes = this.config.commands?.coinflip?.outcomes || ['Heads', 'Tails'];
        const result = outcomes[Math.floor(Math.random() * outcomes.length)];
        
        const response = this.getRandomResponse('coinflip', { result });
        await this.sendResponse(context, response, api);
        
        api.log.info(`Coinflip result for ${context.username}: ${result}`);
    }

    /**
     * Handle random number command
     */
    private async handleRandom(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        const matches = context.message.match(/^!random(?:\s+(\d+))?\b/i);
        const defaultMax = this.config.commands?.random?.defaultMax || 100;
        const maximumLimit = this.config.commands?.random?.maximumLimit || 1000000;
        let maxNumber = defaultMax;
        
        if (matches && matches[1]) {
            const userMax = parseInt(matches[1]);
            if (userMax > 0 && userMax <= maximumLimit) {
                maxNumber = userMax;
            } else if (userMax > maximumLimit) {
                await this.sendResponse(context, `That's too big! Maximum is ${maximumLimit.toLocaleString()}. Try again!`, api);
                return;
            } else {
                await this.sendResponse(context, `Please provide a positive number! Example: !random 50`, api);
                return;
            }
        }
        
        const randomNumber = Math.floor(Math.random() * maxNumber) + 1;
        
        const response = this.getRandomResponse('random', { 
            number: randomNumber.toLocaleString(),
            max: maxNumber.toLocaleString()
        });
        
        await this.sendResponse(context, response, api);
        
        api.log.info(`Random number for ${context.username}: ${randomNumber} (max: ${maxNumber})`);
    }

    /**
     * Handle help command
     */
    private async handleHelp(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        const matches = context.message.match(/^!help(?:\s+(\w+))?\b/i);
        const specificCommand = matches?.[1]?.toLowerCase();
        
        if (specificCommand) {
            // Help for specific command
            const commandHelp = this.config.commands?.help?.descriptions || {};
            
            const helpText = commandHelp[specificCommand];
            if (helpText) {
                await this.sendResponse(context, helpText, api);
            } else {
                await this.sendResponse(context, `Command "${specificCommand}" not found. Use !help to see all available commands.`, api);
            }
        } else {
            // General help
            const helpMessage = this.config.commands?.help?.generalMessage || "Fun Bot commands not configured. Please check config.json";
            await this.sendResponse(context, helpMessage, api);
        }
        
        api.log.info(`Help requested by ${context.username}${specificCommand ? ` for command: ${specificCommand}` : ''}`);
    }

    /**
     * Handle TPS command
     */
    private async handleTPS(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        try {
            const showTimestamp = this.config.commands?.tps?.showTimestamp !== false;
            const baseResponse = this.getRandomResponse('tps');
            
            let response = baseResponse;
            
            if (showTimestamp) {
                const timestamp = new Date().toLocaleTimeString('en-US', { 
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit'
                });
                response = `${baseResponse} (${timestamp})`;
            }
            
            await this.sendResponse(context, response, api);
            
            api.log.info(`TPS info requested by ${context.username}`);
            
        } catch (error) {
            await this.sendResponse(context, "Unable to fetch TPS information at the moment. Try again later!", api);
            api.log.error(`Error handling TPS command for ${context.username}:`, error);
        }
    }

    /**
     * Handle bot mentions
     */
    private async handleBotMention(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        const message = context.message.toLowerCase();
        
        api.log.debug(`Bot mention handler called for: "${context.message}" from ${context.username}`);
        
        // Additional validation - make sure it's actually addressing the bot
        // Skip if it's just mentioning MiscManager in passing (like "MiscManager kicked someone")
        const isDirectlyAddressed = 
            message.startsWith('miscmanager') ||
            message.startsWith('@miscmanager') ||
            message.match(/^(hey|hi|hello|yo|sup)\s+@?miscmanager\b/i) ||
            message.includes('miscmanager?') ||
            message.includes('miscmanager!') ||
            message.includes('miscmanager,');
        
        if (!isDirectlyAddressed) {
            api.log.debug(`Skipping bot mention - not directly addressed: ${context.message}`);
            return;
        }
        
        // Prevent duplicate responses by checking if we've recently responded to this user
        const now = Date.now();
        const lastResponseKey = `${context.username}-${Math.floor(now / 5000)}`; // 5-second window
        
        if (this.recentResponses.has(lastResponseKey)) {
            api.log.debug(`Skipping duplicate response to ${context.username}`);
            return;
        }
        
        this.recentResponses.set(lastResponseKey, now);
        
        // Clean up old entries
        for (const [key, timestamp] of this.recentResponses.entries()) {
            if (now - timestamp > 10000) { // 10 seconds
                this.recentResponses.delete(key);
            }
        }
        
        const response = this.getRandomResponse('botMention');
        await this.sendResponse(context, response, api);
        
        api.log.info(`Responded to bot mention from ${context.username}`);
    }

    /**
     * Handle bot greetings
     */
    private async handleBotGreeting(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        const response = this.getRandomResponse('greeting');
        await this.sendResponse(context, `${response} ${context.username}!`, api);
        
        api.log.info(`Responded to bot greeting from ${context.username}`);
    }

    /**
     * Handle general greetings
     */
    private async handleGreeting(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        const responseChance = this.config.greetingResponseChance ?? this.fallbackDefaults.greetingResponseChance;
        if (Math.random() < responseChance) {
            const response = this.getRandomResponse('greeting');
            await this.sendResponse(context, `${response} ${context.username}!`, api);
            
            api.log.info(`Responded to general greeting from ${context.username}`);
        }
    }

    /**
     * Handle time-based greetings
     */
    private async handleTimeGreeting(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        const hour = new Date().getHours();
        let response: string;
        
        if (context.message.toLowerCase().includes('morning') || context.message.toLowerCase().includes('gm')) {
            if (hour < 12) {
                response = 'Good morning! Ready to conquer the day?';
            } else {
                response = 'It\'s past noon, but good morning anyway!';
            }
        } else if (context.message.toLowerCase().includes('night') || context.message.toLowerCase().includes('gn')) {
            if (hour >= 18 || hour < 6) {
                response = 'Good night! Sweet dreams!';
            } else {
                response = 'It\'s still daytime, but good night anyway!';
            }
        } else if (context.message.toLowerCase().includes('afternoon')) {
            response = 'Good afternoon! Hope you\'re having a great day!';
        } else {
            response = this.getRandomResponse('greeting');
        }
        
        await this.sendResponse(context, `${response} ${context.username}!`, api);
        
        api.log.info(`Responded to time greeting from ${context.username}`);
    }

    /**
     * Handle thanks
     */
    private async handleThanks(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        const response = this.getRandomResponse('thanks');
        await this.sendResponse(context, `${response} ${context.username}!`, api);
        
        api.log.info(`Responded to thanks from ${context.username}`);
    }

    /**
     * Handle compliments
     */
    private async handleCompliment(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        const response = this.getRandomResponse('compliment');
        await this.sendResponse(context, `${response} ${context.username}!`, api);
        
        api.log.info(`Responded to compliment from ${context.username}`);
    }

    /**
     * Handle roasts/insults
     */
    private async handleRoast(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        const response = this.getRandomResponse('roast');
        await this.sendResponse(context, `${response} ${context.username}!`, api);
        
        api.log.info(`Responded to roast from ${context.username}`);
    }

    /**
     * Handle "how are you" questions
     */
    private async handleHowAreYou(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        const response = this.getRandomResponse('howAreYou');
        await this.sendResponse(context, `${response} ${context.username}!`, api);
        
        api.log.info(`Responded to "how are you" from ${context.username}`);
    }

    /**
     * Handle "what's up" questions
     */
    private async handleWhatsUp(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        const response = this.getRandomResponse('whatsUp');
        await this.sendResponse(context, `${response} ${context.username}!`, api);
        
        api.log.info(`Responded to "what's up" from ${context.username}`);
    }
}

export default FunBotExtension;
