const { SlashCommandBuilder } = require('@discordjs/builders');
const { Discord, EmbedBuilder } = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'))
const utils = require("../../utils.js");
const ticketModel = require("../../models/ticketModel");

module.exports = {
  enabled: commands.Ticket.Close.Enabled,
  data: new SlashCommandBuilder()
    .setName('close')
    .setDescription(commands.Ticket.Close.Description)
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Lý do đóng ticket')
        .setRequired(config.TicketSettings.TicketCloseReason)
    ),
  async execute(interaction, client) {
    await interaction.deferReply({ ephemeral: true });
    const ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });
    if (!ticketDB) return interaction.editReply({ content: config.Locale.NotInTicketChannel, ephemeral: true })

    let supportRole = await utils.checkIfUserHasSupportRoles(interaction)

    if (config.TicketSettings.RestrictTicketClose && !supportRole) {
      return interaction.editReply({ content: config.Locale.restrictTicketClose, ephemeral: true });
    }

    let closeReason = interaction.options.getString('reason') || "Không có lý do được cung cấp";

    await ticketModel.updateOne(
      { channelID: interaction.channel.id },
      {
        $set: {
          closeUserID: interaction.user.id,
          closedAt: Date.now(),
          closeReason: closeReason
        }
      }
    );

    await client.emit('ticketClose', interaction);

  }

}