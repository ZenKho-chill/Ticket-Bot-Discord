const { SlashCommandBuilder } = require('@discordjs/builders');
const Discord = require("discord.js")
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'))
const utils = require("../../utils.js");
const guildModel = require("../../models/guildModel");

module.exports = {
  enabled: commands.General.Stats.Enabled,
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription(commands.General.Stats.Description),
  async execute(interaction, client) {
    await interaction.deferReply();
    let statsDB = await guildModel.findOne({ guildID: interaction.guild.id });

    const statsEmbed = new Discord.EmbedBuilder()
    statsEmbed.setTitle(config.Locale.guildStatistics)
    if (interaction.guild.iconURL()) statsEmbed.setThumbnail(interaction.guild.iconURL())
    statsEmbed.setColor(config.EmbedColors)

    statsEmbed.addFields([
      { name: `🎫 ${config.Locale.statsTickets}`, value: `> ${config.Locale.totalTickets} \`\`${statsDB.totalTickets.toLocaleString('vi')}\`\`\n> ${config.Locale.openTickets} \`\`${statsDB.openTickets}\`\`\n> ${config.Locale.totalClaims} \`\`${statsDB.totalClaims.toLocaleString('vi')}\`\`\n> ${config.Locale.totalMessagesLog} \`\`${statsDB.totalMessages.toLocaleString('vi')}\`\`\n> ${config.Locale.averageCompletionTime} \`\`${statsDB.averageCompletion}\`\`\n> ${config.Locale.averageResponseTime} \`\`${statsDB.averageResponse}\`\`` },
    ]);

    if (config.TicketReviewSettings.Enabled) {
      const averageRating = await utils.averageRating(client);

      statsEmbed.addFields([
        { name: `⭐ ${config.Locale.ratingsStats}`, value: `> ${config.Locale.totalReviews} \`\`${statsDB.totalReviews}\`\`\n > ${config.Locale.averageRating} \`\`${averageRating}/5.0\`\`` },
      ]);
    }

    if (config.SuggestionSettings.Enabled) statsEmbed.addFields([
      { name: `💡 ${config.Locale.suggestionStatsTitle}`, value: `> ${config.Locale.suggestionsTotal} \`\`${statsDB.totalSuggestions}\`\`\n> ${config.Locale.suggestionsTotalUpvotes} \`\`${statsDB.totalSuggestionUpvotes}\`\`\n> ${config.Locale.suggestionsTotalDownvotes} \`\`${statsDB.totalSuggestionDownvotes}\`\`` },
    ]);

    statsEmbed.setTimestamp()
    statsEmbed.setFooter({ text: `Yêu cầu bởi: ${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ dynamic: true })}` })
    interaction.editReply({ embeds: [statsEmbed] })

  }

}