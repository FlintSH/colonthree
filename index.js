import colors from "irc-colors";
import irc from "irc-framework";
import { EventEmitter } from "node:events";
import { Client, GatewayIntentBits, SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import pkg from "pg";

const { Pool } = pkg;

const emitter = new EventEmitter();
let rizonReady = false;
let furnetReady = false;
let discordReady = false;

const bridgeChannels = new Map();
const blacklistedGuilds = new Set();

const db = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function initDatabase() {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS bridge_channels (
                guild_id VARCHAR(20) PRIMARY KEY,
                channel_id VARCHAR(20) NOT NULL,
                guild_name VARCHAR(255),
                channel_name VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await db.query(`
            CREATE TABLE IF NOT EXISTS blacklisted_guilds (
                guild_id VARCHAR(20) PRIMARY KEY,
                guild_name VARCHAR(255),
                blacklisted_by VARCHAR(20),
                reason VARCHAR(500),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        const bridgeResult = await db.query('SELECT guild_id, channel_id FROM bridge_channels');
        for (const row of bridgeResult.rows) {
            bridgeChannels.set(row.guild_id, row.channel_id);
        }
        
        const blacklistResult = await db.query('SELECT guild_id FROM blacklisted_guilds');
        for (const row of blacklistResult.rows) {
            blacklistedGuilds.add(row.guild_id);
        }
        
        console.log(`Loaded ${bridgeResult.rows.length} bridge channel(s) from database`);
        console.log(`Loaded ${blacklistResult.rows.length} blacklisted guild(s) from database`);
    } catch (error) {
        console.error('Database initialization error:', error);
        process.exit(1);
    }
}

async function saveBridgeChannel(guildId, channelId, guildName, channelName) {
    try {
        await db.query(`
            INSERT INTO bridge_channels (guild_id, channel_id, guild_name, channel_name, updated_at)
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
            ON CONFLICT (guild_id) 
            DO UPDATE SET 
                channel_id = EXCLUDED.channel_id,
                guild_name = EXCLUDED.guild_name,
                channel_name = EXCLUDED.channel_name,
                updated_at = CURRENT_TIMESTAMP
        `, [guildId, channelId, guildName, channelName]);
        
        bridgeChannels.set(guildId, channelId);
        
        console.log(`Saved bridge channel for ${guildName}: #${channelName}`);
    } catch (error) {
        console.error('Error saving bridge channel:', error);
        throw error;
    }
}

async function blacklistGuild(guildId, guildName, blacklistedBy, reason = null) {
    try {
        await db.query(`
            INSERT INTO blacklisted_guilds (guild_id, guild_name, blacklisted_by, reason)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (guild_id) DO NOTHING
        `, [guildId, guildName, blacklistedBy, reason]);
        
        blacklistedGuilds.add(guildId);
        
        console.log(`Blacklisted guild ${guildName} (${guildId}) by ${blacklistedBy}`);
    } catch (error) {
        console.error('Error blacklisting guild:', error);
        throw error;
    }
}

async function unblacklistGuild(guildId) {
    try {
        await db.query('DELETE FROM blacklisted_guilds WHERE guild_id = $1', [guildId]);
        blacklistedGuilds.delete(guildId);
        console.log(`Removed guild ${guildId} from blacklist`);
    } catch (error) {
        console.error('Error removing guild from blacklist:', error);
        throw error;
    }
}

await initDatabase();

const rizonBot = new irc.Client({
    nick: process.env.IRC_NICK,
    username: process.env.IRC_USER,
    gecos: process.env.IRC_REALNAME,
    version: process.env.IRC_VERSION,
    host: "irc.rizon.net",
    port: 6667,
});
rizonBot.source = "Rizon";
rizonBot.connect();
rizonBot.on("registered", () => {
    rizonBot.say("NickServ", `IDENTIFY ${process.env.IRC_PASSWORD}`);
});
rizonBot.on("message", (msg) => {
    if (
        msg.nick === "NickServ" &&
        msg.message.startsWith("Password accepted")
    ) {
        console.log("Rizon connected");
        rizonBot.join("#colonthree");
        rizonReady = true;
    } else if (
        msg.target === "#colonthree" &&
        (msg.type === "privmsg" || msg.type === "action")
    ) {
        emitter.emit("message", {
            source: "Rizon",
            type: msg.type,
            nick: msg.nick,
            message: msg.message,
        });
    }
});
rizonBot.on("join", (e) => {
    if (e.nick !== process.env.IRC_NICK)
        emitter.emit("message", {
            source: "Rizon",
            type: "action",
            nick: e.nick,
            message: "joined #colonthree",
        });
});
rizonBot.on("part", (e) => {
    emitter.emit("message", {
        source: "Rizon",
        type: "action",
        nick: e.nick,
        message: `left #colonthree (${colors.gray(e.message)})`,
    });
});
rizonBot.on("quit", (e) => {
    emitter.emit("message", {
        source: "Rizon",
        type: "action",
        nick: e.nick,
        message: `quit${e.message ? ` (${colors.gray(e.message)})` : ""}`,
    });
});
rizonBot.on("kick", (e) => {
    emitter.emit("message", {
        source: "Rizon",
        type: "action",
        nick: e.kicked,
        message: `was kicked from #colonthree by ${e.nick} (${colors.gray(
            e.message
        )})`,
    });
});
rizonBot.on("nick", (e) => {
    emitter.emit("message", {
        source: "Rizon",
        type: "action",
        nick: e.nick,
        message: `is now ${colors.blue(e.new_nick)}`,
    });
});

const furnetBot = new irc.Client({
    nick: process.env.IRC_NICK,
    username: process.env.IRC_USER,
    gecos: process.env.IRC_REALNAME,
    version: process.env.IRC_VERSION,
    host: "irc.furnet.org",
    port: 6667,
});
furnetBot.source = "Furnet";
furnetBot.connect();
furnetBot.on("registered", () => {
    furnetBot.say("NickServ", `IDENTIFY ${process.env.IRC_PASSWORD}`);
    furnetBot.raw("MODE", process.env.IRC_NICK, "+Bx");
});
furnetBot.on("message", (msg) => {
    if (
        msg.nick === "NickServ" &&
        msg.message.startsWith("Password accepted")
    ) {
        console.log("Furnet connected");
        furnetBot.join("#colonthree");
        furnetReady = true;
    } else if (
        msg.target === "#colonthree" &&
        (msg.type === "privmsg" || msg.type === "action")
    ) {
        emitter.emit("message", {
            source: "Furnet",
            type: msg.type,
            nick: msg.nick,
            message: msg.message,
        });
    }
});
furnetBot.on("join", (e) => {
    if (e.nick !== process.env.IRC_NICK)
        emitter.emit("message", {
            source: "Furnet",
            type: "action",
            nick: e.nick,
            message: "joined #colonthree",
        });
});
furnetBot.on("part", (e) => {
    emitter.emit("message", {
        source: "Furnet",
        type: "action",
        nick: e.nick,
        message: `left #colonthree (${colors.gray(e.message)})`,
    });
});
furnetBot.on("quit", (e) => {
    emitter.emit("message", {
        source: "Furnet",
        type: "action",
        nick: e.nick,
        message: `quit${e.message ? ` (${colors.gray(e.message)})` : ""}`,
    });
});
furnetBot.on("kick", (e) => {
    emitter.emit("message", {
        source: "Furnet",
        type: "action",
        nick: e.kicked,
        message: `was kicked from #colonthree by ${e.nick} (${colors.grey(
            e.message
        )})`,
    });
});
furnetBot.on("nick", (e) => {
    emitter.emit("message", {
        source: "Furnet",
        type: "action",
        nick: e.nick,
        message: `is now ${colors.blue(e.new_nick)}`,
    });
});

const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
    ],
});

