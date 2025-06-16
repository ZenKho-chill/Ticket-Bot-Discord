const { Discord, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const yaml = require('js-yaml')
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const color = require('ansi-colors');
const utils = require('../utils.js')
const ticketModel = require('../models/ticketModel.js')
const guildModel = require('../models/guildModel.js')

module.exports = async (client, message) => {
  if (!message.channel.type === 0) return;
  const ticketDB = await ticketModel.findOne({ channelID: message.channel.id });
  if (message.author.bot) return;

  // WIP: Lưu trữ tất cả người dùng hỗ trợ trong DB userStats để có được số liệu thống kê người dùng cụ thể
  // let supportRole = utils.checkIfUserHasSupportRoles(message)
  // if(supportRole) {
  // }

  // Lệnh custom
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

        if (config.LogCommands) console.log(`${color.yellow(`[CUSTOM COMMAND] ${color.cyan(`${message.author.username}`)} sử dụng ${color.cyan(`${config.CommandsPrefix}${cmd.command}`)}`)}`);

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

  // Đếm tin nhắn trong ticket và cập nhật lastMessageSent, check nếu lệnh alert đang kích hoạt
  if (ticketDB) {
    // Tăng tin nhắn trong ticket
    if (!message.author.bot) {
      let supportRole = await utils.checkIfUserHasSupportRoles(message);

      // Xác định ai đang trả lời
      const waitingReplyFrom = supportRole? "user" : "staff";

      // Kiểm tra xem phản hồi đầu tiên có phải từ staff không
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
          $inc: { message: 1 },
        },
        { new: true }
      );
    }
    // Tăng totalMessages trong bộ đếm
    await guildModel.findOneAndUpdate(
      { guildID: message.guild.id },
      { $inc: { totalMessages: 1 } }
    );

    // Cảnh báo tự động đóng, kiểm tra phản hồi
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
          // Đặt lại closeNotificationTime
          await ticketModel.findOneAndUpdate(
            { channelID: message.channel.id },
            { $unset: { closeReason: 1 }, $set: { closeNotificationTime: 0 } }
          );

          // Xóa tin nhắn thông báo
          if (message) await message.channel.messages.fetch(time.closeNotificationMsgID).then(msg => {
            try {
              msg.delete();
            } catch (error) {
              console.error('Lỗi xóa tin nhắn:', error);
            }
          });
        }
      }
    }
  }
  const stringSimilarity = require('string-similarity');

  if (config.AutoResponse.Enabled && config.AutoResponse.Responses) {
    // Giới hạn ticket nếu OnlyInTickets là true
    if (config.AutoResponse.OnlyInTickets && !ticketDB) {
      return;
    }

    // Trích xuất tin nhắn của người dùng và phản hồi được cấu hình
    const userMessage = message.content.toLowerCase();
    const responseKeys = Object.keys(config.AutoResponse.Responses);

    // Tìm lựa chọn giống nhất với tin nhắn người dùng
    const matches = stringSimilarity.findBestMatch(userMessage, responseKeys);
    //console.log(`[DEBUG] Best match for "${userMessage}":`, matches.bestMatch);

    // Kiểm tra tin nhắn có đạt yêu cầu tối thiếu hay không
    if (matches.bestMatch.rating >= config.AutoResponse.ConfidenceThreshold) {
      const matchedKey = matches.bestMatch.target;
      const responseConfig = config.AutoResponse.Responses[matchedKey];

      if (!responseConfig || !responseConfig.Message) {
        console.log(`[INFO] Cấu hình tự động phản hồi thiếu cho: ${matchedKey}`);
        return;
      }

      const responseMsg = responseConfig.Message;
      const responseType = responseConfig.Type || "TEXT"; // Mặc định là text

      // Trả lời bằng embed hoặc text
      if (responseType === "EMBED") {
        const respEmbed = new Embed()
          .setColor(config.EmbedColors)
          .setDescription(`<@!${message.author.id}>, ${responseMsg}`)
          .setFooter({ text: message.author.username, iconURL: message.author.displayAvatarURL({ dynamic: true }) })
          .setTimestamp();

        message.reply({ embeds: [respEmbed] });
      } else if (responseType === "TEXT") {
        message.reply({ content: `<@!${message.author.id}>, ${responseMsg}` });
      } else {
        console.log(`[INFO] Sai định dạng trả lời cho: ${matchedKey}. Chỉ được "EMBED" hoặc "TEXT".`);
      }
    } else {
      console.log(`[INFO] Không có câu trả lời cho: "${userMessage}". Độ phù hợp: ${matches.bestMatch.rating}`);
    }
  }
};