const { Discord, StringSelectMenuBuilder, EmbedBuilder, ActionRowBuilder, TextInputBuilder, ModalBuilder } = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const guildModel = require("../models/guildModel");
const ticketModel = require("../models/ticketModel");
const moment = require('moment-timezone');

const MAX_RETRIES = 2;
const RETRY_DELAY = 3000;

module.exports = async (client, interaction, channel, buttonConfig) => {
    try {
        const ticket = await ticketModel.findOne({ channelID: channel.id });
        if (!ticket) {
            console.error('Không tìm thấy ticket cho kênh:', channel.id);
            return;
        }

        const statsDB = await guildModel.findOne({ guildID: config.GuildID });
        statsDB.totalTickets++;
        await statsDB.save();

        const openNow = await ticketModel.countDocuments({ status: 'Open', guildID: config.GuildID });
        if (statsDB.openTickets !== openNow) {
            statsDB.openTickets = openNow;
            await statsDB.save();
        }

        // Cảnh báo nếu quá giới hạn ticket
        if (config.TicketOverload?.Enabled && openNow >= config.TicketOverload.Threshold) {
            const overloadEmbed = new EmbedBuilder()
                .setColor("Yellow")
                .setDescription("⚠️ Hệ thống đang có quá nhiều ticket mở. Vui lòng kiên nhẫn chờ hỗ trợ.")
                .setFooter({
                    text: interaction.user.username,
                    iconURL: interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 }),
                })
                .setTimestamp();

            await channel.send({ embeds: [overloadEmbed] }).catch(console.error);
        }

        // Thông báo ngoài giờ làm việc nếu cần
        await handleWorkingHoursNotice(client, interaction, channel, config);

        if (!ticket.questions?.length) return;

        await updateTicketMessageWithRetry(channel, ticket, interaction, config);

    } catch (error) {
        console.error('Lỗi trong sự kiện ticketCreate:', error);
    }
};

async function updateTicketMessageWithRetry(channel, ticket, interaction, config, retryCount = 0) {
    try {
        const ticketMessage = await channel.messages.fetch(ticket.msgID);
        if (!ticketMessage) {
            console.error('Không tìm thấy tin nhắn ticket gốc');
            return;
        }

        const originalEmbed = ticketMessage.embeds[0];
        if (!originalEmbed) {
            console.error('Không có embed trong tin nhắn gốc');
            return;
        }

        const updatedEmbed = EmbedBuilder.from(originalEmbed);

        ticket.questions.forEach(question => {
            updatedEmbed.addFields({
                name: question.question,
                value: question.response ? `\`\`\`${question.response}\`\`\`` : `\`\`\`${config.Locale.notAnswered || "Chưa trả lời"}\`\`\``,
                inline: false
            });
        });

        await ticketMessage.edit({ embeds: [updatedEmbed] });
    } catch (error) {
        console.error(`Lỗi cập nhật ticket (lần thử ${retryCount + 1}/${MAX_RETRIES}):`, error);

        if (retryCount < MAX_RETRIES - 1) {
            console.log(`Thử lại sau ${RETRY_DELAY}ms...`);
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            return updateTicketMessageWithRetry(channel, ticket, interaction, config, retryCount + 1);
        } else {
            console.error('Không thể cập nhật ticket sau nhiều lần thử.');
        }
    }
}

async function handleWorkingHoursNotice(client, interaction, channel, config) {
    if (!config.WorkingHours?.Enabled || !config.WorkingHours.AllowTicketsOutsideWorkingHours || !config.WorkingHours.SendNoticeInTicket) {
        return;
    }

    const currentTime = moment().tz(config.WorkingHours.Timezone);
    const currentDay = currentTime.format('dddd');
    const workingHours = config.WorkingHours.Schedule[currentDay];

    if (!workingHours) return;

    const [startTime, endTime] = workingHours.split('-');
    const isWithinHours = currentTime.isBetween(
        moment.tz(`${currentTime.format('YYYY-MM-DD')} ${startTime}`, config.WorkingHours.Timezone),
        moment.tz(`${currentTime.format('YYYY-MM-DD')} ${endTime}`, config.WorkingHours.Timezone)
    );

    if (!isWithinHours) {
        const workingHoursEmbed = new EmbedBuilder()
            .setTitle(config.WorkingHours.outsideWorkingHoursTitle || "⏰ Ngoài giờ làm việc")
            .setColor("Red")
            .setDescription(config.WorkingHours.outsideWorkingHoursMsg || "Hiện tại bạn đang tạo ticket ngoài giờ làm việc. Hãy kiên nhẫn chờ đợi, chúng tôi sẽ phản hồi sớm nhất có thể.")
            .setFooter({
                text: interaction.user.username,
                iconURL: interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })
            })
            .setTimestamp();

        await channel.send({ embeds: [workingHoursEmbed] }).catch(console.error);
    }
}
