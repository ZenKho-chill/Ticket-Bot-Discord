const { Collection, Client, Discord, Intents, AttachmentBuilder, ActionRowBuilder, EmbedBuilder, ButtonBuilder } = require('discord.js');
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const client = require("./index.js")
const color = require('ansi-colors');
const axios = require('axios')
const glob = require("glob");
let discordTranscripts;
if (config.TicketTranscriptSettings.TranscriptType === "HTML") discordTranscripts = require('discord-html-transcripts')

const { EventEmitter } = require('events');
const eventHandler = new EventEmitter();

exports.eventHandler = eventHandler;

client.commands = new Collection();
client.slashCommands = new Collection();

client.cooldowns = new Collection();

const guildModel = require("./models/guildModel");
const ticketModel = require("./models/ticketModel");

// Lệnh slash
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v10');

if (config.GuildID) {
  const slashCommands = [];

  const commandFolders = fs.readdirSync('./slashCommands');
  for (const folder of commandFolders) {
    const commandFiles = fs.readdirSync(`./slashCommands/${folder}`).filter(file => file.endsWith('.js'));
    for (const file of commandFiles) {

      const command = require(`./slashCommands/${folder}/${file}`);
      if (command.enabled) {
        slashCommands.push(command.data.toJSON());
        console.log(`[SLASH COMMAND] ${file} loaded!`);
        client.slashCommands.set(command.data.name, command);
      }
    }
  }

  glob('./addons/**/*.js', async (err, files) => {
    if (err) return console.error(err);

    const loadedAddons = [];

    for (const file of files) {
      if (file.endsWith('.js')) {
        const folderName = file.match(/\/addons\/([^/]+)/)[1];

        if (!loadedAddons.includes(folderName)) {
          loadedAddons.push(folderName);
          console.log(`${color.green(`[ADDON] ${folderName} loaded!`)}`);
        }

        try {
          if (fs.existsSync(file)) {
            const addon = require(file);

            if (addon && typeof addon.register === 'function') {
              // Chuyển API sự kiện và máy khách đến chức năng đăng ký bổ trợ.
              addon.register({
                on: eventHandler.on.bind(eventHandler),
                emit: eventHandler.emit.bind(eventHandler),
                client,
              });
            }

            // Xử lý đăng ký lệnh chém
            if (addon && addon.data && addon.data.toJSON && addon.execute) {
              const slashCommandData = addon.data.toJSON();
              client.slashCommands.set(slashCommandData.name, addon);
              slashCommands.push(slashCommandData);
              console.log(`${color.green(`[COMMAND] ${slashCommandData.name} registered from ${folderName}`)}`);
            }
          }
        } catch (addonError) {
          console.error(`${color.red(`[ERROR] ${folderName}: ${addonError.message}`)}`);
          console.error(addonError.stack);
        }
      }
    }
  });



  client.on('ready', async () => {

    const rest = new REST({
      version: '10'
    }).setToken(config.Token);
    (async () => {
      try {
        await rest.put(
          Routes.applicationGuildCommands(client.user.id, config.GuildID), {
          body: slashCommands
        },
        );
      } catch (error) {
        if (error) {
          let logMsg = `\n\n[${new Date().toLocaleString()}] [ERROR] ${error.stack}`;
          await fs.appendFile("./logs.txt", logMsg, (e) => {
            if (e) console.log(e);
          });
          console.log(error)
          await console.log('\x1b[31m%s\x1b[0m', `[ERROR] Các lệnh chém không có sẵn vì phạm vi ứng dụng. Phạm vi không được chọn khi mời bot.Vui lòng sử dụng liên kết bên dưới để liên kết lại bot của bạn.`)
          await console.log('\x1b[31m%s\x1b[0m', `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`)
        }
      }
    })();
  });
}
//


// Trình xử lý chỉ huy và sự kiện, v.v.
fs.readdir('./events/', (err, files) => {
  if (err) return console.error

  files.forEach(async (file) => {
    if (!file.endsWith('.js')) return;
    console.log(`[EVENT] ${file} loaded!`)

    const evt = require(`./events/${file}`);
    let evtName = file.split('.')[0];
    client.on(evtName, evt.bind(null, client));
  });
});


