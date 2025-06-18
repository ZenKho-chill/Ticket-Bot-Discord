const Discord = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const ticketModel = require("../models/ticketModel");

module.exports = async (client, member) => {

    try {
        // Truy vấn cơ sở dữ liệu để tìm các ticket đang mở của thành viên rời đi
        const userOpenTickets = await ticketModel.find({ userID: member.id, status: 'Đang mở' });
    
        for (const ticket of userOpenTickets) {
          // Cập nhật ticket và gửi embed
          const logsChannel = member.guild.channels.cache.get(ticket.channelID);
    
          const ticketDeleteButton = new Discord.ButtonBuilder()
            .setCustomId('deleteTicket')
            .setLabel(config.Locale.deleteTicketButton)
            .setEmoji(config.ButtonEmojis.deleteTicket)
            .setStyle(config.ButtonColors.deleteTicket);
    
          const row = new Discord.ActionRowBuilder().addComponents(ticketDeleteButton);
    
          // Cập nhật lý do đóng và gửi embed
          await ticketModel.findOneAndUpdate(
            { channelID: ticket.channelID },
            { closeReason: 'Người dùng đã rời khỏi máy chủ' }
          );
    
          const userLeftDescLocale = config.Locale.userLeftDescription.replace(/{username}/g, `${member.user.username}`);
          const embed = new Discord.EmbedBuilder()
            .setColor(config.EmbedColors)
            .setTitle(config.Locale.userLeftTitle)
            .setDescription(userLeftDescLocale)
            .setFooter({ text: `${member.user.username}`, iconURL: `${member.user.displayAvatarURL({ dynamic: true })}` })
            .setTimestamp();
    
          logsChannel.send({ embeds: [embed], components: [row] });
        }
      } catch (error) {
        console.error('Lỗi khi xử lý sự kiện thành viên rời khỏi máy chủ:', error);
      }

};