discordClient.on("ready", async () => {
    console.log("Discord connected");
    
    const setChannelCommand = new SlashCommandBuilder()
        .setName('setchannel')
        .setDescription('Set this channel as the bridge channel for colonthree')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
    
    const blacklistCommand = new SlashCommandBuilder()
        .setName('blacklist')
        .setDescription('Blacklist or unblacklist a guild from the bridge')
        .addStringOption(option =>
            option.setName('action')
                .setDescription('Action to perform')
                .setRequired(true)
                .addChoices(
                    { name: 'add', value: 'add' },
                    { name: 'remove', value: 'remove' }
                ))
        .addStringOption(option =>
            option.setName('guild_id')
                .setDescription('Discord guild ID to blacklist/unblacklist')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for blacklisting (optional)')
                .setRequired(false));
    
    await discordClient.application.commands.create(setChannelCommand);
    await discordClient.application.commands.create(blacklistCommand);
    console.log("Slash commands registered");
    
    discordReady = true;
});

discordClient.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    
    if (interaction.commandName === "setchannel") {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            await interaction.reply({ content: "you need admin to use this command.", ephemeral: true });
            return;
        }
        
        if (blacklistedGuilds.has(interaction.guildId)) {
            await interaction.reply({ content: "this server is blacklisted from colonthree.", ephemeral: true });
            return;
        }
        
        try {
            const hadPreviousChannel = bridgeChannels.has(interaction.guildId);
            
            await saveBridgeChannel(
                interaction.guildId, 
                interaction.channelId, 
                interaction.guild.name, 
                interaction.channel.name
            );
            
            const responseMessage = hadPreviousChannel 
                ? `this channel has been set as the new bridge channel for **${interaction.guild.name}**, replacing the previous one. messages across the colonthree network will now be bridged to this channel instead.`
                : `this channel has been set as the bridge channel for **${interaction.guild.name}**. yay :3. messages across the colonthree network will now be bridged to this channel.`;
            
            await interaction.reply({ 
                content: responseMessage, 
                ephemeral: true 
            });
        } catch (error) {
            console.error('Failed to save bridge channel:', error);
            await interaction.reply({ 
                content: "uh something went wrong. try again later.", 
                ephemeral: true 
            });
        }
    }
    
    if (interaction.commandName === "blacklist") {
        const allowedUsers = ["884967775066550313", "844719224861097997"];
        if (!allowedUsers.includes(interaction.user.id)) {
            await interaction.reply({ content: "who do you think you are?? you can't use this command.", ephemeral: true });
            return;
        }
        
        const action = interaction.options.getString('action');
        const guildId = interaction.options.getString('guild_id');
        const reason = interaction.options.getString('reason');
        
        try {
            if (action === 'add') {
                let guildName = guildId;
                try {
                    const guild = await discordClient.guilds.fetch(guildId);
                    guildName = guild.name;
                } catch {
                    // Guild not found, use ID as name
                }
                
                await blacklistGuild(guildId, guildName, interaction.user.id, reason);
                await interaction.reply({ 
                    content: `discord server ${guildName} (${guildId}) has been blacklisted from the bridge.`, 
                    ephemeral: true 
                });
            } else if (action === 'remove') {
                await unblacklistGuild(guildId);
                await interaction.reply({ 
                    content: `discord server ${guildId} has been removed from the blacklist.`, 
                    ephemeral: true 
                });
            }
        } catch (error) {
            console.error('Failed to update blacklist:', error);
            await interaction.reply({ 
                content: "didnt work. try again later.", 
                ephemeral: true 
            });
        }
    }
});

