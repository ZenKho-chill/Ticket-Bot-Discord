const { Discord, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const yaml = require('js-yaml')
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const color = require('ansi-colors');
const utils = require('../utils.js');
const guildModel = require('../models/guildModel.js');
const suggestionModel = require('../models/suggestionModel.js');
const client = require('..');

module.exports = async (client, message) => {
  // Kiểm tra nếu tin nhắn đã xóa ở trong database, nếu tồn tại, xóa nó khỏi database
  const suggestion = await suggestionModel.findOne({ msgID: message.id });
  if (suggestion) await suggestionModel.findOneAndDelete({ msgID: message.id });
}