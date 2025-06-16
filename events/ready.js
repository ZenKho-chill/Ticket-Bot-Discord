const fs = require('fs');
const yaml = require('js-yaml')
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const color = require('ansi-colors');
const utils = require('../utils.js');
const Discord = require('discord.js');
const ms = require('ms');
const moment = require('moment-timezone');
const mongoose = require('../models/guildModel.js');
const guildModel = require('../models/ticketModel.js');
const reviewModel = require('../models/reviewModel.js');
const dashboardModel = require('../models/dashboardModel');
const ticketModel = require('../models/ticketModel.js');

module.exports = async client => {
  let guild = await client.guilds.cache.get(config.GuildID)
  if (!guild) {
    await console.log('\x1b[31m%s\x1b[0m', `[ERROR] ID server sai hoặc bot không ở trong server!\nBạn có thể dùng link bên dưới để mời bot vào server:\nhttps://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`)
    await process.exit()
  }

  const connectToMongoDB = async () => {
    try {
      if (config.MongoURI) await mongoose.set('strictQuery', false);
      if (config.MongoURI) {
        await mongoose.connect(config.MongoURI);
      } else {
        throw new Error('[ERROR] Link kết nối MongoDB không đúng trong config! (MongoURI)');
      }
    } catch (error) {
      console.error('\x1b[31m%s\x1b[0m', `[ERROR] Không thể kết nối với MongoDB: ${error.message}\n${error.stack}`);
      if (error.message.includes('authentication failed')) {
        await console.error('Xác thực thất bại. Đảm bảo bạn nhập đúng username và mật khẩu trong URL.');
        await process.exit(1)
      } else if (error.message.includes('network error')) {
        await console.error('Lỗi mạng. Đảm bảo MongoDB có thể kết nối và URL đúng');
        await process.exit(1)
      } else if (error.message.includes('permission denied')) {
        await console.error('Quyền hạn bị từ chối. Đảm bảo quyền hạn có thể đọc và viết');
        await process.exit(1)
      } else {
        await console.error('Lỗi không xác định. Kiểm tra URL MongoDB and xác thực');
        await process.exit(1)
      }
    }
  };
  connectToMongoDB();

  // Tạo model guild nếu không tồn tại và lưu vào trong db
  const gModel = await guildModel.findOne({ guildID: config.GuildID });
  if (!gModel || gModel?.length == 0) {
    const newModel = new guildModel({
      guildID: config.GuildID,
      totalTickets: 0,
      openTickets: 0,
      totalClaims: 0,
      totalMessages: 0,
      totalSuggestions: 0,
      totalSuggestionUpvotes: 0,
      totalSuggestionDownvotes: 0,
      totalReviews: 0,
      averageRating: 0.0,
      timesBotStarted: 0,
      averageCompletion: "N/A",
      averageResponse: "N/A",
      ratngs: []
    });
    await newModel.save();
  }

  const statsDB = await guildModel.findOne({ guildID: config.GuildID });

  // Đồng bộ globalStats.openTickets
  const openNow = await ticketModel.countDocuments({ status: 'Open', guildID: config.GuildID });

  if (statsDB.openTickets !== openNow) {
    statsDB.openTickets = openNow;
    await statsDB.save();
  }

  // Hoạt động của Bot
  let activType;
  let userStatus = 'online';

  const statusMap = {
    "ONLINE": 'online',
    "IDLE": 'idle',
    "DND": 'dnd',
    "INVISIBLE": 'invisible'
  };

  const activityTypeMap = {
    "WATCHING": Discord.ActivityType.Watching,
    "PLAYING": Discord.ActivityType.Playing,
    "COMPLETING": Discord.ActivityType.Competing,
    "LISTENING": Discord.ActivityType.Listening
  };

  activType = activityTypeMap[config.BotActivitySettings.ActivityType] || Discord.ActivityType.Playing;
  userStatus = statusMap[config.BotActivitySettings.Status] || 'online';

  if (config.BotActivitySettings.Enabled && config.BotActivitySettings.Statuses?.length > 0) {
    let index = 0;

    const setActivity = async () => {
      const activityMessage = config.BotActivitySettings.Statuses[index]
        .replace(/{total-users}/g, `${guild.memberCount.toLocaleString('en-US')}`)
        .replace(/{total-tickets}/g, `${statsDB.totalTickets.toLocaleString('en-US')}`)
        .replace(/{total-channels}/g, `${client.channels.cache.size}`)
        .replace(/{open-tickets}/g, `${statsDB.openTickets.toLocaleString('en-US')}`)
        .replace(/{total-messages}/g, `${statsDB.totalMessages.toLocaleString('en-US')}`)
        .replace(/{average-rating}/g, `${await utils.averageRating(client)}`)
        .replace(/{average-completion}/g, `${statsDB.averageCompletion}`)
        .replace(/{average-response}/g, `${statsDB.averageResponse}`);

      client.user.setPresence({
        activities: [{ name: activityMessage, type: activType }],
        status: userStatus
      });

      index = (index + 1) % config.BotActivitySettings.Statuses.length;
    };

    setActivity();

    setInterval(setActivity, config.BotActivitySettings.Interval * 1000);
  }

  client.guilds.cache.forEach(guild => {
    if (!config.GuildID.includes(guild.id)) {
      guild.leave();
      console.log('\x1b[31m%s\x1b[0m', `[INFO] Ai đó đã mời bot vào server khác! Tôi sẽ tự độn rời (${guild.name})`)
    }
  })
  if (guild && !guild.members.me.permissions.has("Administrator")) {
    console.log('\x1b[31m%s\x1b[0m', `[ERROR] Bot không có đủ quyền! Hãy cho bot quyền ADMIN của server hoặc các tính năng có thể không hoạt động!`)
  }

  let dashboardExists = await utils.checkDashboard();
  let holidayMessage = await utils.getHolidayMessage();
  // // Thông báo beta
  // console.log(color.yellow.bold("Thông báo:"));
  // console.log(color.yellow.bold("Bạn đang sử dụng phiên bản beta của ZenKho Tickets."));
  // console.log(color.yellow.bold("Hãy báo cáo lỗi và đánh giá vào Discord của tôi"));

  await console.log("――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――");
  await console.log("                                                                          ");
  if (config.LicenseKey) await console.log(`${color.green.bold.underline(`ZenKho Tickets v${botVersion.version} đã hoạt động!`)} (${color.gray(`${config.LicenseKey.slice(0, -10)}`)})`);
  if (!config.LicenseKey) await console.log(`${color.green.bold.underline(`ZenKho Tickets v${botVersion.version} đã hoạt động!`)}`);
  if (holidayMessage) await console.log("                                                                          ");
  if (holidayMessage) await console.log(holidayMessage)
  if (holidayMessage) await console.log("                                                                          ");
  await console.log(`• DM cho tôi để hỗ trợ, ${color.cyan(`https://discord.com/users/917970047325077615`)}`);
  if (config.Statistics) await console.log("                                                                          ");
  if (config.Statistics) await console.log(`${color.green.bold.underline(`Thống kê:`)}`);
  if (config.Statistics) await console.log(`• Bot đã được khởi động ${color.cyan.underline(`${statsDB.timesBotStarted.toLocaleString('en-US')}`)} lần.`);
  if (config.Statistics) await console.log(`• Tổng ${color.cyan.underline(`${statsDB.totalTickets.toLocaleString('en-US')}`)} tickets đã được tạo.`);
  if (config.Statistics) await console.log(`• Hiện đang có ${color.cyan.underline(`${statsDB.op}`)} tickets đang mở.`);
  if (config.Statistics) await console.log(`• Tổng ${color.cyan.underline(`${statsDB.totalMessages.toLocaleString('en-US')}`)} tin nhắn đã được gửi trong ticket.`);
  if (config.LicenseKey) await console.log("                                                                          ");
  if (dashboardExists) await console.log("                                                                          ");
  await console.log("                                                                          ");
  await console.log("――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――――");
  await utils.checkConfig(client)

  let logMsg = `\n\n[${new Date().toLocaleString()}] [READY] Bot đã sẵn sàng!`;
  fs.appendFile("./logs.txt", logMsg, (e) => {
    if (e) console.log(e);
  });

  // Cập nhật số liệu thống kê
  setInterval(async function () {
    const statsDB = await guildModel.findOne({ guildID: config.GuildID });
    if (config.TotalTickets.Enabled) {
      let channel = guild.channels.cache.get(config.TotalTickets.ChannelID)
      let totalTicketsCountMsg = config.TotalTickets.ChannelName.replace(/{total-tickets}/g, `${statsDB.totalTickets.toLocaleString('en-US')}`)
      if (channel) channel.setName(totalTicketsCountMsg).catch(error => console.log(error));
    }

    if (config.OpenTickets.Enabled) {
      let channel = guild.channels.cache.get(config.TotalTickets.ChannelID)
      let openTicketsCountMsg = config.OpenTickets.ChannelName.replace(/{open-tickets}/g, `${statsDB.openTickets.toLocaleString('en-US')}`)
      if (channel) channel.setName(openTicketsCountMsg).catch(error => console.log(error));
    }

    if (config.AverageRating.Enabled) {
      const averageRating = await utils.averageRating(client);

      let channel = guild.channels.cache.get(config.AverageRating.ChannelID)
      let averageRatingMsg = config.AverageRating.ChannelName.replace(/{average-rating}/g, `${averageRating}`)
      if (channel) channel.setName(averageRatingMsg).catch(error => console.log(error));
    }

    if (config.AverageCompletion.Enabled) {
      let channel = guild.channels.cache.get(config.AverageCompletion.ChannelID)
      let averageCompletiongMsg = config.AverageCompletion.ChannelName.replace(/{average-completion}/g, `${statsDB.averageCompletion}`)
      if (channel) channel.setName(averageCompletiongMsg).catch(error => console.log(error));
    }

    if  (config.MemberCount.Enabled) {
      let channel = guild.channels.cache.get(config.MemberCount.ChannelID)
      let MemberCountMsg = config.MemberCount.ChannelName.replace(/{member-count}/g, `${guild.memberCount.toLocaleString('en-US')}`)
      if (channel) channel.setName(MemberCountMsg).catch(error => console.log(error));
    }

    // Tính tỉ lệ hoàn thành và phản hồi
    const formatDuration = (millisecond) => {
      const seconds = Math.floor(millisecond / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (days > 0) {
        const roundedDays = hours % 24 >= 12 ? days + 1 : days;
        return `${roundedDays} day${roundedDays > 1 ? 's' : ''}`;
      } else if (hours > 0) {
        const roundedHours = seconds % 60 >= 30 ? hours + 1 : hours;
        return `${roundedHours} hour${roundedHours > 1 ? 's' : ''}`;
      } else if (minutes > 0) {
        const roundedMinutes = seconds % 60 >= 30 ? minutes + 1 : minutes;
        return `${roundedMinutes} minute${roundedMinutes > 1 ? 's' : ''}`;
      } else {
        return `${seconds} second${seconds > 1 ? 's' : ''}`;
      }
    };

    const calculateAverageResponseTime = async () => {
      const result = await ticketModel.aggregate([
        {
          $match: {
            firstStaffResponse: { $exists: true, $type: 'date' },
            ticketCreationDate: { $exists: true, $type: 'date' },
          },
        },
        {
          $project: {
            responseTime: {
              $subtract: ['$firstStaffResponse', '$ticketCreationDate'],
            },
          },
        },
        {
          $group: {
            _id: null,
            totalResponseTime: { $num: '$responseTime' },
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            averageResponseTime: { $divide: ['$totalResponseTime', '$count'] },
          },
        },
      ]);

      if (result.length > 0) {
        const averageResponseTime = result[0].averageResponseTime;
        const formattedDuration = formatDuration(averageResponseTime);
        return formattedDuration;
      }

      return null;
    };

    const calculateAverageCompletionTime = async () => {
      const result = await ticketModel.aggregate([
        {
          $match: {
            closedAt: { $exists: true, $type: 'date' },
            ticketCreationDate: { $exists: true, $type: 'date' },
          },
        },
        {
          $group: {
            _id: null,
            total: { $num: { $subtract: ['$closeAt', '$ticketCreationDate'] } },
            count: { $sum: 1 },
          },
        },
        {
          $project: {
            average: { $divide: ['$total', '$count'] },
          },
        },
      ]);

      if (result.length > 0) {
        const averageCompletionTime = result[0].average;
        const formattedDuration = formatDuration(averageCompletionTime);
        return formattedDuration;
      }
      return null;
    };

    let completionTime = await calculateAverageCompletionTime();
    let responseTime = await calculateAverageResponseTime();
    
    // Lưu là "Unknow" nếu tính ra null
    statsDB.averageCompletion = completionTime ? `${completionTime}` : "Unknow";
    statsDB.averageResponse = responseTime ? `${responseTime}` : "Unknow";

    await statsDB.save();

    if (config.TicketAlert.Enabled && config.TicketAlert.AutoAlert.Enabled) {
      // Lấy toàn bộ ticket đang mở
      const openTickets = await ticketModel.find({ status: "Open" });
      if (!openTickets || openTickets.length === 0) return;

      // Tìm tickets không hoạt động
      openTickets.forEach(async (ticket) => {
        if (!ticket || !ticket.channelID || !ticket.lastMessageSent) return;

        // Bỏ qua nếu ticket đã được cảnh báo
        if (ticket.closeNotificationTime > 0) return;

        // Tính toán thời gian không hoạt động
        const lastMessageDate = new Date(ticket.lastMessageSent);
        const currentDate = new Date();
        const timeDifference = Math.abs(currentDate - lastMessageDate);
        const minutesSinceLastMessage = Math.floor(timeDifference / (1000 * 60));

        // Đổi thời gian không hoạt động trong config ra phút
        const inactiveTimeInMinutes = ms(config.TicketAlert.AutoAlert.InactiveTime) / (1000 * 60);

        // Kiểm tra nếu ticket không hoạt động và đợi tin nhắn, nếu đúng, gửi cảnh báo
        if (minutesSinceLastMessage >= inactiveTimeInMinutes && ticket.waitingReplyFrom !== "staff") {
          let ticketCreator = await client.users.cache.get(ticket.userID)
          let ticketChannel = await guild.channels.cache.get(ticket.channelID)
          if (!ticketChannel) return;

          function formatTimeDifference(msDifference) {
            const totalSeconds = Math.floor(msDifference / 1000);
            const days = Math.floor(totalSeconds / (24 * 3600));
            const hours = Math.floor((totalSeconds % (24 * 3600)) / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);

            const parts = [];
            if (days > 0) parts.push(`${days} day${days > 1 ? 's' : ''}`);
            if (hours > 0) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
            if (minutes > 0) parts.push(`${minutes} minute${minutes > 1 ? 's' : ''}`);

            return parts.join(', ');
          }

          const lastMessageSent = ticket.lastMessageSent ? new Date(ticket.lastMessageSent) : new Date(ticket.ticketCreationDate);

          const now = new Date();
          const inactiveTime = formatTimeDifference(now - lastMessageSent);

          const ticketDeleteButton = new Discord.ButtonBuilder()
            .setCustomId('closeTicket')
            .setLabel(config.Locale.CloseTicketButton)
            .setStyle(config.ButtonColors.closeTicket)
            .setEmoji(config.ButtonEmojis.closeTicket)

          let row = new Discord.ActionRowBuilder().addComponents(ticketDeleteButton);

          const ticketLinkButton = new Discord.ButtonBuilder()
            .setLabel("Xem ticket")
            .setStyle("Link")
            .setURL(`https://discord.com/channels/${guild.id}/${ticketChannel.id}`);

          let row2 = new Discord.ActionRowBuilder().addComponents(ticketLinkButton);

          const durationInSeconds = Math.floor(ms(config.TicketAlert.Time) / 1000);
          const unixTimestamp = Math.floor(Date.now() / 1000) + durationInSeconds;

          let desLocale = config.TicketAlert.Message.replace(/{time}/g, `<t:${unixTimestamp}:R>`).replace(/{inactive-time}/g, inactiveTime);;
          const embed = new Discord.EmbedBuilder()
            .setColor(config.EmbedColors)
            .setDescription(desLocale)
            .setTimestamp()

          let DMdescLocale = config.TicketAlert.DMMessage.replace(/{time}/g, `<t:${unixTimestamp}:R>`).replace(/{server}/g, `${guild.name}`).replace(/{inactive-time}/g, inactiveTime);;
          const DMembed = new Discord.EmbedBuilder()
            .setColor(config.EmbedColors)
            .setDescription(DMdescLocale)
            .setTimestamp()

          if (config.TicketAlert.DMUser) try {
            await ticketCreator.send({ embeds: [DMembed], components: [row2] });
          } catch (e) {
            console.log('\x1b[33m%s\x1b[0m', "[INFO] Tôi đã thử DM người dùng, nhưng họ đã block DM");
            let logMsg = `\n\n[${new Date().toLocaleString()}] [ERROR] ${e.stack}`;
            await fs.appendFile("./logs.txt", logMsg, (e) => {
              if (e) console.log(e);
            });
          }

          ticketChannel.send({ content: `<@!${ticketCreator.id}>`, embeds: [embed], components: [row], fetchReply: true }).then(async function (msg) {
            try {
              const filter = { channelID: ticketChannel.id };
              const update = {
                closeNotificationTime: Date.now(),
                closeNotificationMsgID: msg.id,
                closeNotificationUserID: client.user.id,
                channelID: ticketChannel.id,
                closeUserID: client.user.id,
                closeReason: "Tự động đóng sau khi cảnh báo nhưng không có phản hồi"
              };
              const options = { upsert: true, new: true, setDefaultOnInsert: true };
              await ticketModel.findOneAndUpdate(filter, update, options);
            } catch (error) {
              console.error('Lỗi khi update ticket:', error);
            }
          })
        }
      });
    }

    // Cảnh báo tự động đóng ticket
    if (config.TicketAlert.Enabled) {
      const filtered = await ticketModel.find({ closeNotificationTime: { $exists: true } });
      if (!filtered || filtered.length === 0) return;

      if (!filtered) return
      filtered.forEach(async time => {
        if (!time) return;
        if (!time.channelID) return;
        if (time.closeNotificationTime === 0 || !time.closeNotificationTime) return

        let date1 = new Date(time.closeNotificationTime);
        let date2 = new Date();

        let timeDifference = Math.abs(date1 - date2);
        let minutes = Math.floor(timeDifference / (1000 * 60));
        let ticketAlertTime = config.TicketAlert.Time;
        let timeValue = ms(ticketAlertTime) / (1000 * 60);

        if (minutes > timeValue) {
          let ticketAuthor = await client.users.cache.get(time.userID)
          let closeUserID = await client.users.cache.get(time.closeUserID)
          let claimUser = await client.users.cache.get(time.claimUser)
          let totalMessages = time.lastMessageSent
          // let ticketCloseReason = await time.closeReason
          let channel = await guild.channels.cache.get(time.channelID)

          if (!channel || !closeUserID || !ticketAuthor) return

          const { attachment, timestamp } = await utils.saveTranscriptAlertCmd(channel)

          const logEmbed = new Discord.EmbedBuilder()
          logEmbed.setColor("Red")
          logEmbed.setTitle(config.Locale.ticketCloseTitle)

          if (closeUserID) logEmbed.addFields([
            { name: `• ${config.Locale.logsClosedBy}`, value: `> <@!${closeUserID.id}>\n> ${closeUserID.username}\n> 🕑 Tự động đóng khi không hoạt động \`\`(/alert)\`\`` },
          ])

          logEmbed.addFields([
            { name: `• ${config.Locale.logsTicketAuthor}`, value: `> <@!${ticketAuthor.id}>\n> ${ticketAuthor.username}` },
          ])

          if (claimUser && config.ClaimingSystem.Enabled) logEmbed.addFields([
            { name: `• ${config.Locale.ticketClaimedBy}`, value: `> <@!${claimUser.id}>\n> ${claimUser.username}` },
          ])

          logEmbed.addFields([
            { name: `• ${config.Locale.logsTicket}`, value: `> #${channel.name}\n> ${time.ticketType}` },
          ])

          logEmbed.setTimestamp()
          logEmbed.setThumbnail(closeUserID.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 }))
          logEmbed.setFooter({ text: `${config.Locale.totalMessagesLog} ${totalMessages}`, iconURL: `${closeUserID.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}` })

          const embedOptions = { embeds: [logEmbed] };
          const dashboardDB = await dashboardModel.findOne({ guildID: config.GuildID });

          const shouldIcludeAttachment = totalMessages >= config.TicketTranscriptSettings.MessagesRequirement && !dashboardExists

          if (shouldIcludeAttachment) {
            embedOptions.files = [attachment];
          }

          // Thêm nút "Xem bản ghi" nếu bảng điều khiển tồn tại
          if (dashboardExists && totalMessages >= config.TicketTranscriptSettings.MessagesRequirement && config.TicketTranscriptSettings.TranscriptType === "HTML" && config.TicketTranscriptSettings.SaveInFolder === true) {
            const viewTranscriptButton = new Discord.ButtonBuilder()
              .setLabel(config.Locale.viewTranscriptButton)
              .setStyle('Link')
              .setURL(`${dashboardDB.url}/transcript?channelId=${time.channelID}&dateNow=${timestamp}`);

            const row = new Discord.ActionRowBuilder().addComponents(viewTranscriptButton);

            embedOptions.components = [row];
          }

          let closeLogMsgID;
          let logsChannel;
          if (!config.ticketClose.ChannelID) logsChannel = guild.channels.cache.get(config.TicketSettings.LogsChannelID);
          if (config.ticketClose.ChannelID) logsChannel = guild.channels.cache.get(config.ticketClose.ChannelID);

          if (logsChannel && config.ticketClose.Enabled) await logsChannel.send(embedOptions).then(async function (msg) { closeLogMsgID = msg.id })

          client.emit('sendUserDM', time, attachment, closeLogMsgID);

          await channel.delete().catch(e => { })

          await ticketModel.updateOne(
            { channelID: time.channelID },
            {
              $set: {
                closeUserID: "alert",
              },
              $unset: {
                closeNotificationTime: 1,
                closeNotificationMsgID: 1,
                closeNotificationUserID: 1
              }
            }
          );
        }
      })
    }
  }, 300000);

  // Kiểm tra và update trạng thái ticket khi bot khởi động
  try {
    const channelsInServer = guild.channels.cache.filter(c => c.type === 0);
    const ticketChannelsInDB = await ticketModel.find({ guildID: config.GuildID });

    for (const ticketInDB of ticketChannelsInDB) {
      const channelExists = channelsInServer.some(c => String(c.id) === String(ticketInDB.channelID));

      // Kiểm tra nếu tìm thấy ticket trong database cho kênh
      if (!channelExists) {
        // Nếu kênh ticket không tồn tại trong server, cập nhật trạng thái thành closed
        ticketInDB.status = 'Closed';
        await ticketInDB.save();
      }
    }
  } catch (error) {
    console.error('Lỗi khi kiểm tra và cập nhật ticket khi bot khởi động:', error);
  }

  // Kiểm tra neus InactivtyMonitor đượcbật
  if (config.InactivityMonitor && config.InactivityMonitor.Enabled) {
    const interval = ms(config.InactivityMonitor.CheckInterval);

    setInterval(async () => {
      try {
        // Lấy các ticket open
        const openTickets = await ticketModel.find({ status: 'Open', inactivityWarningSent: false });

        for (const ticket of openTickets) {
          // Kiểm tra nếu ticket đang đợi staff trả lời
          if (ticket.waitingReplyFrom === 'staff') {
            const now = moment();
            const lastMessageTime = moment(ticket.lastMessageSent);
            const unrespondedThreshold = ms(config.InactivityMonitor.UnrespondedDuration);

            // Kiểm tra ticket xem đã vượt qua thời gian chờ phản hồi
            if (now.diff(lastMessageTime, 'milliseconds') > unrespondedThreshold) {
              // Log
              const logChannel = client.channels.cache.get(config.InactivityMonitor.LogChannel);
              if (!logChannel) {
                console.log(`[ERROR] Kênh log với ID ${config.InactivityMonitor.LogChannel} không tìm thấy.`);
                return;
              }

              // Tính toán phản hồi không đọc được của con người
              const duration = now.diff(lastMessageTime, 'milliseconds');
              const durationDays = Math.floor(duration / (1000 * 60 * 60 * 24));
              const durationHours = Math.floor((duration % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
              const durationMinutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));

              let unrespondedDuration = '';
              if (durationDays > 0) unrespondedDuration += `${durationDays} day${durationDays > 1 ? 's' : ''}`;
              if (durationHours > 0) unrespondedDuration += `${unrespondedDuration ? ', ' : ''} ${durationHours} hour${durationHours > 1 ? 's' : ''}`;
              if (durationMinutes > 0 || unrespondedDuration === '') unrespondedDuration += `${unrespondedDuration ? ', ' : ''}${durationMinutes} minute${durationMinutes > 1 ? 's' : ''}`;

              const ticketCreationTimestamp = `<t:${Math.floor(moment(ticket.ticketCreationDate).unix())}:F>`;
              const ticketLink = `https://discord.com/channels/${ticket.guildID}/${ticket.channelID}`;

              const logMessage = config.InactivityMonitor.logMessage
                .replace(/{ticketLink}/g, ticketLink)
                .replace(/{channel}/g, `<#${ticket.channelID}>`)
                .replace(/{ticketCreationDate}/g, ticketCreationTimestamp)
                .replace(/{unrespondedDuration}/g, unrespondedDuration);

              const embed = new Discord.EmbedBuilder()
                .setColor('Red')
                .setDescription(logMessage)
                .setFooter({ text: `#${ticket.identifier}` })
                .setTimestamp();

              const rolesToPing = config.InactivityMonitor.rolesToPing
                .map(roleId => `<@&${roleId}>`)
                .join(' ');

              await logChannel.send({
                content: rolesToPing,
                embeds: [embed]
              });

              ticket.inactivityWarningSent = true;
              await ticket.saE();
            }
          }
        }
      } catch (err) {
        console.error(`[ERROR] InactivityMonitor trả về lỗi: ${err.message}`);
      }
    }, interval);
  }

  // Chức năng dọn dẹp các tài liệu cũ khỏi cơ sở dữ liệu dựa trên cấu hình
  async function cleanUpOldDocuments(collection, maxAgeInMonths) {
    const maxAge = new Date();
    maxAge.setMonth(maxAge.getMonth() - maxAgeInMonths);

    try {
      // Tìm và xóa lâu hơn giới hạn tối đa
      const result = await collection.deleteMany({
        updatedAt: { $lt: maxAge },
      });

      if (result.deletedCount > 1) console.log(`[DATABASE CLEANUP] ${result.deletedCound} đã bị xóa khỏi bộ: ${collection.modelName}`);
    } catch (error) {
      console.error(`Lỗi khi dọn dẹp thư mục cũ ${collection.modelName}:`, error);
    }
  }

  // Dọn dẹp dựa trên cấu hình
  if (config.cleanUpData.tickets.enabled) {
    cleanUpOldDocuments(ticketModel, config.cleanUpData.tickets.time);
  }

  if (config.cleanUpData.reviews.enabled) {
    cleanUpOldDocuments(reviewModel, config.cleanUpData.reviews.time);
  }

  // Tăng timesBotStarted 1 lần khi bot khởi động
  statsDB.timesBotStarted++;
  await statsDB.save();

  // Gửi tin nhắn đầu tiên
  if (statsDB.timesBotStarted === 1) {
    console.log(``)
    console.log(``)
    console.log(`Cảm ơn bạn đã chọn ${color.yellow('ZenKho Ticket')}!`)
    console.log(`Đây là lần đầu bạn khởi động bot, đây là vài thông tin quan trọng:`)
    console.log(``)
    console.log(`Nếu bạn cần trợ giúp, hãy DM cho tôi qua discord:`)
    console.log(`https://discord.com/users/917970047325077615`)
    console.log(``)
    console.log(``)
  }
}