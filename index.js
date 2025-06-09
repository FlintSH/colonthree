import colors from "irc-colors";
import irc from "irc-framework";
import { EventEmitter } from "node:events";
import { Client, GatewayIntentBits } from "discord.js";
import config from "./config.json" with { type: "json" };

const emitter = new EventEmitter();
let rizonReady = false;
let furnetReady = false;
let discordReady = false;
let channel;
let channel2;

const rizonBot = new irc.Client({
    nick: config.nick,
    username: config.user,
    gecos: config.realname,
    version: config.version,
    host: "irc.rizon.net",
    port: 6667,
});
rizonBot.source = "Rizon";
rizonBot.connect();
rizonBot.on("registered", () => {
    rizonBot.say("NickServ", `IDENTIFY ${config.password}`);
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
    if (e.nick !== config.nick)
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
    nick: config.nick,
    username: config.user,
    gecos: config.realname,
    version: config.version,
    host: "irc.furnet.org",
    port: 6667,
});
furnetBot.source = "Furnet";
furnetBot.connect();
furnetBot.on("registered", () => {
    furnetBot.say("NickServ", `IDENTIFY ${config.password}`);
    furnetBot.raw("MODE", config.nick, "+Bx");
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
    if (e.nick !== config.nick)
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
    channel = await discordClient.channels.fetch(config.channels[0]);
    channel2 = await discordClient.channels.fetch(config.channels[1]);
    discordReady = true;
});

discordClient.on("messageReactionAdd", async (reaction, reactor) => {
    if (config.channels.indexOf(reaction.message.channelId) === -1) return;
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
        config.channels.indexOf(msg.channelId) === -1
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
                Authorization: `Bearer ${config.fileToken}`,
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
                    Authorization: `Bearer ${config.fileToken}`,
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

discordClient.login(config.token);

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
    if (!msg.channelId || msg.channelId !== config.channels[0]) {
        channel.send(
            `[${msg.source}] ${
                msg.type === "privmsg" ? `<${msg.nick}>` : `* ${msg.nick}`
            } ${colors.stripColorsAndStyle(msg.message)}`
        );
    }
    if (!msg.channelId || msg.channelId !== config.channels[1]) {
        channel2.send(
            `[${msg.source}] ${
                msg.type === "privmsg" ? `<${msg.nick}>` : `* ${msg.nick}`
            } ${colors.stripColorsAndStyle(msg.message)}`
        );
    }
});