// Nhận xếp hạng vé trung bình
exports.averageRating = async function (client) {
  try {
    const guild = await guildModel.findOne({ guildID: config.GuildID });
    if (!guild) return "0.0";

    const ratings = guild.reviews.map(review => review.rating);
    const nonZeroRatings = ratings.filter(rating => rating !== 0);
    const average = nonZeroRatings.length ? (nonZeroRatings.reduce((a, b) => a + b) / nonZeroRatings.length).toFixed(1) : "0.0";

    guild.averageRating = average;
    await guild.save();

    return average;
  } catch (error) {
    console.error('Lỗi tìm nạp dữ liệu của bang hội:', error);
    return "0.0";
  }
};


// Kiểm tra cấu hình để biết lỗi
exports.checkConfig = function (client) {
  let foundErrors = [];
  let guild = client.guilds.cache.get(config.GuildID)

  var reg = /^#([0-9a-f]{3}){1,2}$/i;
  if (reg.test(config.EmbedColors) === false) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] EmbedColors không phải là màu hex hợp lệ!`)
    foundErrors.push("EmbedColors không phải là màu hex hợp lệ!");
  }

  // Kiểm tra các kênh không hợp lệ
  if (!guild.channels.cache.get(config.TicketSettings.LogsChannelID)) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketSettings.LogsChannelID không phải là một kênh hợp lệ!`)
    foundErrors.push("TicketSettings.LogsChannelID không phải là một kênh hợp lệ!");
  }


  // Check if user has removed any buttons from the config
  for (let i = 1; i <= 8; i++) {
    const button = config[`TicketButton${i}`];

    if (!button) {
      console.log('\x1b[31m%s\x1b[0m', `[ERROR] Bạn đã xóa TicketButton${i} khỏi cấu hình có nghĩa là bot sẽ không hoạt động đúng, bạn có thể đặt được bật thành sai nếu bạn muốn vô hiệu hóa nó thay thế.`)
      foundErrors.push(`TicketButton${i} đã loại bỏ khỏi cấu hình!`);
      process.exit();
    }
  }


  // Check for invalid colors in all ticket buttons
  if (!["Blurple", "Gray", "Green", "Red"].includes(config.TicketButton1.ButtonColor)) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketButton1.ButtonColor không phải là một màu hợp lệ! Màu sắc hợp lệ: Blurple, Gray, Green, Red (Trường hợp nhạy cảm)`)
    foundErrors.push("TicketButton1.ButtonColor không phải là một màu hợp lệ!");
  }

  if (!["Blurple", "Gray", "Green", "Red"].includes(config.TicketButton2.ButtonColor) && config.TicketButton2.Enabled) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketButton2.ButtonColor không phải là một màu hợp lệ! Màu sắc hợp lệ:Blurple, Gray, Green, Red (Trường hợp nhạy cảm)`)
    foundErrors.push("TicketButton2.ButtonColor không phải là một màu hợp lệ!");
  }

  if (!["Blurple", "Gray", "Green", "Red"].includes(config.TicketButton3.ButtonColor) && config.TicketButton3.Enabled) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketButton3.ButtonColor không phải là một màu hợp lệ! Màu sắc hợp lệ:Blurple, Gray, Green, Red (Trường hợp nhạy cảm)`)
    foundErrors.push("TicketButton3.ButtonColor không phải là một màu hợp lệ!");
  }

  if (!["Blurple", "Gray", "Green", "Red"].includes(config.TicketButton4.ButtonColor) && config.TicketButton4.Enabled) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketButton4.ButtonColor không phải là một màu hợp lệ!Màu sắc hợp lệ: Blurple, Gray, Green, Red (Trường hợp nhạy cảm)`)
    foundErrors.push("TicketButton4.ButtonColor không phải là một màu hợp lệ!");
  }

  if (!["Blurple", "Gray", "Green", "Red"].includes(config.TicketButton5.ButtonColor) && config.TicketButton5.Enabled) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketButton5.ButtonColor không phải là một màu hợp lệ!Màu sắc hợp lệ:Blurple, Gray, Green, Red (Trường hợp nhạy cảm)`)
    foundErrors.push("TicketButton5.ButtonColor không phải là một màu hợp lệ!");
  }


  // Check for invalid colors in all suggestion buttons
  if (!["Blurple", "Gray", "Green", "Red"].includes(config.SuggestionUpvote.ButtonColor) && config.SuggestionSettings.Enabled) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionUpvote.ButtonColor không phải là một màu hợp lệ!Màu sắc hợp lệ: Blurple, Gray, Green, Red (Trường hợp nhạy cảm)`)
    foundErrors.push("SuggestionUpvote.ButtonColorkhông phải là một màu hợp lệ!");
  }

  if (!["Blurple", "Gray", "Green", "Red"].includes(config.SuggestionDownvote.ButtonColor) && config.SuggestionSettings.Enabled) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionDownvote.ButtonColor không phải là một màu hợp lệ!Màu sắc hợp lệ: Blurple, Gray, Green, Red (Trường hợp nhạy cảm)`)
    foundErrors.push("SuggestionDownvote.ButtonColorkhông phải là một màu hợp lệ!");
  }

  if (!["Blurple", "Gray", "Green", "Red"].includes(config.SuggestionResetvote.ButtonColor) && config.SuggestionSettings.Enabled) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionResetvote.ButtonColorkhông phải là một màu hợp lệ!Màu sắc hợp lệ:Blurple, Gray, Green, Red (Trường hợp nhạy cảm)`)
    foundErrors.push("SuggestionResetvote.ButtonColorkhông phải là một màu hợp lệ!");
  }

  // Kiểm tra các kênh danh mục không hợp lệ trong tất cả các nút vé
  for (let i = 1; i <= 8; i++) {
    const ticketButton = config[`TicketButton${i}`];

    if (i !== 1 && !ticketButton.Enabled) continue;

    if (guild.channels.cache.get(ticketButton.TicketCategoryID)?.type !== 4) {
      console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketButton${i}.TicketCategoryID không phải là một danh mục hợp lệ!`);
      foundErrors.push(`TicketButton${i}.TicketCategoryID không phải là một danh mục hợp lệ!`);
    }
  }

  // Kiểm tra mô tả danh mục dài hơn 100 ký tự
  for (let i = 1; i <= 8; i++) {
    const ticketButton = config[`TicketButton${i}`];

    if (i !== 1 && !ticketButton.Enabled) continue;

    if (ticketButton.Description.length > 100) {
      console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketButton${i}.Description không thể dài hơn 100 ký tự!`);
      foundErrors.push(`TicketButton${i}.Description Không thể dài hơn 100 ký tự!`);
    }
  }

  // Kiểm tra xem câu hỏi có mặt không và hợp lệ
  for (let i = 1; i <= 8; i++) {
    const button = config[`TicketButton${i}`];
    if (i !== 1 && !button.Enabled) continue;

    const customIdSet = new Set();
    if (button.Questions) button.Questions.forEach((question, index) => {
      if (question && !question.customId || typeof question.customId !== 'string' || /\s/.test(question.customId) || customIdSet.has(question.customId)) {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketButton${i}.Questions[${index}] có một tùy chỉnh không hợp lệ hoặc trùng lặp!Tùy chỉnh phải là duy nhất, một chuỗi không trống không có khoảng trắng.`);
        foundErrors.push(`TicketButton${i}.Questions[${index}] có một tùy chỉnh không hợp lệ hoặc trùng lặp!Tùy chỉnh phải là duy nhất, một chuỗi không trống không có khoảng trắng.`);
      } else {
        customIdSet.add(question.customId);
      }

      // Kiểm tra phong cách hợp lệ
      const validStyles = ['short', 'paragraph'];
      if (!validStyles.includes(question.style.toLowerCase())) {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketButton${i}.Questions[${index}] Có một phong cách không hợp lệ!Phong cách phải là một trong những: ${validStyles.join(', ')}.`);
        foundErrors.push(`TicketButton${i}.Questions[${index}] Có một phong cách không hợp lệ!Phong cách phải là một trong những: ${validStyles.join(', ')}.`);
      }

    });
  }

  // Kiểm tra các vai trò hỗ trợ không hợp lệ trong tất cả các nút vé
  for (let i = 1; i <= 8; i++) {
    const button = config[`TicketButton${i}`];

    if (i !== 1 && !button.Enabled) continue;

    // Kiểm tra nếu SupportRoles là một mảng có định dạng chính xác
    if (!Array.isArray(button.SupportRoles) || !button.SupportRoles.every(roleid => typeof roleid === 'string')) {
      console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketButton${i}.SupportRoles không ở định dạng chính xác!Ví dụ về định dạng chính xác: ["ROLE_ID", "ROLE_ID"] hoặc ["ROLE_ID"]`);
      foundErrors.push(`TicketButton${i}.SupportRoles không ở định dạng chính xác!Ví dụ về định dạng chính xác: ["ROLE_ID", "ROLE_ID"] hoặc ["ROLE_ID"]`);
      continue;
    }

    button.SupportRoles.forEach(roleid => {
      const role = guild.roles.cache.get(roleid);

      if (!role) {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketButton${i}.SupportRoles không phải là một vai trò hợp lệ! (${roleid})`);
        foundErrors.push(`TicketButton${i}.SupportRoles không phải là một vai trò hợp lệ!`);
      }
    });
  }

  // Kiểm tra biểu tượng cảm xúc không hợp lệ trong tất cả các nút vé
  const emojiRegex = require('emoji-regex');
  const discordEmojiRegex = /<a?:[a-zA-Z0-9_]+:(\d+)>/;

  for (let i = 1; i <= 8; i++) {
    const ticketButton = config[`TicketButton${i}`];

    if (i !== 1 && !ticketButton.Enabled) continue;

    if (ticketButton.ButtonEmoji) {
      const emojiPattern = emojiRegex();
      const emojiMatch = emojiPattern.exec(ticketButton.ButtonEmoji);
      const discordEmojiMatch = ticketButton.ButtonEmoji.match(discordEmojiRegex);

      if (!emojiMatch && !discordEmojiMatch) {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketButton${i}.ButtonEmoji Chứa một biểu tượng cảm xúc không hợp lệ! (${ticketButton.ButtonEmoji})`);
        foundErrors.push(`TicketButton${i}.ButtonEmoji Chứa một biểu tượng cảm xúc không hợp lệ!`);
      }
    }
  }

  // Kiểm tra hơn 5 câu hỏi trong tất cả các nút vé
  for (let i = 1; i <= 8; i++) {
    const ticketButton = config[`TicketButton${i}`];

    if (i !== 1 && !ticketButton.Enabled) continue;

    if (Array.isArray(ticketButton.Questions) && ticketButton.Questions.length > 5) {
      console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketButton${i} Có nhiều hơn 5 câu hỏi!(Mỗi danh mục chỉ có thể có tối đa 5 câu hỏi, do giới hạn Discord)`);
      foundErrors.push(`TicketButton${i} Có nhiều hơn 5 câu hỏi!`);
    }
  }



  if (foundErrors.length > 0) {
    let logMsg = `\n\n[${new Date().toLocaleString()}] [CONFIG ERROR(S)] \n${foundErrors.join("\n ").trim()}`;
    fs.appendFile("./logs.txt", logMsg, (e) => {
      if (e) console.log(e);
    });
  }
}

