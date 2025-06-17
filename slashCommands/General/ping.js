const { SlashCommandBuilder } = require('@discordjs/builders');
const Discord = require('discord.js')
const fs = require('fs');
const yaml = require('js-yaml');
const { enabled } = require('./help');
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'))

module.exports = {
  enabled: commands.General.Ping.Enabled,
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription(commands.General.Ping.Description),
  async execute(interaction, client) {
    await interaction.deferReply();

    const ping = new Discord.EmbedBuilder()
      .setTitle('🏓 Pong!')
      .setColor(config.EmbedColors)
      .addFields([
        { name: 'Ping', value: client.ws.ping +'ms' },
        { name: 'Latency', value: `${Date.now() - interaction.createdTimestamp}ms` },
      ])
      .setTimestamp()
      .setFooter({ text: `Requested by: ${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ dynamic: true })}` })
    interaction.editReply({ embeds: [ping] })
  }
}