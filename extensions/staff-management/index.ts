/**
 * Staff Management Extension
 * 
 * Provides administrative tools and analytics for guild staff members.
 * 
 * Features:
 * - Guild statistics logging (messages, joins, leaves, etc.)
 * - Bi-weekly automated reports to officer channel
 * - Analytics commands (!analytic    private async sendPermissionDenied(context: ChatMessageContext, api: ExtensionAPI, requiredRanks: string[]): Promise<void> {
        const userRank = context.guildRank || 'Unknown';
        const message = `❌ Access denied. Your rank: ${userRank}, Required: ${requiredRanks.join(', ')}`;
        
        if (context.channel === 'Guild' || context.channel === 'Officer') {
            api.chat.sendGuildChat(message);
        } else if (context.channel === 'From') {
            api.chat.sendPrivateMessage(context.username, message);
        }
    }onthly/today)
 * - Administrative controls (!reboot)
 * - Permission-based access control
 * 
 * Permissions:
 * - Analytics: Mod, Leader, GM
 * - Reboot: Leader, GM only
 * 
 * @author MiscGuild Bridge Bot Team
 * @version 1.0.0
 */

import fs from 'fs/promises';
import path from 'path';

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
        send: (channelId: string, content: any, color?: number, ping?: boolean) => Promise<any>;
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

interface DailyStats {
    date: string;
    messagesReceived: number;
    membersJoined: number;
    membersLeft: number;
    membersKicked: number;
    promotions: number;
    demotions: number;
    guildLevelUps: number;
    questsCompleted: number;
    activeUsers: Set<string>;
    topChatters: Record<string, number>;
}

interface AnalyticsData {
    dailyStats: Record<string, DailyStats>;
    lastReportDate: string;
    totalStats: {
        totalMessages: number;
        totalJoins: number;
        totalLeaves: number;
        totalKicks: number;
        totalPromotions: number;
        totalDemotions: number;
        totalLevelUps: number;
        totalQuests: number;
    };
}

class StaffManagementExtension {
    readonly manifest = {
        id: 'staff-management',
        name: 'Staff Management',
        version: '1.0.0',
        description: 'Analytics logging and administrative controls for guild staff',
        author: 'MiscGuild Bridge Bot Team'
    };

    private config: any = {};
    private analyticsData: AnalyticsData = {
        dailyStats: {},
        lastReportDate: '',
        totalStats: {
            totalMessages: 0,
            totalJoins: 0,
            totalLeaves: 0,
            totalKicks: 0,
            totalPromotions: 0,
            totalDemotions: 0,
            totalLevelUps: 0,
            totalQuests: 0
        }
    };
    
    private dataFilePath: string = '';
    private reportInterval: NodeJS.Timeout | null = null;
    private saveInterval: NodeJS.Timeout | null = null;
    private api: ExtensionAPI | null = null;

    // Default configuration
    private defaultConfig = {
        enabled: true,
        dataFile: 'guild-analytics.json',
        biWeeklyReports: true,
        reportChannel: 'oc', // Officer channel
        debugMode: false
    };

    // Staff ranks that can access analytics
    private analyticsRanks = ['[Mod]', '[Leader]', '[GM]', '[Guild Master]'];
    // Admin ranks that can use reboot
    private adminRanks = ['[Leader]', '[GM]', '[Guild Master]'];

    async init(context: any, api: ExtensionAPI): Promise<void> {
        api.log.info(`🔧 Initializing Staff Management Extension...`);
        
        this.api = api;
        this.config = { ...this.defaultConfig, ...(api.config || {}) };
        
        // Set up data file path
        this.dataFilePath = path.join(process.cwd(), 'data', this.config.dataFile);
        
        // Create data directory if it doesn't exist
        await this.ensureDataDirectory();
        
        // Load existing analytics data
        await this.loadAnalyticsData();
        
        // Set up bi-weekly report scheduler
        if (this.config.biWeeklyReports) {
            this.setupReportScheduler();
        }
        
        // Set up auto-save timer (every 15 minutes)
        this.setupAutoSave();
        
        // Set up event listeners for automatic logging
        this.setupEventListeners(api);
        
        api.log.success(`✅ Staff Management Extension initialized successfully`);
    }