const moment = require('moment-timezone');
exports.getHolidayMessage = async function () {
  const today = moment();
  const month = today.month() + 1;
  const day = today.date();

  function randomMessage(messages) {
    return messages[Math.floor(Math.random() * messages.length)];
  }

  // Giáng sinh
  if (month === 12 && day >= 20 && day <= 27) {
    const messages = [
      `${color.green('🎄 Ho Ho Ho!')} ${color.red('Giáng sinh vui vẻ!')} ${color.yellow('🎅')}
${color.cyan('Chúc bạn xử lý vé mượt mà trong mùa lễ này.')}
${color.magenta('Có thể phản hồi của bạn nhanh như xe trượt tuyết Santa!')}`,

      `${color.green('🎄 Đó là mùa giải để được vui vẻ!')} ${color.red('Giáng sinh vui vẻ!')} 🎅
${color.cyan('Giải quyết vé như Santa cung cấp quà tặng - Lightning Fast!')}
${color.yellow('Hiệu quả của bạn sẽ làm cho ngay cả những yêu tinh ghen tị!')}`,

      `${color.green('🎅 Santa Lau xem!')} ${color.red('Giáng sinh vui vẻ!')}
${color.cyan('Giữ những vé đó di chuyển - bạn trong danh sách tốt đẹp!')}
${color.magenta('🎁 Hủy bỏ năng suất của bạn trong mùa này!')}`,

      `${color.green('🎄 Giáng sinh vui vẻ!')} 🎅  
${color.cyan('Chúc bạn vui mừng, cổ vũ và giải quyết vé không căng thẳng!')}
${color.yellow('Có thể hộp thư đến của bạn luôn vui vẻ và tươi sáng!')}`,

      `${color.green('🎁 Ho Ho Ho!')} ${color.red('Giáng sinh vui vẻ!')}
${color.cyan('Giải quyết vé của bạn với niềm vui kỳ nghỉ và một cốc ca cao!')}
${color.yellow('Yêu tinh Santa sườn ghen tị với hiệu quả của bạn!')}`
    ];
    return randomMessage(messages);
  }

  // Năm mới
  if (month === 1 && day >= 1 && day <= 3) {
    const messages = [
      `${color.yellow('🎆 CHÚC MỪNG NĂM MỚI!')} ${color.blue('🎇')}
${color.cyan('Năm mới, Nghị quyết mới - Không có vé chưa được giải quyết!')}
${color.magenta('🎉 Hãy để nó làm cho nó một năm tuyệt vời!')}`,

      `${color.yellow('🎇 Chúc mừng một khởi đầu mới!')} ${color.blue('CHÚC MỪNG NĂM MỚI!')}  
${color.cyan('Giải quyết vé nhanh hơn những giọt bóng! ')}
${color.magenta('Let’s keep things running smoothly all year long!')}`,

      `${color.yellow('🎉 Năm mới, bạn cũng tuyệt vời!')} ${color.blue('🎇')}
${color.cyan('Đây là một năm khác của việc xử lý vé mượt mà!')}
${color.magenta('🎆 Làm cho nó lấp lánh với hiệu quả của bạn!')}`,

      `${color.yellow('✨ Ở đây, một năm tuyệt vời phía trước!')} ${color.blue('🎇')}
${color.cyan('Ra ngoài với cái cũ, với sự quyết tâm!')}
${color.magenta('🎉 Bạn là MVP của các giải pháp vé!')}`,

      `${color.yellow('🎆 Pháo hoa trên bầu trời, hiệu quả trong hàng đợi!')}  
${color.cyan('CHÚC MỪNG NĂM MỚI! 🎇')}`
    ];
    return randomMessage(messages);
  }

  // halloween
  if (month === 10 && day === 31) {
    const messages = [
      `${color.orange('🎃 Halloween vui vẻ!')} ${color.gray('👻')}
${color.cyan('Hãy để cho vé ma ám ảnh bạn!')}
${color.magenta('Giải quyết chúng trước khi đình công nửa đêm!')}
       .-"      "-.  
     .'    👻     '.  
    /      RIP      \\`,

      `${color.orange('🎃 Cảnh báo mùa ma quái!')}  
${color.cyan('Cẩn thận với vé ma ẩn nấp trong bóng tối!')}
${color.magenta('Giải quyết chúng để giữ cho người dùng của bạn mỉm cười!')}`,

      `${color.orange('👻 Boo!')} ${color.cyan('Halloween vui vẻ!')}  
${color.magenta('Sợ làm việc chậm trễ vé với phản hồi nhanh chóng của bạn!')}`,

      `${color.orange('🎃 Lừa hay điều trị?')}  
${color.cyan('Giải quyết những vé đó nhanh hơn một chuyến đi chổi!')}`,

      `${color.orange('🦇 Don Tiết là Batty!')} ${color.cyan('Halloween vui vẻ!')}  
${color.magenta('Giữ cho hàng đợi của bạn rõ ràng và người dùng của bạn hạnh phúc!')}`
    ];
    return randomMessage(messages);
  }

  // Ngày lễ tình nhân
  if (month === 2 && day === 14) {
    const messages = [
      `${color.magenta('💖 Chúc mừng ngày Valentine!')}  
${color.cyan('Thể hiện tình yêu của bạn với những câu trả lời nhanh chóng!')}
${color.yellow('Người dùng của bạn sẽ ngưỡng mộ bạn!')}`,

      `${color.magenta('💌 Tình yêu đang ở trong không khí!')}  
${color.cyan('Giải quyết vé với sự chăm sóc và lòng tốt!')}`,

      `${color.magenta('💕 Truyền bá tình yêu!')} ${color.cyan('Chúc mừng ngày Valentine!')}  
${color.yellow('Trả lời nhanh là món quà Valentine cuối cùng!')}`,

      `${color.magenta('💝 Thể hiện một số tình yêu cho hàng đợi của bạn!')}  
${color.cyan('Xóa nó ra và làm cho người dùng của bạn hạnh phúc!')}`,

      `${color.magenta('💖 Trả lời nhanh = Trái tim hạnh phúc!')}  
${color.cyan('Làm cho ngày Valentine này trở nên đặc biệt cho người dùng của bạn!')}`
    ];
    return randomMessage(messages);
  }

  //Tin nhắn mặc định nếu không có kỳ nghỉ
  return null;
};


