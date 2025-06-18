const { Discord, ActionRowBuilder, ButtonBuilder, EmbedBuilder, StringSelectMenuBuilder, Message, MessageAttachment, ModalBuilder, TextInputBuilder } = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const utils = require("../utils.js");
const guildModel = require("../models/guildModel");
const ticketModel = require("../models/ticketModel");
const reviewsModel = require("../models/reviewsModel");
const dashboardModel = require("../models/dashboardModel");

module.exports = async (client, ticketDB, attachment, closeLogMsgID, timestamp) => {

    let guild = client.guilds.cache.get(config.GuildID)

    let ticketAuthor = await client.users.cache.get(ticketDB.userID)
    let claimUser = await client.users.cache.get(ticketDB.claimUser)
    let closeReason = ticketDB.closeReason || "Không có lý do.";
    const dashboardDB = await dashboardModel.findOne({ guildID: config.GuildID });

    if (ticketAuthor) {
        let ticketCloseLocale = config.TicketUserCloseDM.CloseEmbedMsg
            .replace(/{guildName}/g, `${guild.name}`)
            .replace(/{closedAt}/g, `<t:${(Date.now() / 1000 | 0)}:R>`)
            .replace(/{close-reason}/g, `${closeReason}`);

        let ticketCloseReviewLocale = config.TicketReviewSettings.CloseEmbedReviewMsg
            .replace(/{guildName}/g, `${guild.name}`)
            .replace(/{closedAt}/g, `<t:${(Date.now() / 1000 | 0)}:R>`)
            .replace(/{close-reason}/g, `${closeReason}`);

        if (config.TicketUserCloseDM.Enabled !== false || config.TicketReviewSettings.Enabled !== false) {
            try {
                // Hệ thống đánh giá
                const starMenu = new ActionRowBuilder()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId('ratingSelect')
                            .setPlaceholder("🌟 Vui lòng chọn số sao để đánh giá")
                            .setMinValues(1)
                            .setMaxValues(1)
                            .addOptions([
                                {
                                    label: '5 Sao - Tuyệt vời',
                                    value: 'five_star',
                                    emoji: '⭐',
                                },
                                {
                                    label: '4 Sao - Tốt',
                                    value: 'four_star',
                                    emoji: '⭐',
                                },
                                {
                                    label: '3 Sao - Tạm ổn',
                                    value: 'three_star',
                                    emoji: '⭐',
                                },
                                {
                                    label: '2 Sao - Kém',
                                    value: 'two_star',
                                    emoji: '⭐',
                                },
                                {
                                    label: '1 Sao - Rất tệ',
                                    value: 'one_star',
                                    emoji: '⭐',
                                },
                            ]),
                    );

                if (!claimUser) claimUser = "Không có người tiếp nhận";

                let meetRequirement = true;
                if (config.TicketReviewRequirements.Enabled) {
                    if (ticketDB.messages < config.TicketReviewRequirements.TotalMessages) meetRequirement = false;
                }

                const dmCloseEmbed = new EmbedBuilder();
                dmCloseEmbed.setTitle("📩 Ticket đã đóng");
                dmCloseEmbed.setDescription(ticketCloseLocale);
                if (config.TicketUserCloseDM.Enabled && config.TicketUserCloseDM.TicketInformation) dmCloseEmbed.addFields([
                    {
                        name: "Thông tin Ticket",
                        value: `> Loại: ${ticketDB.ticketType}\n> Người xử lý: ${claimUser}\n> Tổng số tin nhắn: ${ticketDB.messages}`
                    },
                ]);
                dmCloseEmbed.setColor(config.EmbedColors);

                const dmCloseReviewEmbed = new EmbedBuilder();
                dmCloseReviewEmbed.setTitle("📩 Ticket đã đóng");
                if (meetRequirement) dmCloseReviewEmbed.setDescription(ticketCloseReviewLocale);
                else dmCloseReviewEmbed.setDescription(ticketCloseLocale);
                if (config.TicketUserCloseDM.Enabled && config.TicketUserCloseDM.TicketInformation) dmCloseReviewEmbed.addFields([
                    {
                        name: "Thông tin Ticket",
                        value: `> Loại: ${ticketDB.ticketType}\n> Người xử lý: ${claimUser}\n> Tổng số tin nhắn: ${ticketDB.messages}`
                    },
                ]);
                dmCloseReviewEmbed.setColor(config.EmbedColors);

                const dashboardExists = await utils.checkDashboard();

                // Nếu có dashboard thì chèn link transcript
                if (config.TicketUserCloseDM.SendTranscript && dashboardExists) {
                    const transcriptLink = `> [Nhấn vào đây để xem lịch sử đoạn chat](${dashboardDB.url}/transcript?channelId=${ticketDB.channelID}&dateNow=${timestamp})`;
                    dmCloseEmbed.addFields([{ name: "📑 Lịch sử đoạn chat", value: transcriptLink }]);
                    dmCloseReviewEmbed.addFields([{ name: "📑 Lịch sử đoạn chat", value: transcriptLink }]);
                }

                const embedOptions = { embeds: [dmCloseEmbed] };
                const embedOptionsReview = { embeds: [dmCloseReviewEmbed] };

                // Nếu không có dashboard thì gửi transcript dạng file đính kèm
                if (!dashboardExists && config.TicketUserCloseDM.SendTranscript) {
                    embedOptions.files = [attachment];
                    embedOptionsReview.files = [attachment];
                }

                // Nếu được phép đánh giá và đủ điều kiện thì thêm hệ thống đánh giá
                if (config.TicketReviewSettings.Enabled && meetRequirement) {
                    embedOptionsReview.components = [starMenu];
                }

                let reviewDMUserMsg;

                if (config.TicketReviewSettings.Enabled) {
                    await ticketAuthor.send(embedOptionsReview).then(async function (msg) {
                        reviewDMUserMsg = msg.id;
                    });
                } else if (config.TicketUserCloseDM.Enabled) {
                    await ticketAuthor.send(embedOptions)
                }

                if (config.TicketReviewSettings.Enabled) {
                    const newModelR = new reviewsModel({
                        ticketCreatorID: ticketAuthor.id,
                        guildID: config.GuildID,
                        ticketChannelID: ticketDB.channelID,
                        userID: ticketAuthor.id,
                        tCloseLogMsgID: closeLogMsgID,
                        reviewDMUserMsgID: reviewDMUserMsg,
                        category: ticketDB.ticketType,
                        totalMessages: ticketDB.messages,
                        transcriptID: timestamp,
                    });
                    await newModelR.save();
                }
            } catch (e) {
                console.log('\x1b[33m%s\x1b[0m', "[THÔNG BÁO] Đã cố gắng gửi tin nhắn DM, nhưng người dùng đã tắt tin nhắn riêng.");
                let logMsg = `\n\n[${new Date().toLocaleString()}] [LỖI] ${e.stack}`;
                await fs.appendFile("./logs.txt", logMsg, (e) => {
                    if (e) console.log(e);
                });
            }
        }
    }

};