discordClient.on("messageReactionAdd", async (reaction, reactor) => {
    if (!bridgeChannels.has(reaction.message.guildId) || 
        bridgeChannels.get(reaction.message.guildId) !== reaction.message.channelId ||
        blacklistedGuilds.has(reaction.message.guildId)) return;
    const reactorMember = await reaction.message.guild.members.fetch(reactor.id);
    const message = await reaction.message.fetch();
    for (const mention of message.mentions.members) {
        message.content = message.content.replace(
            new RegExp(`<@${mention[0]}>`, "g"),
            `@${mention[1].displayName}`
        );
    }
    if (message.author.id === discordClient.user.id) {
        let cnt = message.content.split("> ");
        cnt[0] = cnt[0].split("<");
        cnt[0].splice(0, 1);
        cnt[0] = cnt[0].join("<");
        const user = cnt.splice(0, 1);
        cnt = cnt.join("> ");
        emitter.emit("message", {
            source: message.guild.name,
            channelId: message.channelId,
            nick: reactorMember.displayName,
            type: "action",
            message: `reacted to ${user}'s message (${colors.gray(
                cnt.split(" ").slice(0, 5).join(" ") +
                    (cnt.split(" ").length > 5 ? "..." : "")
            )}) with ${reaction.emoji.toString()}`,
        });
    } else {
        emitter.emit("message", {
            source: message.guild.name,
            channelId: message.channelId,
            nick: reactorMember.displayName,
            type: "action",
            message: `reacted to ${
                message.member.displayName
            }'s message (${colors.gray(
                message.content ? message.content
                    .replace(/\n/g, " ")
                    .split(" ")
                    .filter(x => !!x)
                    .slice(0, 5)
                    .join(" ") +
                    (message.content.split(" ").filter(x => !!x).length > 5
                        ? "..."
                        : "") : "Multimedia message"
            )}) with ${reaction.emoji.toString()}`,
        });
    }
});