const path = require('path');
exports.checkDashboard = async function () {
  const folderPath = path.join(__dirname, 'addons', 'Dashboard');

  try {
    const files = await new Promise((resolve, reject) => {
      fs.readdir(folderPath, (error, files) => {
        if (error) {
          reject(error);
        } else {
          resolve(files);
        }
      });
    });

    return true;

  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    } else {
      throw error;
    }
  }
};

exports.saveTranscript = async function (interaction) {
  let dashboardExists = await exports.checkDashboard();
  let attachment;
  let timestamp = "null"
  if (interaction) {
    if (config.TicketTranscriptSettings.TranscriptType === "HTML") {
      attachment = await discordTranscripts.createTranscript(interaction.channel, {
        limit: -1,
        minify: false,
        saveImages: config.TicketTranscriptSettings.SaveImages,
        returnType: 'buffer',
        poweredBy: false,
        fileName: `${interaction.channel.name}.html`
      });

      if (config.TicketTranscriptSettings.SaveInFolder && dashboardExists) {
        timestamp = Date.now();
        fs.writeFileSync(`./addons/Dashboard/transcripts/transcript-${interaction.channel.id}-${timestamp}.html`, attachment);

        const ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });
        ticketDB.transcriptID = `${timestamp}`;
        await ticketDB.save();
      }

      if (config.TicketTranscriptSettings.SaveInFolder && !dashboardExists) {
        fs.writeFileSync(`./transcripts/transcript-${interaction.channel.id}-${timestamp}.html`, attachment);
      }

      attachment = new AttachmentBuilder(Buffer.from(attachment), { name: `${interaction.channel.name}-transcript.html` });
    } else if (config.TicketTranscriptSettings.TranscriptType === "TXT") {
      await interaction.channel.messages.fetch({ limit: 100 }).then(async fetched => {
        let a = fetched.filter(m => m.author.bot !== true).map(m => `${new Date(m.createdTimestamp).toLocaleString()} - ${m.author.username}: ${m.attachments.size > 0 ? m.attachments.first().proxyURL : m.content}`).reverse().join('\n');
        if (a.length < 1) a = "Nothing"
        if (config.TicketTranscriptSettings.SaveInFolder) fs.writeFileSync(`./transcripts/${interaction.channel.name}-transcript-${interaction.channel.id}.txt`, Buffer.from(a));
        attachment = new AttachmentBuilder(Buffer.from(a), { name: `${interaction.channel.name}-transcript.txt` });
      })
    }
  }

  return { attachment, timestamp };
}