    async destroy(context: any, api: ExtensionAPI): Promise<void> {
        api.log.info(`Destroying Staff Management Extension...`);
        
        // Save analytics data before shutdown
        await this.saveAnalyticsData();
        
        // Clear intervals
        if (this.reportInterval) {
            clearInterval(this.reportInterval);
        }
    }

    async onEnable(context: any, api: ExtensionAPI): Promise<void> {
        api.log.info(`Staff Management Extension enabled`);
    }

    async onDisable(context: any, api: ExtensionAPI): Promise<void> {
        // Clear timers
        if (this.reportInterval) {
            clearInterval(this.reportInterval);
            this.reportInterval = null;
        }
        
        if (this.saveInterval) {
            clearInterval(this.saveInterval);
            this.saveInterval = null;
        }
        
        // Save any remaining data before shutdown
        try {
            await this.saveAnalyticsData();
            api.log.info('💾 Final analytics data saved');
        } catch (error) {
            api.log.error('❌ Failed to save analytics data on disable:', error);
        }
        
        api.log.info(`Staff Management Extension disabled`);
    }

    async healthCheck(api: ExtensionAPI): Promise<boolean> {
        return this.config.enabled !== false;
    }

    /**
     * Set up event listeners for automatic logging
     */
    private setupEventListeners(api: ExtensionAPI): void {
        // Note: Analytics logging is now handled via chat patterns in getChatPatterns()
        // instead of event listeners since the core events don't emit to extensions
        api.log.info('📊 Analytics will be logged via chat patterns');
    }

