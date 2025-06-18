const Discord = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const guildModel = require("../models/guildModel");

module.exports = async (client, interaction) => {

    // Thêm 1 vào totalClaims mỗi lần ticket được nhận
    const statsDB = await guildModel.findOne({ guildID: config.GuildID });
    statsDB.totalClaims++;
    await statsDB.save();

};