const { SlashCommandBuilder } = require('@discordjs/builders');
const Discord = require("discord.js")
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'))
const utils = require("../../utils.js");
const ms = require('ms');
const ticketModel = require("../../models/ticketModel");

module.exports = {
  enabled: commands.Ticket.Alert.Enabled,
  data: new SlashCommandBuilder()
    .setName('alert')
    .setDescription(commands.Ticket.Alert.Description),
  async execute(interaction, client) {
    const ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });
    if (!ticketDB) return interaction.reply({ content: config.Locale.NotInTicketChannel, ephemeral: true })
    if (config.TicketAlert.Enabled === false) return interaction.reply({ content: "Lệnh này đã bị tắt trong tệp cấu hình!", ephemeral: true })


    let supportRole = await utils.checkIfUserHasSupportRoles(interaction)
    if (!supportRole) return interaction.reply({ content: config.Locale.NoPermsMessage, ephemeral: true })

    await interaction.deferReply()

    let ticketCreator = await client.users.cache.get(ticketDB.userID)

    function formatTimeDifference(msDifference) {
      const totalSeconds = Math.floor(msDifference / 1000);
      const days = Math.floor(totalSeconds / (24 * 3600));
      const hours = Math.floor((totalSeconds % (24 * 3600)) / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      const parts = [];
      if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
      if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
      if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);
      if (parts.length === 0 && seconds > 0) parts.push(`${seconds} second${seconds > 1 ? 's' : ''}`);

      const formattedTime = parts.join(', ') || 'just now';
      return formattedTime;
    }


    const lastMessageSent = ticketDB.lastMessageSent ? new Date(ticketDB.lastMessageSent) : new Date(ticketDB.ticketCreationDate);

    const now = new Date();
    const inactiveTime = formatTimeDifference(now - lastMessageSent);

    const ticketDeleteButton = new Discord.ButtonBuilder()
      .setCustomId('closeTicket')
      .setLabel(config.Locale.CloseTicketButton)
      .setStyle(config.ButtonColors.closeTicket)
      .setEmoji(config.ButtonEmojis.closeTicket)

    let row = new Discord.ActionRowBuilder().addComponents(ticketDeleteButton);

    const ticketLinkButton = new Discord.ButtonBuilder()
      .setLabel("Xem Ticket")
      .setStyle("Link")
      .setURL(`https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}`);

    let row2 = new Discord.ActionRowBuilder().addComponents(ticketLinkButton);

    const durationInSeconds = Math.floor(ms(config.TicketAlert.Time) / 1000);
    const unixTimestamp = Math.floor(Date.now() / 1000) + durationInSeconds;

    let descLocale = config.TicketAlert.Message.replace(/{time}/g, `<t:${unixTimestamp}:R>`).replace(/{inactive-time}/g, inactiveTime);;
    const embed = new Discord.EmbedBuilder()
      .setColor(config.EmbedColors)
      .setDescription(descLocale)
      .setTimestamp()

    let DMdescLocale = config.TicketAlert.DMMessage.replace(/{time}/g, `<t:${unixTimestamp}:R>`).replace(/{server}/g, `${interaction.guild.name}`).replace(/{inactive-time}/g, inactiveTime);;
    const DMembed = new Discord.EmbedBuilder()
      .setColor(config.EmbedColors)
      .setDescription(DMdescLocale)
      .setTimestamp()

    if (config.TicketAlert.DMUser) try {
      await ticketCreator.send({ embeds: [DMembed], components: [row2] });
    } catch (e) {
      console.log('\x1b[33m%s\x1b[0m', "[INFO] Tôi đã cố gắng nhắn tin trực tiếp cho một người dùng nhưng tin nhắn trực tiếp của họ đã bị khóa.");
      let logMsg = `\n\n[${new Date().toLocaleString()}] [ERROR] ${e.stack}`;
      await fs.appendFile("./logs.txt", logMsg, (e) => {
        if (e) console.log(e);
      });
    }

    interaction.editReply({ content: `<@!${ticketCreator.id}>`, embeds: [embed], components: [row], fetchReply: true }).then(async function (msg) {

      try {
        const filter = { channelID: interaction.channel.id };
        const update = {
          closeNotificationTime: Date.now(),
          closeNotificationMsgID: msg.id,
          closeNotificationUserID: interaction.user.id,
          channelID: interaction.channel.id,
          closeUserID: interaction.user.id,
          closeReason: "Tự động đóng sau khi hết thời gian mà không có phản hồi (Lệnh cảnh báo)"
        };

        const options = { upsert: true, new: true, setDefaultsOnInsert: true };

        await ticketModel.findOneAndUpdate(filter, update, options);

      } catch (error) {
        console.error('Lỗi khi cập nhật ticket:', error);
      }
    })
  }

}