exports.saveTranscriptAlertCmd = async function (channel) {
  let dashboardExists = await exports.checkDashboard();
  let attachment;
  let timestamp = "null"
  if (channel) {
    if (config.TicketTranscriptSettings.TranscriptType === "HTML") {
      attachment = await discordTranscripts.createTranscript(channel, {
        limit: -1,
        minify: false,
        saveImages: config.TicketTranscriptSettings.SaveImages,
        returnType: 'buffer',
        poweredBy: false,
        fileName: `${channel.name}.html`
      });

      if (config.TicketTranscriptSettings.SaveInFolder && dashboardExists) {
        timestamp = Date.now();
        fs.writeFileSync(`./addons/Dashboard/transcripts/transcript-${channel.id}-${timestamp}.html`, attachment);

        const ticketDB = await ticketModel.findOne({ channelID: channel.id });
        ticketDB.transcriptID = `${timestamp}`;
        await ticketDB.save();
      }

      if (config.TicketTranscriptSettings.SaveInFolder && !dashboardExists) {
        fs.writeFileSync(`./transcripts/transcript-${channel.id}-${timestamp}.html`, attachment);
      }

      attachment = new AttachmentBuilder(Buffer.from(attachment), { name: `${channel.name}-transcript.html` });
    } else if (config.TicketTranscriptSettings.TranscriptType === "TXT") {
      await channel.messages.fetch({ limit: 100 }).then(async fetched => {
        let a = fetched.filter(m => m.author.bot !== true).map(m => `${new Date(m.createdTimestamp).toLocaleString()} - ${m.author.username}: ${m.attachments.size > 0 ? m.attachments.first().proxyURL : m.content}`).reverse().join('\n');
        if (a.length < 1) a = "Nothing"
        if (config.TicketTranscriptSettings.SaveInFolder) fs.writeFileSync(`./transcripts/${channel.name}-transcript-${channel.id}.txt`, Buffer.from(a));
        attachment = new AttachmentBuilder(Buffer.from(a), { name: `${channel.name}-transcript.txt` });
      })
    }
  }
  return { attachment, timestamp };
}