    /**
     * Define chat patterns for commands
     */
    getChatPatterns(): ChatPattern[] {
        if (this.config.enabled === false) {
            return [];
        }

        return [
            // Analytics commands
            {
                id: 'analytics-weekly',
                extensionId: 'staff-management',
                pattern: /^!analytics\s+(weekly|week)\b/i,
                priority: 5,    
                description: 'Shows weekly analytics (Staff only)',
                handler: this.handleAnalyticsWeekly.bind(this)
            },
            {
                id: 'analytics-monthly',
                extensionId: 'staff-management',
                pattern: /^!analytics\s+(monthly|month)\b/i,
                priority: 5,
                description: 'Shows monthly analytics (Staff only)',
                handler: this.handleAnalyticsMonthly.bind(this)
            },
            {
                id: 'analytics-today',
                extensionId: 'staff-management',
                pattern: /^!analytics\s+(today|daily)\b/i,
                priority: 5,
                description: 'Shows today\'s analytics (Staff only)',
                handler: this.handleAnalyticsToday.bind(this)
            },
            {
                id: 'analytics-general',
                extensionId: 'staff-management',
                pattern: /^!analytics\b/i,
                priority: 10,
                description: 'Shows general analytics info (Staff only)',
                handler: this.handleAnalyticsGeneral.bind(this)
            },
            // Admin commands
            {
                id: 'reboot',
                extensionId: 'staff-management',
                pattern: /^!reboot\b/i,
                priority: 5,
                description: 'Forcefully restarts the bot (Admin only)',
                handler: this.handleReboot.bind(this)
            },
            {
                id: 'save-analytics',
                extensionId: 'staff-management',
                pattern: /^!save\b/i,
                priority: 5,
                description: 'Manually save analytics data (Staff only)',
                handler: this.handleSaveAnalytics.bind(this)
            },
            // Analytics logging patterns
            {
                id: 'analytics-guild-chat',
                extensionId: 'staff-management',
                pattern: /^Guild > (?:\[[^\]]+\]\s+)?([A-Za-z0-9_]{3,16})(?:\s+\[[^\]]+\])?:\s*(.+)$/,
                priority: 500,
                description: 'Logs guild chat messages for analytics',
                handler: this.handleGuildChatLog.bind(this)
            },
            {
                id: 'analytics-member-join-leave',
                extensionId: 'staff-management',
                pattern: /^(\[.*])?\s*(\w{2,17}).*? (joined|left) the guild!$/,
                priority: 500,
                description: 'Logs member joins and leaves for analytics',
                handler: this.handleMemberJoinLeaveLog.bind(this)
            },
            {
                id: 'analytics-member-kick',
                extensionId: 'staff-management',
                pattern: /^(\[.*])?\s*(\w{2,17}).*? was kicked from the guild by (\[.*])?\s*(\w{2,17}).*?!$/,
                priority: 500,
                description: 'Logs member kicks for analytics',
                handler: this.handleMemberKickLog.bind(this)
            },
            {
                id: 'analytics-promote-demote',
                extensionId: 'staff-management',
                pattern: /^(\[.*])?\s*(\w{2,17}).*? was (promoted|demoted) from (.*) to (.*)$/,
                priority: 500,
                description: 'Logs promotions and demotions for analytics',
                handler: this.handlePromoteDemoteLog.bind(this)
            },
            {
                id: 'analytics-guild-level-up',
                extensionId: 'staff-management',
                pattern: /^\s{19}The Guild has reached Level (\d*)!$/,
                priority: 500,
                description: 'Logs guild level ups for analytics',
                handler: this.handleGuildLevelUpLog.bind(this)
            },
            {
                id: 'analytics-quest-complete',
                extensionId: 'staff-management',
                pattern: /^\s{17}GUILD QUEST COMPLETED!$/,
                priority: 500,
                description: 'Logs quest completions for analytics',
                handler: this.handleQuestCompleteLog.bind(this)
            },
            {
                id: 'analytics-quest-tier-complete',
                extensionId: 'staff-management',
                pattern: /^\s{17}GUILD QUEST TIER (\d*) COMPLETED!$/,
                priority: 500,
                description: 'Logs quest tier completions for analytics',
                handler: this.handleQuestTierCompleteLog.bind(this)
            }
        ];
    }

    /**
     * Fetch actual guild rank from Hypixel API
     */
    private async fetchGuildRank(username: string): Promise<string | null> {
        try {
            // First, get UUID from username
            const mojangResponse = await fetch(`https://api.mojang.com/users/profiles/minecraft/${username}`);
            if (!mojangResponse.ok) {
                console.error(`Failed to fetch Mojang profile for ${username}:`, mojangResponse.statusText);
                return null;
            }
            const mojangProfile: any = await mojangResponse.json();
            if (!mojangProfile?.id) {
                console.error(`No UUID found for ${username}`);
                return null;
            }

            // Then fetch guild data
            const guildResponse = await fetch(`https://api.hypixel.net/guild?player=${mojangProfile.id}&key=${process.env.HYPIXEL_API_KEY}`);
            if (!guildResponse.ok) {
                console.error(`Failed to fetch Hypixel guild data for ${username}:`, guildResponse.statusText);
                return null;
            }
            const guildData: any = await guildResponse.json();
            if (!guildData?.guild?.members) {
                console.error(`No guild data found for ${username}`);
                return null;
            }

            // Find the member in the guild
            const member = guildData.guild.members.find((m: any) => m.uuid === mojangProfile.id);
            if (!member) {
                console.error(`User ${username} not found in guild members`);
                return null;
            }

            return member.rank;
        } catch (error) {
            console.error(`Error fetching guild rank for ${username}:`, error);
            return null;
        }
    }

    /**
     * Check if user has required permissions
     */
    private async hasPermission(context: ChatMessageContext, requiredRanks: string[]): Promise<boolean> {
        let guildRank = context.guildRank;
        
        // If no guild rank in context, try to fetch from Hypixel API
        if (!guildRank || guildRank === 'Unknown') {
            console.log(`Fetching guild rank for ${context.username} from Hypixel API...`);
            const fetchedRank = await this.fetchGuildRank(context.username);
            if (!fetchedRank) {
                return false;
            }
            guildRank = fetchedRank;
        }
        
        // Compare with brackets intact - ensure guildRank has brackets
        const rankWithBrackets = guildRank.startsWith('[') ? guildRank : `[${guildRank}]`;
        return requiredRanks.includes(rankWithBrackets);
    }

    /**
     * Send permission denied message
     */
    private async sendPermissionDenied(context: ChatMessageContext, api: ExtensionAPI, requiredRanks: string[]): Promise<void> {
        let userRank = context.guildRank || 'Unknown';
        
        // If rank is unknown, try to fetch from Hypixel API
        if (userRank === 'Unknown') {
            const fetchedRank = await this.fetchGuildRank(context.username);
            if (fetchedRank) {
                userRank = fetchedRank.startsWith('[') ? fetchedRank : `[${fetchedRank}]`;
            }
        }
        
        const message = `❌ Access denied. Your rank: ${userRank}, Required: ${requiredRanks.join(', ')}`;
        
        if (context.channel === 'Guild' || context.channel === 'Officer') {
            api.chat.sendGuildChat(message);
        } else if (context.channel === 'From') {
            api.chat.sendPrivateMessage(context.username, message);
        }
    }

    /**
     * Log an event to analytics
     */
    private async logEvent(type: string, playerName?: string): Promise<void> {
        const today = new Date().toISOString().split('T')[0];
        
        // Initialize today's stats if not exists
        if (!this.analyticsData.dailyStats[today]) {
            this.analyticsData.dailyStats[today] = {
                date: today,
                messagesReceived: 0,
                membersJoined: 0,
                membersLeft: 0,
                membersKicked: 0,
                promotions: 0,
                demotions: 0,
                guildLevelUps: 0,
                questsCompleted: 0,
                activeUsers: new Set(),
                topChatters: {}
            };
        }

        const dayStats = this.analyticsData.dailyStats[today];

        switch (type) {
            case 'message':
                dayStats.messagesReceived++;
                this.analyticsData.totalStats.totalMessages++;
                if (playerName) {
                    dayStats.activeUsers.add(playerName);
                    dayStats.topChatters[playerName] = (dayStats.topChatters[playerName] || 0) + 1;
                }
                break;
            case 'join':
                dayStats.membersJoined++;
                this.analyticsData.totalStats.totalJoins++;
                break;
            case 'leave':
                dayStats.membersLeft++;
                this.analyticsData.totalStats.totalLeaves++;
                break;
            case 'kick':
                dayStats.membersKicked++;
                this.analyticsData.totalStats.totalKicks++;
                break;
            case 'promotion':
                dayStats.promotions++;
                this.analyticsData.totalStats.totalPromotions++;
                break;
            case 'demotion':
                dayStats.demotions++;
                this.analyticsData.totalStats.totalDemotions++;
                break;
            case 'levelup':
                dayStats.guildLevelUps++;
                this.analyticsData.totalStats.totalLevelUps++;
                break;
            case 'quest':
                dayStats.questsCompleted++;
                this.analyticsData.totalStats.totalQuests++;
                break;
        }

        // Auto-save every 10 events to prevent data loss
        if (this.analyticsData.totalStats.totalMessages % 10 === 0) {
            await this.saveAnalyticsData();
        }
    }

    /**
     * Handle weekly analytics command
     */
    private async handleAnalyticsWeekly(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        if (!(await this.hasPermission(context, this.analyticsRanks))) {
            await this.sendPermissionDenied(context, api, this.analyticsRanks);
            return;
        }

        const weekData = this.getWeeklyData();
        const message = this.formatWeeklyReport(weekData);
        
        if (context.channel === 'Guild' || context.channel === 'Officer') {
            api.chat.sendGuildChat(message);
        } else if (context.channel === 'From') {
            api.chat.sendPrivateMessage(context.username, message);
        }

        api.log.info(`Weekly analytics requested by ${context.username}`);
    }

    /**
     * Handle monthly analytics command
     */
    private async handleAnalyticsMonthly(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        if (!(await this.hasPermission(context, this.analyticsRanks))) {
            await this.sendPermissionDenied(context, api, this.analyticsRanks);
            return;
        }

        const monthData = this.getMonthlyData();
        const message = this.formatMonthlyReport(monthData);
        
        if (context.channel === 'Guild' || context.channel === 'Officer') {
            api.chat.sendGuildChat(message);
        } else if (context.channel === 'From') {
            api.chat.sendPrivateMessage(context.username, message);
        }

        api.log.info(`Monthly analytics requested by ${context.username}`);
    }

    /**
     * Handle today's analytics command
     */
    private async handleAnalyticsToday(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        if (!(await this.hasPermission(context, this.analyticsRanks))) {
            await this.sendPermissionDenied(context, api, this.analyticsRanks);
            return;
        }

        const today = new Date().toISOString().split('T')[0];
        const todayStats = this.analyticsData.dailyStats[today];
        
        let message: string;
        if (!todayStats) {
            message = "No activity recorded for today yet.";
        } else {
            message = `Today's Stats: ${todayStats.messagesReceived} msgs | +${todayStats.membersJoined} joins | -${todayStats.membersLeft} leaves | ${todayStats.activeUsers.size} active users`;
        }
        
        if (context.channel === 'Guild' || context.channel === 'Officer') {
            api.chat.sendGuildChat(message);
        } else if (context.channel === 'From') {
            api.chat.sendPrivateMessage(context.username, message);
        }

        api.log.info(`Daily analytics requested by ${context.username}`);
    }

    /**
     * Handle general analytics command
     */
    private async handleAnalyticsGeneral(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        if (!(await this.hasPermission(context, this.analyticsRanks))) {
            await this.sendPermissionDenied(context, api, this.analyticsRanks);
            return;
        }

        const total = this.analyticsData.totalStats;
        const message = `📊 Total Stats: ${total.totalMessages} msgs | ${total.totalJoins} joins | ${total.totalLeaves} leaves | ${total.totalKicks} kicks | Use !analytics weekly/monthly/today`;
        
        if (context.channel === 'Guild' || context.channel === 'Officer') {
            api.chat.sendGuildChat(message);
        } else if (context.channel === 'From') {
            api.chat.sendPrivateMessage(context.username, message);
        }

        api.log.info(`General analytics requested by ${context.username}`);
    }

    /**
     * Handle reboot command
     */
    private async handleReboot(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        if (!(await this.hasPermission(context, this.adminRanks))) {
            await this.sendPermissionDenied(context, api, this.adminRanks);
            return;
        }

        api.log.warn(`🔄 Reboot command initiated by ${context.username} [${context.guildRank}]`);
        
        // Send confirmation message
        const message = `Bot reboot initiated by ${context.username}. Restarting in 3 seconds...`;
        if (context.channel === 'Guild' || context.channel === 'Officer') {
            api.chat.sendGuildChat(message);
        }

        // Save analytics data before restart
        await this.saveAnalyticsData();

        // Wait 3 seconds then force crash for auto-restart
        setTimeout(() => {
            api.log.error(`Forcing bot restart as requested by ${context.username}`);
            process.exit(1); // Force exit for auto-restart
        }, 3000);
    }

    /**
     * Handle manual save analytics command
     */
    private async handleSaveAnalytics(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        if (!(await this.hasPermission(context, this.analyticsRanks))) {
            await this.sendPermissionDenied(context, api, this.analyticsRanks);
            return;
        }

        api.log.info(`💾 Manual save initiated by ${context.username} [${context.guildRank}]`);
        
        try {
            await this.saveAnalyticsData();
            
            const message = `✅ Analytics data saved successfully by ${context.username}`;
            if (context.channel === 'Guild' || context.channel === 'Officer') {
                api.chat.sendGuildChat(message);
            } else if (context.channel === 'From') {
                api.chat.sendPrivateMessage(context.username, message);
            }
            
            api.log.success(`💾 Analytics data manually saved by ${context.username}`);
        } catch (error) {
            const errorMessage = `❌ Failed to save analytics data: ${error}`;
            if (context.channel === 'Guild' || context.channel === 'Officer') {
                api.chat.sendGuildChat(errorMessage);
            } else if (context.channel === 'From') {
                api.chat.sendPrivateMessage(context.username, errorMessage);
            }
            
            api.log.error(`❌ Failed to manually save analytics data:`, error);
        }
    }

    /**
     * Analytics logging handlers
     */
    private async handleGuildChatLog(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        if (!this.config.enabled) {
            api.log.debug('Analytics disabled in config');
            return;
        }
        
        // Debug logging (only when debugMode is enabled)
        if (this.config.debugMode) {
            api.log.info(`🔍 ANALYTICS DEBUG - Raw: "${context.raw}"`);
            api.log.info(`🔍 ANALYTICS DEBUG - Channel: "${context.channel}"`);
            api.log.info(`🔍 ANALYTICS DEBUG - Username: "${context.username}"`);
            api.log.info(`🔍 ANALYTICS DEBUG - Matches: ${context.matches ? JSON.stringify(context.matches) : 'null'}`);
        }
        
        // Use the already matched groups from the pattern
        if (context.matches && context.matches.length >= 3) {
            const playerName = context.matches[1]; // First capture group is username
            const message = context.matches[2];    // Second capture group is message
            
            await this.logEvent('message', playerName);
            if (this.config.debugMode) {
                api.log.info(`📊 Logged guild chat message from ${playerName}: "${message.substring(0, 50)}${message.length > 50 ? '...' : ''}"`);
            }
            return;
        }
        
        // Fallback: Only log if it was correctly parsed by the extension manager
        if (context.channel === 'Guild' || context.channel === 'Officer') {
            const playerName = context.username;
            await this.logEvent('message', playerName);
            if (this.config.debugMode) {
                api.log.info(`📊 Logged ${context.channel.toLowerCase()} chat message from ${playerName}`);
            }
        } else {
            // Debug log for pattern mismatch
            if (this.config.debugMode) {
                api.log.warn(`🔍 Pattern matched but no groups found - Raw: "${context.raw}"`);
            }
        }
    }

    private async handleMemberJoinLeaveLog(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        if (!this.config.enabled) return;
        
        // Match against raw message for system notifications
        const match = context.raw.match(/(\[.*\])?\s*(\w{2,17}).*? (joined|left) the guild!$/);
        if (!match) return;
        
        const playerName = match[2];
        const type = match[3];
        
        if (type === 'joined') {
            await this.logEvent('join', playerName);
            api.log.debug(`📊 Logged guild join: ${playerName}`);
        } else if (type === 'left') {
            await this.logEvent('leave', playerName);
            api.log.debug(`📊 Logged guild leave: ${playerName}`);
        }
    }

    private async handleServerJoinLeaveIgnore(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        // Match against raw message 
        const match = context.raw.match(/^Guild > (\w{2,17}) (joined|left)\.$/);
        if (!match) return;
        
        const playerName = match[1];
        const type = match[2];
        api.log.debug(`🚫 Ignoring server ${type} for ${playerName} (not a guild membership change)`);
    }

    private async handleMemberKickLog(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        if (!this.config.enabled) return;
        
        // Match against raw message for system notifications
        const match = context.raw.match(/(\[.*\])?\s*(\w{2,17}).*? was kicked from the guild by\s+(.+)!$/);
        if (!match) return;
        
        const playerName = match[2];
        await this.logEvent('kick', playerName);
        api.log.debug(`📊 Logged guild kick: ${playerName}`);
    }

    private async handlePromoteDemoteLog(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        if (!this.config.enabled) return;
        
        // Match against raw message for system notifications
        const match = context.raw.match(/^(\[.*])?\s*(\w{2,17}).*? was (promoted|demoted) from (.*) to (.*)$/);
        if (!match) return;
        
        const playerName = match[2];
        const action = match[3]; // 'promoted' or 'demoted'
        const fromRank = match[4];
        const toRank = match[5];
        
        if (action === 'promoted') {
            await this.logEvent('promotion', playerName);
            api.log.debug(`📊 Logged guild promotion: ${playerName} from ${fromRank} to ${toRank}`);
        } else if (action === 'demoted') {
            await this.logEvent('demotion', playerName);
            api.log.debug(`📊 Logged guild demotion: ${playerName} from ${fromRank} to ${toRank}`);
        }
    }

    private async handleGuildLevelUpLog(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        if (!this.config.enabled) return;
        
        // Match against raw message for system notifications
        const match = context.raw.match(/^\s{19}The Guild has reached Level (\d*)!$/);
        if (!match) return;
        
        const newLevel = match[1];
        await this.logEvent('guildLevelUp', 'GUILD');
        api.log.debug(`📊 Logged guild level up to level ${newLevel}`);
    }

    private async handleQuestCompleteLog(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        if (!this.config.enabled) return;
        
        // Match against raw message for system notifications
        const match = context.raw.match(/^\s{17}GUILD QUEST COMPLETED!$/);
        if (!match) return;
        
        await this.logEvent('questComplete', 'GUILD');
        api.log.debug(`📊 Logged guild quest completion`);
    }

    private async handleQuestTierCompleteLog(context: ChatMessageContext, api: ExtensionAPI): Promise<void> {
        if (!this.config.enabled) return;
        
        // Match against raw message for system notifications  
        const match = context.raw.match(/^\s{17}GUILD QUEST TIER (\d*) COMPLETED!$/);
        if (!match) return;
        
        const tier = match[1];
        await this.logEvent('questComplete', 'GUILD');
        api.log.debug(`📊 Logged guild quest tier ${tier} completion`);
    }

    /**
     * Get weekly data
     */
    private getWeeklyData(): any {
        const today = new Date();
        const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        
        let totalMessages = 0;
        let totalJoins = 0;
        let totalLeaves = 0;
        let totalKicks = 0;
        let activeUsers = new Set<string>();
        
        for (let d = new Date(weekAgo); d <= today; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            const dayStats = this.analyticsData.dailyStats[dateStr];
            
            if (dayStats) {
                totalMessages += dayStats.messagesReceived;
                totalJoins += dayStats.membersJoined;
                totalLeaves += dayStats.membersLeft;
                totalKicks += dayStats.membersKicked;
                dayStats.activeUsers.forEach(user => activeUsers.add(user));
            }
        }

        return {
            totalMessages,
            totalJoins,
            totalLeaves,
            totalKicks,
            activeUsers: activeUsers.size,
            period: '7 days'
        };
    }

    /**
     * Get monthly data
     */
    private getMonthlyData(): any {
        const today = new Date();
        const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
        
        let totalMessages = 0;
        let totalJoins = 0;
        let totalLeaves = 0;
        let totalKicks = 0;
        let activeUsers = new Set<string>();
        
        for (let d = new Date(monthAgo); d <= today; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            const dayStats = this.analyticsData.dailyStats[dateStr];
            
            if (dayStats) {
                totalMessages += dayStats.messagesReceived;
                totalJoins += dayStats.membersJoined;
                totalLeaves += dayStats.membersLeft;
                totalKicks += dayStats.membersKicked;
                dayStats.activeUsers.forEach(user => activeUsers.add(user));
            }
        }

        return {
            totalMessages,
            totalJoins,
            totalLeaves,
            totalKicks,
            activeUsers: activeUsers.size,
            period: '30 days'
        };
    }

    /**
     * Format weekly report
     */
    private formatWeeklyReport(data: any): string {
        return `Weekly Report: ${data.totalMessages} msgs | +${data.totalJoins} joins | -${data.totalLeaves} leaves | ${data.activeUsers} active members`;
    }

    /**
     * Format monthly report
     */
    private formatMonthlyReport(data: any): string {
        return `Monthly Report: ${data.totalMessages} msgs | +${data.totalJoins} joins | -${data.totalLeaves} leaves | ${data.activeUsers} active members`;
    }

    /**
     * Set up bi-weekly report scheduler
     */
    private setupReportScheduler(): void {
        // Check every hour if it's time for a bi-weekly report
        this.reportInterval = setInterval(async () => {
            await this.checkBiWeeklyReport();
        }, 60 * 60 * 1000); // Every hour
    }

    /**
     * Set up auto-save timer (every 15 minutes)
     */
    private setupAutoSave(): void {
        // Save analytics data every 15 minutes
        this.saveInterval = setInterval(async () => {
            try {
                await this.saveAnalyticsData();
                if (this.api?.log) {
                    this.api.log.info('💾 Auto-saved analytics data');
                }
            } catch (error) {
                if (this.api?.log) {
                    this.api.log.error('❌ Failed to auto-save analytics data:', error);
                }
            }
        }, 15 * 60 * 1000); // Every 15 minutes
    }

    /**
     * Check if it's time for bi-weekly report
     */
    private async checkBiWeeklyReport(): Promise<void> {
        const today = new Date().toISOString().split('T')[0];
        const lastReport = new Date(this.analyticsData.lastReportDate || '2024-01-01');
        const daysSinceReport = Math.floor((new Date().getTime() - lastReport.getTime()) / (1000 * 60 * 60 * 24));

        if (daysSinceReport >= 14) {
            await this.sendBiWeeklyReport();
            this.analyticsData.lastReportDate = today;
            await this.saveAnalyticsData();
        }
    }

    /**
     * Send bi-weekly report to officer channel
     */
    private async sendBiWeeklyReport(): Promise<void> {
        if (!this.api) return;

        const weekData = this.getWeeklyData();
        const report = `📊 Bi-Weekly Guild Report:\n${this.formatWeeklyReport(weekData)}\nTotal all-time: ${this.analyticsData.totalStats.totalMessages} messages, ${this.analyticsData.totalStats.totalJoins} joins`;

        try {
            // Send to Discord officer channel if available
            if (this.api.discord && this.api.discord.send) {
                await this.api.discord.send('oc', report, 0x3498db, false);
            }
            
            this.api.log.info('📊 Bi-weekly report sent to officer channel');
        } catch (error) {
            this.api.log.error('Failed to send bi-weekly report:', error);
        }
    }

    /**
     * Ensure data directory exists
     */
    private async ensureDataDirectory(): Promise<void> {
        const dataDir = path.dirname(this.dataFilePath);
        try {
            await fs.mkdir(dataDir, { recursive: true });
        } catch (error) {
            // Directory might already exist, ignore error
        }
    }

    /**
     * Load analytics data from file
     */
    private async loadAnalyticsData(): Promise<void> {
        try {
            const data = await fs.readFile(this.dataFilePath, 'utf8');
            const parsed = JSON.parse(data);
            
            // Convert activeUsers back to Set objects
            for (const date in parsed.dailyStats) {
                parsed.dailyStats[date].activeUsers = new Set(parsed.dailyStats[date].activeUsers || []);
            }
            
            this.analyticsData = { ...this.analyticsData, ...parsed };
            
            if (this.api) {
                this.api.log.info(`📊 Loaded analytics data from ${this.dataFilePath}`);
            }
        } catch (error) {
            if (this.api) {
                this.api.log.warn('📊 No existing analytics data found, starting fresh');
            }
        }
    }

    /**
     * Save analytics data to file (preserving existing data)
     */
    private async saveAnalyticsData(): Promise<void> {
        try {
            // First, load any existing data from the file to preserve manual edits
            let existingData: any = {};
            try {
                const fileData = await fs.readFile(this.dataFilePath, 'utf8');
                existingData = JSON.parse(fileData);
            } catch (error) {
                // File doesn't exist or is invalid, start fresh
                existingData = { dailyStats: {}, totalStats: {}, lastReportDate: null };
            }

            // Convert Set objects to arrays for JSON serialization
            const dataToSave = {
                ...existingData,
                ...this.analyticsData,
                dailyStats: {
                    ...existingData.dailyStats,
                    ...Object.fromEntries(
                        Object.entries(this.analyticsData.dailyStats).map(([date, stats]) => [
                            date,
                            {
                                ...stats,
                                activeUsers: Array.from(stats.activeUsers)
                            }
                        ])
                    )
                }
            };

            await fs.writeFile(this.dataFilePath, JSON.stringify(dataToSave, null, 2));
            
            if (this.api) {
                this.api.log.debug(`📊 Analytics data saved to ${this.dataFilePath} (preserving existing entries)`);
            }
        } catch (error) {
            if (this.api) {
                this.api.log.error('Failed to save analytics data:', error);
            }
        }
    }
}

export default StaffManagementExtension;
