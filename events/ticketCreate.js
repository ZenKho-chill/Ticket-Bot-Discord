const { Discord, StringSelectMenuBuilder, EmbedBuilder, ActionRowBuilder, TextInputBuilder, ModalBuilder } = require('discord.js');
const fs = require('fs');
const yaml = require('js-yaml')
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const guildModel = require('../models/guildModel.js');
const ticketModel = require('../models/ticketModel.js');
const moment = require('moment-timezone');

// Số lần thử lại tối đa để chỉnh sửa câu hỏi vào phiếu nhúng gốc
const MAX_RETRIES = 2;
// Độ trễ giữa các lần thử lại tính bằng mili giây
const RETRY_DELAY = 3000;

module.exports = async (client, interaction, channel, buttonConfig) => {
  try {
    const ticket = await ticketModel.findOne({ channelID: channel.id });
    if (!ticket) {
      console.error('Không tìm thấy ticket trong kênh này:', channel.id);
      return;
    }

    // Thêm 1 vào globalStats.totalTickets
    const statsDB = await guildModel.findOne({ guildID: config.GuildID });
    statsDB.totalTickets++;
    await statsDB.save();

    // Đồng bộ globalStats.openTickets
    const openNow = await ticketModel.countDocuments({ status: 'Open', guildID: config.GuildID });
    if (statsDB.openTickets !== openNow) {
      statsDB.openTickets = openNow;
      await statsDB.save();
    }

    // Xử lý quá tải ticket nếu được bật
    if (config.TicketOverload?.Enabled && openNow >= config.TicketOverload.Threshould) {
      const overloadEmbed = new EmbedBuilder()
        .setColor("Yellow")
        .setDescription(config.TicketOverload.WarningMessage)
        .setFooter({
          text: interaction.user.username,
          iconURL: interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 }),
        })
        .setTimestamp();

      await channel.send({ embeds: [overloadEmbed] }).catch(console.error);
    }

    // Xử lý giờ làm việc nếu được bật
    await handleWorkingHoursNotice(client, interaction, channel, config);

    // Xử lý câu hỏi ticket
    if (!ticket.question?.length) return;

    // Cố gắng cập nhật thông báo ticket bằng cách thử lại
    await updateTicketMessageWithRetry(channel, ticket, interaction, config);
  } catch (error) {
    console.error('Lỗi khi cố tạo ticketCreate:', error);
  }
};

async function updateTicketMessageWithRetry(channel, ticket, interaction, config, retryCount = 0) {
  try {
    // Lấy tin nhắn ticket
    const ticketMessage = await channel.messages.fetch(ticket.msgID);
    if (!ticketMessage) {
      console.error('Không thể tìm thấy tin nhắn ticket gốc');
      return;
    }

    const originalEmbed = ticketMessage.embeds[0];
    if (!originalEmbed) {
      console.error('Không tìm thấy embed trong tin nhắn gốc');
      return;
    }

    const updateEmbed = EmbedBuilder.from(originalEmbed);

    ticket.question.forEach(question => {
      updateEmbed.addFields({
        name: question.question,
        value: question.response ? `\`\`\`${question.response}\`\`\`` : `\`\`\`${config.Locale.notAnswered}\`\`\``,
        inline: false
      });
    });
    await ticketMessage.edit({ embeds: [updateEmbed] });
  } catch (error) {
    console.error(`Lỗi khi update tin nhắn ticket (lần: ${retryCount + 1}/${MAX_RETRIES}):`, error);

    // Nếu chúng ta chưa vượt quá số lần thử lại tối đa, hãy đợi và thử lại
    if (retryCount < MAX_RETRIES - 1) {
      console.log(`Thử lại sau ${RETRY_DELAY}ms...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return updateTicketMessageWithRetry(channel, ticket, interaction, config, retryCount + 1);
    } else {
      console.error('Lỗi khi cập nhật tin nhắn ticket với toàn bộ số lần thử');
    }
  }
}

async function handleWorkingHoursNotice(client, interaction, channel, config) {
  if (!config.WorkingHours?.Enabled || !config.WorkingHours.AllowTicketsOutsideWorkingHours || !config.WorkingHours.SendNoticeInTicket) {
    return;
  }

  const currentTime = moment().tz(config.WorkingHours.Timezone);
  const currentDay = currentTime.format('dddd');
  const WorkingHours = config.WorkingHours.Schedule[currentDay];

  if (!WorkingHours) return;

  const [startTime, endTime] = WorkingHours.split('-');
  const isWithinHours = currentDay.isBetween(
    moment.tz(`${currentTime.format('YYYY-MM-DD')} ${startTime}`, config.WorkingHours.Timezone),
    moment.tz(`${currentTime.format('YYYY-MM-DD')} ${endTime}`, config.WorkingHours.Timezone)
  );

  if (!isWithinHours) {
    const workingHoursEmbed = new EmbedBuilder()
      .setTitle(config.WorkingHours.outsideWorkingHoursTitle)
      .setColor("Red")
      .setDescription(config.WorkingHours.outsideWorkingHoursMsg)
      .setFooter({
        text: interaction.user.username,
        iconURL: interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })
      })
      .setTimestamp();

    await channel.send({ embeds: [workingHoursEmbed] }).catch(console.error);
  }
}