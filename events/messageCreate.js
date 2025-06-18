const { Discord, EmbedBuilder } = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const color = require('ansi-colors');
const utils = require("../utils.js");
const ticketModel = require("../models/ticketModel");
const guildModel = require("../models/guildModel");

module.exports = async (client, message) => {
  if (!message.channel.type === 0) return;
  const ticketDB = await ticketModel.findOne({ channelID: message.channel.id });
  if (message.author.bot) return;

  // TODO: Lưu tất cả người hỗ trợ vào cơ sở dữ liệu userStats, để theo dõi thống kê riêng từng người
  // let supportRole = utils.checkIfUserHasSupportRoles(message)
  // if(supportRole) {
  //
  // }

  // Các lệnh tùy chỉnh
  if (config.CommandsEnabled) {
    config.CustomCommands.forEach(cmd => {

      let messageArray = message.content.split(" ");
      let command = messageArray[0].toLowerCase();
      messageArray.slice(1);
      let commandfile = command.slice(config.CommandsPrefix.length);
      if (message.content.startsWith(config.CommandsPrefix) && commandfile === cmd.command) {
        if (config.OnlyInTickets && !ticketDB) return;

        let logMsg = `\n\n[${new Date().toLocaleString()}] [CUSTOM COMMAND] Lệnh: ${cmd.command}, Người dùng: ${message.author.username}`;
        fs.appendFile("./logs.txt", logMsg, (e) => {
          if (e) console.log(e);
        });

        if (config.LogCommands) console.log(`${color.yellow(`[CUSTOM COMMAND] ${color.cyan(`${message.author.username}`)} đã dùng ${color.cyan(`${config.CommandsPrefix}${cmd.command}`)}`)}`);

        let respEmbed = new EmbedBuilder()
          .setColor(config.EmbedColors)
          .setDescription(`${cmd.response}`)

        if (cmd.deleteMsg) setTimeout(() => message.delete(), 100);
        if (cmd.replyToUser && cmd.Embed) message.reply({ embeds: [respEmbed] })
        if (cmd.replyToUser === false && cmd.Embed) message.channel.send({ embeds: [respEmbed] })

        if (cmd.replyToUser && cmd.Embed === false) message.reply({ content: `${cmd.response}` })
        if (cmd.replyToUser === false && cmd.Embed === false) message.channel.send({ content: `${cmd.response}` })
      }
    })
  }

  // Đếm số tin nhắn trong ticket, cập nhật thời gian gửi cuối, và kiểm tra lệnh cảnh báo có đang hoạt động không
  if (ticketDB) {
    // Tăng số lượng tin nhắn trong ticket
    if (!message.author.bot) {
      let supportRole = await utils.checkIfUserHasSupportRoles(message);

      // Xác định người cần phản hồi tiếp theo
      const waitingReplyFrom = supportRole ? "user" : "staff";

      // Kiểm tra đây có phải phản hồi đầu tiên từ nhân viên hỗ trợ không
      if (supportRole && !ticketDB.firstStaffResponse) {
        await ticketModel.findOneAndUpdate(
          { channelID: message.channel.id },
          { $set: { firstStaffResponse: Date.now() } }
        );
      }

      await ticketModel.findOneAndUpdate(
        { channelID: message.channel.id },
        {
          $set: {
            lastMessageSent: Date.now(),
            waitingReplyFrom: waitingReplyFrom,
          },
          $inc: { messages: 1 },
        },
        { new: true }
      );
    }

    // Tăng tổng số tin nhắn trong thống kê toàn server
    await guildModel.findOneAndUpdate(
      { guildID: message.guild.id },
      { $inc: { totalMessages: 1 } }
    );

    // Kiểm tra xem ticket có đang chờ đóng do cảnh báo không
    if (config.TicketAlert.Enabled) {
      const filtered = await ticketModel.find({
        closeNotificationTime: { $exists: true, $ne: null },
        channelID: message.channel.id
      });

      for (const time of filtered) {
        if (!time) return;
        if (!time.channelID) return;
        if (time.closeNotificationTime === 0) return

        if (time.channelID === message.channel.id) {
          // Đặt lại thời gian cảnh báo
          await ticketModel.findOneAndUpdate(
            { channelID: message.channel.id },
            { $unset: { closeReason: 1 }, $set: { closeNotificationTime: 0 } }
          );

          // Xoá tin nhắn cảnh báo
          if (message) await message.channel.messages.fetch(time.closeNotificationMsgID).then(msg => {
            try {
              msg.delete();
            } catch (error) {
              console.error("Lỗi khi xoá tin nhắn:", error);
            }
          });
        }
      }
    }
  }

  const stringSimilarity = require("string-similarity");

  // Phản hồi tự động
  if (config.AutoResponse.Enabled && config.AutoResponse.Responses) {
    // Nếu được cấu hình chỉ phản hồi trong ticket, mà không phải ticket thì bỏ qua
    if (config.AutoResponse.OnlyInTickets && !ticketDB) {
      return;
    }

    // Trích xuất tin nhắn người dùng và các phản hồi đã cấu hình
    const userMessage = message.content.toLowerCase();
    const responseKeys = Object.keys(config.AutoResponse.Responses);

    // Tìm phản hồi khớp nhất
    const matches = stringSimilarity.findBestMatch(userMessage, responseKeys);
    //console.log(`[DEBUG] Kết quả khớp tốt nhất cho "${userMessage}":`, matches.bestMatch);

    // Kiểm tra mức độ khớp có đủ cao không
    if (matches.bestMatch.rating >= config.AutoResponse.ConfidenceThreshold) {
      const matchedKey = matches.bestMatch.target;
      const responseConfig = config.AutoResponse.Responses[matchedKey];

      if (!responseConfig || !responseConfig.Message) {
        console.log(`[INFO] Thiếu cấu hình phản hồi cho từ khoá: ${matchedKey}`);
        return;
      }

      const responseMsg = responseConfig.Message;
      const responseType = responseConfig.Type || "TEXT"; // Mặc định là TEXT nếu không có

      // Gửi phản hồi dạng EMBED hoặc TEXT
      if (responseType === "EMBED") {
        const respEmbed = new EmbedBuilder()
          .setColor(config.EmbedColors)
          .setDescription(`<@!${message.author.id}>, ${responseMsg}`)
          .setFooter({ text: message.author.username, iconURL: message.author.displayAvatarURL({ dynamic: true }) })
          .setTimestamp();

        message.reply({ embeds: [respEmbed] });
      } else if (responseType === "TEXT") {
        message.reply({ content: `<@!${message.author.id}>, ${responseMsg}` });
      } else {
        console.log(`[INFO] Loại phản hồi không hợp lệ cho từ khoá: ${matchedKey}. Phải là "EMBED" hoặc "TEXT".`);
      }
    } else {
      //console.log(`[INFO] Không tìm thấy phản hồi phù hợp cho: "${userMessage}". Mức độ khớp: ${matches.bestMatch.rating}`);
    }
  }
};
