const { Discord, ActionRowBuilder, ButtonBuilder, EmbedBuilder, StringSelectMenuBuilder, Message, MessageAttachment, ModalBuilder, TextInputBuilder } = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const utils = require("../utils.js");
const guildModel = require("../models/guildModel");
const ticketModel = require("../models/ticketModel");
const reviewsModel = require("../models/reviewsModel");
const dashboardModel = require("../models/dashboardModel");

module.exports = async (client, interaction) => {

  const statsDB = await guildModel.findOne({ guildID: config.GuildID });
  const ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });
  const dashboardDB = await dashboardModel.findOne({ guildID: config.GuildID });

  async function CloseTicket() {
    const { attachment, timestamp } = await utils.saveTranscript(interaction)

    let ticketAuthor = await client.users.cache.get(ticketDB.userID)
    let closeUserID = await client.users.cache.get(ticketDB.closeUserID)
    let closeReason = ticketDB.closeReason || "Không có lý do.";
    let claimUser = await client.users.cache.get(ticketDB.claimUser)
    let totalMessages = ticketDB.messages

    const logEmbed = new EmbedBuilder()
    logEmbed.setColor("Red")
    logEmbed.setTitle("📩 Ticket đã được đóng")

    if (closeUserID) logEmbed.addFields([
      { name: `• Người đã đóng`, value: `> <@!${closeUserID.id}>\n> ${closeUserID.username}` },
    ])

    logEmbed.addFields([
      { name: `• Người tạo`, value: `> <@!${ticketAuthor.id}>\n> ${ticketAuthor.username}` },
    ])

    if (config.TicketSettings.TicketCloseReason && closeReason) logEmbed.addFields([
      { name: `• Lý do đóng`, value: `> ${closeReason}` },
    ])

    if (claimUser && config.ClaimingSystem.Enabled) logEmbed.addFields([
      { name: `• Tiếp nhận bởi`, value: `> <@!${claimUser.id}>\n> ${claimUser.username}` },
    ])

    logEmbed.addFields([
      { name: `• Thông tin Ticket`, value: `> #${interaction.channel.name}\n> ${ticketDB.ticketType}` },
    ])

    logEmbed.setTimestamp()
    logEmbed.setThumbnail(`https://cdn.discordapp.com/avatars/${interaction.user.id}/${interaction.user.avatar}.webp?size=240`)
    logEmbed.setFooter({ text: `Tổng số tin nhắn: ${totalMessages}`, iconURL: `https://cdn.discordapp.com/avatars/${interaction.user.id}/${interaction.user.avatar}.webp?size=240` })

    let closeLogMsgID;
    let logsChannel;
    if (!config.ticketClose.ChannelID) logsChannel = interaction.guild.channels.cache.get(config.TicketSettings.LogsChannelID);
    if (config.ticketClose.ChannelID) logsChannel = interaction.guild.channels.cache.get(config.ticketClose.ChannelID);

    const dashboardExists = await utils.checkDashboard();

    if (logsChannel && config.ticketClose.Enabled) {
      const embedOptions = { embeds: [logEmbed] };

      const shouldIncludeAttachment = totalMessages >= config.TicketTranscriptSettings.MessagesRequirement && !dashboardExists

      if (shouldIncludeAttachment) {
        embedOptions.files = [attachment];
      }

      // Nút "Xem Transcript" nếu có dashboard
      if (dashboardExists && totalMessages >= config.TicketTranscriptSettings.MessagesRequirement && config.TicketTranscriptSettings.TranscriptType === "HTML" && config.TicketTranscriptSettings.SaveInFolder === true) {
        const viewTranscriptButton = new ButtonBuilder()
          .setLabel("📑 Xem lịch sử đoạn chat")
          .setStyle('Link')
          .setURL(`${dashboardDB.url}/transcript?channelId=${ticketDB.channelID}&dateNow=${timestamp}`);

        const row = new ActionRowBuilder().addComponents(viewTranscriptButton);

        embedOptions.components = [row];
      }

      await logsChannel.send(embedOptions).then(async function (msg) {
        closeLogMsgID = msg.id;
      });
    }

    client.emit('sendUserDM', ticketDB, attachment, closeLogMsgID, timestamp);

    let dTime = config.TicketSettings.DeleteTime * 1000
    let deleteTicketCountdown = `🗑️ Ticket sẽ bị xóa sau **${config.TicketSettings.DeleteTime} giây**.`;
    const delEmbed = new EmbedBuilder()
      .setDescription(deleteTicketCountdown)
      .setColor("Red")

    const ticketDeleteButton = new ButtonBuilder()
      .setCustomId('closeTicket')
      .setLabel("🎟️ Đóng Ticket")
      .setStyle(config.ButtonColors.closeTicket)
      .setEmoji(config.ButtonEmojis.closeTicket)
      .setDisabled(true)

    let row1 = new ActionRowBuilder().addComponents(ticketDeleteButton);

    await interaction.channel.messages.fetch(ticketDB.msgID).then(msg => {
      msg.edit({ components: [row1] })
    })

    if (!interaction.dashboard) {
      if (interaction.customId === "closeReason") {
        if (interaction.deferred) await interaction.followUp({ embeds: [delEmbed] });
        if (!interaction.deferred) await interaction.reply({ embeds: [delEmbed] });
      } else {
        await interaction.followUp({ embeds: [delEmbed] });
      }
    } else if (interaction.dashboard) {
      await interaction.channel.send({ embeds: [delEmbed] });
    }

    setTimeout(async () => {
      await interaction.channel.delete().catch(e => { })
    }, dTime)

    let logMsg = `\n\n[${new Date().toLocaleString()}] [TICKET CLOSED] Một ticket đã được đóng thành công`;
    fs.appendFile("./logs.txt", logMsg, (e) => {
      if (e) console.log(e);
    });

  }

  CloseTicket()

};
