const { SlashCommandBuilder } = require('@discordjs/builders');
const { Discord, ActionRowBuilder, EmbedBuilder, MessageSelectMenu, Message, ContextMenuCommandBuilder, ApplicationCommadType, SnowflakeUtil } = require('discord.js');
const fs = require('fs');
const yaml = require('js-yaml')
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'))

module.exports = {
  enabled: config.SuggestionSettings.Enabled,
  data: new ContextMenuCommandBuilder()
  .setName("Accept Suggestion")
  .setType(ApplicationCommadType.Message)
}