const Discord = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))

module.exports = async (client, guild) => {
    if(!config.GuildID.includes(guild.id)) {
        guild.leave();
        console.log('\x1b[31m%s\x1b[0m', `[INFO] Ai đó đã mời bot vào máy chủ khác! Tôi đã tự động rời khỏi máy chủ đó (${guild.name})`)
    }
};
