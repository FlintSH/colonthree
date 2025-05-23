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

const rizonBot = new irc.Client({
    nick: config.nick,
    username: config.user,
    gecos: config.realname,
    version: config.version,
    host: "irc.rizon.net",
    port: 6667
});
rizonBot.source = "Rizon";
rizonBot.connect();
rizonBot.on("registered", () => {
    rizonBot.say("NickServ", `IDENTIFY ${config.password}`);
});
rizonBot.on("message", (msg) => {
    if (msg.nick === "NickServ" && msg.message.startsWith("Password accepted")) {
        console.log("Rizon connected");
        rizonBot.join("#colonthree");
        rizonReady = true;
    }
    else if (msg.target === "#colonthree" && (msg.type === "privmsg" || msg.type === "action")) {
        emitter.emit("message", {
            source: "Rizon",
            type: msg.type,
            nick: msg.nick,
            message: msg.message
        });
    }
});
rizonBot.on("join", (e) => {
    if (e.nick !== config.nick) emitter.emit("message", {
        source: "Rizon",
        type: "action",
        nick: e.nick,
        message: "joined #colonthree"
    });
});
rizonBot.on("part", (e) => {
    emitter.emit("message", {
        source: "Rizon",
        type: "action",
        nick: e.nick,
        message: `left #colonthree (${e.message})`
    });
});
rizonBot.on("kick", (e) => {
    emitter.emit("message", {
        source: "Rizon",
        type: "action",
        nick: e.kicked,
        message: `was kicked from #colonthree by ${e.nick} (${e.message})`
    });
});

const furnetBot = new irc.Client({
    nick: config.nick,
    username: config.user,
    gecos: config.realname,
    version: config.version,
    host: "irc.furnet.org",
    port: 6667
});
furnetBot.source = "Furnet";
furnetBot.connect();
furnetBot.on("registered", () => {
    furnetBot.say("NickServ", `IDENTIFY ${config.password}`);
    furnetBot.raw("MODE", config.nick, "+Bx");
});
furnetBot.on("message", (msg) => {
    if (msg.nick === "NickServ" && msg.message.startsWith("Password accepted")) {
        console.log("Furnet connected");
        furnetBot.join("#colonthree");
        furnetReady = true;
    }
    else if (msg.target === "#colonthree" && (msg.type === "privmsg" || msg.type === "action")) {
        emitter.emit("message", {
            source: "Furnet",
            type: msg.type,
            nick: msg.nick,
            message: msg.message
        });
    }
});
furnetBot.on("join", (e) => {
    if (e.nick !== config.nick) emitter.emit("message", {
        source: "Furnet",
        type: "action",
        nick: e.nick,
        message: "joined #colonthree"
    });
});
furnetBot.on("part", (e) => {
    emitter.emit("message", {
        source: "Furnet",
        type: "action",
        nick: e.nick,
        message: `left #colonthree (${e.message})`
    });
});
furnetBot.on("kick", (e) => {
    emitter.emit("message", {
        source: "Furnet",
        type: "action",
        nick: e.kicked,
        message: `was kicked from #colonthree by ${e.nick} (${e.message})`
    });
})

const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent
    ]
});

discordClient.on("ready", async () => {
    console.log("Discord connected");
    channel = await discordClient.channels.fetch(config.channel);
    discordReady = true;
});

discordClient.on("messageCreate", async (msg) => {
    if (msg.author.bot || (!msg.content && msg.attachments.size === 0) || msg.channelId !== config.channel) return;
    else if (msg.content.split("\n").length > 5 || msg.content.length > 1000) {
        const formData = new FormData();
        formData.append("file", new File([msg.content], `message-${msg.id}.txt`, { type: "text/plain" }));
        let response = await fetch("https://cdn.fl1nt.dev/api/files", {
            method: "POST",
            body: formData,
            headers: {
                Authorization: `Bearer ${config.fileToken}`,
                "X-File-Type": "text/plain"
            }
        }).then(res => res.json());
        msg.content = `Message paste: ${response.data.url}`;
    } 
    if (msg.attachments.size > 0) {
        if (msg.content) msg.content += " / ";
        let attachments = [];
        for (let attachment of msg.attachments) {
            let response = await fetch("https://cdn.fl1nt.dev/api/urls", {
                method: "POST",
                body: JSON.stringify({
                    url: attachment[1].url
                }),
                headers: {
                    Authorization: `Bearer ${config.fileToken}`,
                    "Content-Type": "application/json"
                }
            }).then(res => res.json());
            attachments.push(response.success ? `https://cdn.fl1nt.dev/u/${response.data.shortCode}` : attachment[1].url);
        }
        msg.content += `Attachment${attachments.length > 1 ? "s" : ""}: ` + attachments.join(" / ");
    }
    emitter.emit("message", {
        source: "Discord",
        nick: msg.author.displayName,
        type: "privmsg",
        message: msg.content
    });
});

discordClient.login(config.token);

emitter.on("message", (msg) => {
    if (!(rizonReady && discordReady && furnetReady)) return;
    let client = [rizonBot, furnetBot].filter(x => msg.source !== x.source);
    client.forEach(c => c.say("#colonthree", `[${colors.red(msg.source)}] ${msg.type === "privmsg" ? `<${colors.blue(msg.nick)}>` : `* ${colors.blue(msg.nick)}`} ${msg.message}`));
    if (msg.source !== "Discord") {
        channel.send(`[${msg.source}] ${msg.type === "privmsg" ? `<${msg.nick}>` : `* ${msg.nick}`} ${colors.stripColorsAndStyle(msg.message)}`);
    }
});