exports.checkIfUserHasSupportRoles = async function (interaction, message) {
  let supportRole = false;
  let context = interaction || message;

  const ticketDB = await ticketModel.findOne({ channelID: context.channel.id });

  if (!ticketDB) {
    console.log('\x1b[31m%s\x1b[0m', '[SUPPORT ROLE CHECK] Không tìm thấy mục nhập cơ sở dữ liệu vé');
    return false;
  }

  const buttonNumber = String(ticketDB.button).replace('TicketButton', '');
  const buttonConfig = config[`TicketButton${buttonNumber}`];

  if (!buttonConfig) {
    return false;
  }

  for (const roleId of buttonConfig.SupportRoles) {
    const role = context.guild.roles.cache.get(roleId);

    if (role) {

      if (context.member.roles.cache.has(role.id)) {
        supportRole = true;
        break;
      }
    }
  }

  return supportRole;
};

const relayEvents = (client) => {
  const eventsToRelay = [
    'messageCreate',
    'messageDelete',
    'messageDeleteBulk',
    'messageReactionAdd',
    'messageReactionRemove',
    'messageReactionRemoveAll',
    'messageUpdate',
    'channelCreate',
    'channelDelete',
    'channelPinsUpdate',
    'channelUpdate',
    'guildBanAdd',
    'guildBanRemove',
    'guildCreate',
    'guildDelete',
    'guildEmojiCreate',
    'guildEmojiDelete',
    'guildEmojiUpdate',
    'guildIntegrationsUpdate',
    'guildMemberAdd',
    'guildMemberRemove',
    'guildMemberUpdate',
    'guildRoleCreate',
    'guildRoleDelete',
    'guildRoleUpdate',
    'guildUpdate',
    'inviteCreate',
    'inviteDelete',
    'presenceUpdate',
    'threadCreate',
    'threadDelete',
    'threadListSync',
    'threadMembersUpdate',
    'threadUpdate',
    'typingStart',
    'userUpdate',
    'voiceStateUpdate',
    'webhookUpdate',
    'shardDisconnect',
    'shardError',
    'shardReady',
    'shardReconnecting',
    'shardResume',
    'stageInstanceCreate',
    'stageInstanceDelete',
    'stageInstanceUpdate',
    'ready',
    'warn',
    'debug',
    'error',
    'invalidRequestWarning',
    'rateLimit',
  ];

  eventsToRelay.forEach((eventName) => {
    client.on(eventName, (...args) => {
      eventHandler.emit(eventName, ...args);
    });
  });
};

client.login(config.Token).then(() => {
  relayEvents(client);
}).catch((error) => {
  if (error.message.includes('Đã sử dụng ý định không được phép')) {
    console.log(
      '\x1b[31m%s\x1b[0m',
      `Đã sử dụng ý định không cho phép (đọc cách sửa chữa): \n\nBạn đã không kích hoạt ý định cổng đặc quyền trong Discord Developer Portal!
Để khắc phục điều này, bạn phải kích hoạt tất cả các ý định cổng đặc quyền trong cổng thông tin nhà phát triển Discord của bạn.Mở cổng thông tin, vào ứng dụng của bạn, nhấp vào "Bot" ở phía bên trái, cuộn xuống và bật Presence Intent, Server Members Intent, và Message Content Intent.`
    );
    process.exit();
  } else if (error.message.includes('Mã thông báo không hợp lệ đã được cung cấp')) {
    console.log('\x1b[31m%s\x1b[0m', `[ERROR] Mã thông báo bot được chỉ định trong cấu hình không chính xác!`);
    process.exit();
  } else {
    console.log('\x1b[31m%s\x1b[0m', `[ERROR] Xảy ra lỗi trong khi cố gắng đăng nhập vào bot`);
    console.log(error);
    process.exit();
  }
});
