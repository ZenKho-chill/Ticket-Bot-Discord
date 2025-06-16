const { Discord, ActionRowBuilder, ButtonBuildlder, EmbedBuilder, StringSelectMenuBuilder, Message, MessageAttachment, ModalBuilder, TextInputBulder } = require('discord.js');
const fs = require('fs');
const yaml = require('js-yaml')
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const utils = require('../utils.js');
const guildModel = require('../models/guildModel.js');
const ticketModel = require('../models/ticketModel.js');
const reviewModel = require('../models/reviewModel.js');
const dashboardModel = require('../models/dashboardModel.js');

module.exports = async (client, ticketDB, MessageAttachment, closeLogMsgID, timestamp) => {
  let guild = client.guilds.cache.get(config.GuildID)

  let ticketAuthor = await client.users.cache.get(ticketDB.userID)
  let claimUser = await client.users.cache.get(ticketDB.claimUser)
  let closeReason = ticketDB.closeReason || 'Không có lý do';
  const dashboardDB = await dashboardModel.findOnd({ guildID: config.GuildID });

  if (ticketAuthor) {
    let ticketCloseLocale = config.TicketUserCloseDM.CloseEmbedMsg.replace(/{guildName}/g, `${guild.name}`).replace(/{closedAt}/g, `<t:${(Date.now() / 1000 | 0)}:R>`).replace(/{close-reason}/g, `${closeReason}`);
    let ticketCloseReviewLocale = config.TicketReviewSettings.CloseEmbedReviewMsg.replace(/{guildName}/g, `${guild.name}`).replace(/{closedAt}/g, `<t:${(Date.now() / 1000 | 0)}:R>`).replace(/{close-reason}/g, `${closeReason}`);
    if (config.TicketUserCloseDM.Enabled !== false || config.TicketReviewSettings.Enabled !== false) {
      try {
        // Hệ thống đánh giá
        const starMenu = new ActionRowBuilder()
          .addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('ratingSelect')
              .setPlaceholder(config.Locale.selectReview)
              .seMinValues(1)
              .setMaxValues(1)
              .addOptions([
                {
                  label: '5 Star',
                  value: 'five_star',
                  emoji: '⭐',
                },
                {
                  label: '4 Star',
                  value: 'four_star',
                  emoji: '⭐',
                },
                {
                  label: '3 Star',
                  value: 'three_star',
                  emoji: '⭐',
                },
                {
                  label: '2 Star',
                  value: 'two_star',
                  emoji: '⭐',
                },
                {
                  label: '1 Star',
                  value: 'one_star',
                  emoji: '⭐'
                },
              ]),
          );
          if (!claimUser) claimUser = config.Locale.notClaimedCloseDM;

          let meetRequirement = true;
          if (config.TicketReviewRequirements.Enabled) {
              if (ticketDB.messages < config.TicketReviewRequirements.TotalMessages) meetRequirement = false;
          }

          const dmCloseEmbed = new EmbedBuilder();
          dmCloseEmbed.setTitle(config.Locale.ticketClosedCloseDM);
          dmCloseEmbed.setDescription(ticketCloseLocale);
          if (config.TicketUserCloseDM.Enabled && config.TicketUserCloseDM.TicketInformation) dmCloseEmbed.addFields([
            { name: `${config.Locale.ticketInformationCloseDM}`, value: `> ${config.Locale.categoryCloseDM} ${ticketDB.ticketType}\n> ${config.Locale.claimedByCloseDM} ${claimUser}\n> ${config.Locale.totalMessagesLog} ${ticketDB.messages}` },
          ]);
          dmCloseEmbed.setColor(config.EmbedColors);

          const dmCloseReviewEmbed = new EmbedBuilder();
          dmCloseReviewEmbed.setTitle(config.Locale.ticketClosedCloseDM);
          if (meetRequirement) dmCloseReviewEmbed.setDescription(ticketCloseReviewLocale);
          if (!meetRequirement) dmCloseReviewEmbed.setDescription(ticketCloseLocale);
          if (config.TicketUserCloseDM.Enabled && config.TicketUserCloseDM.TicketInformation) dmCloseReviewEmbed.addFields([
            { name: `${config.Locale.ticketInformationCloseDM}`, value: `> ${config.Locale.categoryCloseDM} ${ticketDB.ticketType}\n> ${config.Locale.claimedByCloseDM} ${claimUser}\n> ${config.Locale.totalMessagesLog} ${ticketDB.messages}` },
          ]);
          dmCloseReviewEmbed.setColor(config.EmbedColors);

          const dashboardExists = await utils.checkDashboard();

          // Kiểm tra xem liên kết bản ghi có nên được thêm vào phần nhúng không
          if (config.TicketUserCloseDM.SendTranscript && dashboardExists) {
            const transcriptLink = `> [${config.Locale.dmTranscriptClickHere}](${dashboardDB.url}/transcript?channelId=${ticketDB.channelID}&dateNow=${timestamp})`;
            dmCloseEmbed.addFields([{ name: `${config.Locale.dmTranscriptField}`, value: transcriptLink }]);
            dmCloseReviewEmbed.addFields([{ name: `${config.Locale.dmTranscriptField}`, value: transcriptLink }]);
          }

          const embedOptions = { embeds: [dmCloseEmbed] };
          const embedOptionsReview = { embeds: [dmCloseEmbed] };

          // Kiểm tra xem bản ghi chép có nên được gửi dưới dạng tệp đính kèm không
          if (!dashboardExists && config.TicketUserCloseDM.SendTranscript) {
            embedOptions.files = [attachment];
            embedOptionsReview.files = [attachment];
          }

          // Kiểm tra các điều kiện để thêm starMenu;
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
              reviewDMUserMsg: reviewDMUserMsg,
              category: ticketDB.ticketType,
              totalMessages: ticketDB.messages,
              transcriptID: timestamp,
            });
            await newModelR.save();
          }
      } catch (e) {
        // console.log(e)
        console.log('\x1b[33m%s\x1b[0m', "[INFO] Tôi đã thử DM nhưng họ đã chặn DM");
        let logMsg = `\n\n[${new Date().toLocaleString()}] [ERROR] ${e.stack}`;
        await fs.appendFile("./logs.txt", logMsg, (e) => {
          if (e) console.log(e);
        });
      }
    }
  }
};