discordClient.on("messageCreate", async (msg) => {
    if (
        msg.author.id === discordClient.user.id ||
        (!msg.content && msg.attachments.size === 0) ||
        !bridgeChannels.has(msg.guildId) ||
        bridgeChannels.get(msg.guildId) !== msg.channelId ||
        blacklistedGuilds.has(msg.guildId)
    )
        return;
    for (const mention of msg.mentions.members) {
        msg.content = msg.content.replace(
            new RegExp(`<@${mention[0]}>`, "g"),
            `@${mention[1].displayName}`
        );
    }
    if (msg.type === 19 /* Reply */) {
        const repliedMessage = await msg.fetchReference();
        for (const mention of repliedMessage.mentions.members) {
            repliedMessage.content = repliedMessage.content.replace(
                new RegExp(`<@${mention[0]}>`, "g"),
                `@${mention[1].displayName}`
            );
        }
        if (repliedMessage.author.id === discordClient.user.id) {
            let cnt = repliedMessage.content.split("> ");
            cnt[0] = cnt[0].split("<");
            cnt[0].splice(0, 1);
            cnt[0] = cnt[0].join("<");
            const user = cnt.splice(0, 1);
            cnt = cnt.join("> ");
            msg.content = `Reply to ${user} (${colors.gray(
                cnt.split(" ").slice(0, 5).join(" ") +
                    (cnt.split(" ").length > 5 ? "..." : "")
            )}): ${msg.content}`;
        } else {
            msg.content = `Reply to ${
                repliedMessage.member.displayName
            } (${colors.gray(
                repliedMessage.content
                    ? repliedMessage.content
                          .replace(/\n/g, " ")
                          .split(" ")
                          .filter(x => !!x)
                          .slice(0, 5)
                          .join(" ")
                          .slice(0, 50) +
                          (repliedMessage.content.split(" ").filter(x => !!x).length > 5 ||
                          repliedMessage.content.length > 50
                              ? "..."
                              : "")
                    : "Multimedia message"
            )}): ${msg.content}`;
        }
    }
    if (msg.content.split("\n").length > 1 || msg.content.length > 500) {
        const formData = new FormData();
        formData.append(
            "file",
            new File(
                [colors.stripColorsAndStyle(msg.content)],
                `message-${msg.id}.txt`,
                {
                    type: "text/plain",
                }
            )
        );
        const response = await fetch("https://cdn.fl1nt.dev/api/files", {
            method: "POST",
            body: formData,
            headers: {
                Authorization: `Bearer ${process.env.FLARE_TOKEN}`,
                "X-File-Type": "text/plain",
            },
        }).then((res) => res.json());
        msg.content = `Message paste: ${response.data.url}`;
    }
    if (msg.attachments.size > 0) {
        if (msg.content) msg.content += " / ";
        const attachments = [];
        for (const attachment of msg.attachments) {
            const response = await fetch("https://cdn.fl1nt.dev/api/urls", {
                method: "POST",
                body: JSON.stringify({
                    url: attachment[1].url,
                }),
                headers: {
                    Authorization: `Bearer ${process.env.FLARE_TOKEN}`,
                    "Content-Type": "application/json",
                },
            }).then((res) => res.json());
            attachments.push(
                response.success
                    ? `https://cdn.fl1nt.dev/u/${response.data.shortCode}`
                    : attachment[1].url
            );
        }
        msg.content +=
            `Attachment${attachments.length > 1 ? "s" : ""}: ${attachments.join(" / ")}`;
    }
    emitter.emit("message", {
        source: msg.guild.name,
        channelId: msg.channelId,
        nick: msg.member.displayName,
        type: "privmsg",
        message: msg.content,
    });
});

discordClient.login(process.env.DISCORD_TOKEN);

emitter.on("message", (msg) => {
    if (!(rizonReady && discordReady && furnetReady)) return;
    
    const client = [rizonBot, furnetBot].filter((x) => msg.source !== x.source);
    for (const c of client) {
        c.say(
            "#colonthree",
            `[${colors.red(msg.source)}] ${
                msg.type === "privmsg"
                    ? `<${colors.blue(msg.nick)}>`
                    : `* ${colors.blue(msg.nick)}`
            } ${msg.message}`
        );
    }
    
    // send to all bridge channels in the network
    for (const [guildId, channelId] of bridgeChannels) {
        // obviously we don't want to send message back to the Discord channel it came from
        if (msg.channelId && msg.channelId === channelId) continue;
        
        if (blacklistedGuilds.has(guildId)) continue;
        
        const channel = discordClient.channels.cache.get(channelId);
        if (channel) {
            channel.send(
                `[${msg.source}] ${
                    msg.type === "privmsg" ? `<${msg.nick}>` : `* ${msg.nick}`
                } ${colors.stripColorsAndStyle(msg.message)}`
            ).catch(console.error);
        }
    }
});
