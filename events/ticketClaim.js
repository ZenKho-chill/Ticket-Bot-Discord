const Discord = require('discord.js');
const fs = require('fs');
const yaml = require('js-yaml')
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const guildModel = require('../models/guildModel.js');

module.exports = async (client, interaction) => {
  const statsDB = await guildModel.findOne({ guildID: config.guildID });
  statsDB.totalClaims++;
  await statsDB.save();
}