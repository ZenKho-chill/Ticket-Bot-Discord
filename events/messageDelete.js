const { Discord, EmbedBuilder } = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const color = require('ansi-colors');
const utils = require("../utils.js");
const guildModel = require("../models/guildModel");
const suggestionModel = require("../models/suggestionModel");

module.exports = async (client, message) => {

    // Kiểm tra xem tin nhắn bị xoá có nằm trong cơ sở dữ liệu góp ý không, nếu có thì xoá nó khỏi cơ sở dữ liệu
    const suggestion = await suggestionModel.findOne({ msgID: message.id });
    if (suggestion) await suggestionModel.findOneAndDelete({ msgID: message.id });

}
