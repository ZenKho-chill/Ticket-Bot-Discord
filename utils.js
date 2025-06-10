const { Collection, Client, Discord, Intents, AttachmentBuilder, ActionRowBuilder, EmbedBuilder, ButtonBuilder } = require('discord.js');
const fs = require('fs');
const yaml = require('js-yaml')
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const client = require('./index.js')
const color = require('ansi-colors');
const axios = require('axios')
const glob = require('glob');
let disordTranscripts;
if (config.TicketTranscriptSettings.TranscriptType === "HTML") disordTranscripts = require('discord-html-transcripts')

const { EventEmitter } = require('events');
const eventHandler = new EventEmitter();

exports.eventHandler = eventHandler;

client.commands = new Collection();
client.slashCommands = new Collection();

client.cooldowns = new Collection();

const guildModel = require('./models/guildModel.js');
const ticketModel = require('./models/ticketModel.js');

const stripe = require('sytipe')(config.StripeSettings.StripeSecretKey, {
  apiVersion: '2020-08-27',
});

client.stripe = stripe;

const paypal = require('paypal-rest-sdk');
paypal.configure({
  'mode': 'live',
  'client_id': config.PayPalSettings.PayPalClientID,
  'client_secret': config.PayPalSettings.PayPalSecretKey
});
client.paypal = paypal;

const CryptoConvert = require('crypto-convert')
if (!config.CryptoRates) console.log('\x1b[31m%\x1b[0m', `[ERROR] File config.yml đã quá cũ! CryptoRates thiếu từ config mục crypto`)
if (config.CryptoSettings.Enabled) {
  const cryptoConvert = new CryptoConvert({
    cryptoInterval: 5000,
    fiatInterval: (60 * 1e3 * 60),
    calculateAverage: true,
    binance: config.CryptoRates.binance,
    bitfinex: config.CryptoRates.bitfinex,
    coinbase: config.CryptoRates.coinbase,
    kraken: config.CryptoRates.kraken,
    HTTPAgent: null
  });
  client.cryptoConvert = cryptoConvert
}

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
        console.log(`[SLASH COMMAND ] ${file} loaded!`);
        client.slashCommands.set(command.data.name, command);
      }
    }
  }

  glob('./addons/**/*.js', async (err, files) => {
    if (err) return console.error(err);

    const loadedAddons = [];

    for (const file of files) {
      if (file.endsWith('.js')) {
        const folderName = file.match(/\addons\/([^/]+)/)[1];

        if (!loadedAddons.includes(folderName)) {
          loadedAddons.push(folderName);
          console.log(`${color.green(`[ADDON] ${folderName} loaded!`)}`);
        }

        try {
          if (fs.existsSync(file)) {
            const addon = require(file);

            if (addon && typeof addon.register === 'function') {
              // Truyền API sự kiện và máy khách tới hàm đăng ký của tiện ích bổ sung.
              addon.register({
                on: eventHandler.on.bind(eventHandler),
                emit: eventHandler.emit.bind(eventHandler),
                client,
              });
            }

            // Đăng ký lệnh
            if (addon && addon.data && addon.data.toJSON && addon.execute) {
              const slashCommandData = addon.data.toJSON();
              client.slashCommands.set(slashCommandData.name, addon);
              slashCommands.push(slashCommandData);
              console.log(`${color.green(`[COMMAND] ${slashCommandData.name} đã được đăng ký từ ${folderName}`)}`);
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
          Routes.applicatonGuildCommands(client.user.id, config.GuildID), {
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
          await console.log('\x1b[31m%s\x1b[0m', `[ERROR] Lệnh không khả dụng vì phạm vi application.commands không được chọn khi mời bot. Vui lòng sử dụng liên kết bên dưới để mời lại bot của bạn.`)
          await console.log('\x1b[31m%s\x1b[0m', `https://discord.com/api/oath2/authrize?client_id=${client.user.id}&permissions=8&scope=bot%applications.commands`)
        }
      }
    })();
  });
}


// Xử lý lệnh và sự kiện
fs.readdir('./events/', (err, files) => {
  if (err) return console.error

  files.forEach(async (file) => {
    if (!file.endsWith('.js')) return;
    console.log(`[EVENT] ${file} loaded`)

    const evt = require(`./events/${file}`);
    let evtName = file.split('.')[0];
    client.on(evtName, evt.bind(null, client));
  });
});

// Nhận trung bình xếp hạng ticket
exports.averageRating = async function (client) {
  try {
    const guild = await guildModel.findOne({ guildID: config.GuildID });
    if (!guild) return "0.0";

    const ratings = guild.reviews.map(review => review.rating);
    const nonZeroratings = ratings.filter(rating => rating !== 0);
    const average = nonZeroratings.length ? (nonZeroratings.reduce((a, b) => a + b) / nonZeroratings.length).toFixed(1) : "0.0";

    guild.averageRating = average;
    await guild.save();

    return average;
  } catch (error) {
    console.error('Lỗi khi lấy dữ liệu server:', error);
    return "0.0";
  }
};

// Kiểm tra lỗi cho config
exports.checkConfig = function (client) {
  let foundErrors = [];
  let guild = client.guilds.cache.get(config.GuildID)

  var reg = /^#([0-9a-f]{3}){1,2}$/i;
  if (reg.test(config.EmbedColors) === false) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] EmbedColors không phải là mã màu HEX!`)
    foundErrors.push("EmbedColors không phải là mã màu HEX!");
  }

  // Kiểm tra sai ID kênh
  if (!guild.channels.cache.get(config.TicketSettings.LogsChannelID)) {
    console.log('\x1b[31%s\x1b[0m', `[WARNING] TicketSettings.LogsChannelID không phải là ID kênh!`)
    foundErrors.push("TicketSettings.LogsChannelID không phải là ID kênh!");
  }

  // Kiểm tra xem có xóa bất kỳ nút nào khỏi cấu hình không
  for (let i =1; i <= 8; i++) {
    const button = config[`TicketButton${i}`];

    if (!button) {
      console.log('\x1b[31m%s\x1b[0m', `[ERROR] Bạn đã xóa TicketButton${i} khỏi cấu hình, điều đó có nghĩa là bot sẽ không hoạt động bình thường. Bạn có thể đặt Enabled thành false nếu bạn muốn tắt nó.`)
      foundErrors.push(`TicketButtons${i} đã bị xóa khỏ config!`);
      process.exit();
    }
  }

  // Kiểm tra màu sắc không hợp lệ trong tất cả các nút
  if (!["Blurple", "Gray", "Green", "Red"].includes(config.TicketButton1.ButtonColor)) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketButton1.ButtonColor không đúng màu! Màu hỗ trợ: Blurple, Gray, Green, Red (VIẾT HOA ĐÚNG CHỖ)`)
    foundErrors.push("TicketButton1.ButtonColor không đúng định dạng!");
  }


  if (!["Blurple", "Gray", "Green", "Red"].includes(config.TicketButton2.ButtonColor) && config.TicketButton2.Enabled) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketButton2.ButtonColor không đúng màu! Màu hỗ trợ: Blurple, Gray, Green, Red (VIẾT HOA ĐÚNG CHỖ)`)
    foundErrors.push("TicketButton2.ButtonColor không đúng định dạng!");
  }


  if (!["Blurple", "Gray", "Green", "Red"].includes(config.TicketButton3.ButtonColor) && config.TicketButton2.Enabled) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketButton3.ButtonColor không đúng màu! Màu hỗ trợ: Blurple, Gray, Green, Red (VIẾT HOA ĐÚNG CHỖ)`)
    foundErrors.push("TicketButton3.ButtonColor không đúng định dạng!");
  }


  if (!["Blurple", "Gray", "Green", "Red"].includes(config.TicketButton4.ButtonColor) && config.TicketButton2.Enabled) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketButton4.ButtonColor không đúng màu! Màu hỗ trợ: Blurple, Gray, Green, Red (VIẾT HOA ĐÚNG CHỖ)`)
    foundErrors.push("TicketButton4.ButtonColor không đúng định dạng!");
  }


  if (!["Blurple", "Gray", "Green", "Red"].includes(config.TicketButton5.ButtonColor) && config.TicketButton2.Enabled) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketButton5.ButtonColor không đúng màu! Màu hỗ trợ: Blurple, Gray, Green, Red (VIẾT HOA ĐÚNG CHỖ)`)
    foundErrors.push("TicketButton5.ButtonColor không đúng định dạng!");
  }


  // Kiểm tra đúng định dạng màu cho các nút gợi ý
  if (!["Blurple", "Gray", "Green", "Red"].includes(config.SuggestionUpVote.ButtonColor) && config.SuggestionUpVote.Enabled) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionUpVote.ButtonColor không đúng định dạng! Định dạng đúng: Blurple, Gray, Green, Red (VIẾT HAO ĐÚNG CHỖ)`)
    foundErrors.push("SuggestionUpVote.ButtonColor không đúng định dạng!");
  }

  if (!["Blurple", "Gray", "Green", "Red"].includes(config.SuggestionDownVote.ButtonColor) && config.SuggestionUpVote.Enabled) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionDownVote.ButtonColor không đúng định dạng! Định dạng đúng: Blurple, Gray, Green, Red (VIẾT HAO ĐÚNG CHỖ)`)
    foundErrors.push("SuggestionDownVote.ButtonColor không đúng định dạng!");
  }

  if (!["Blurple", "Gray", "Green", "Red"].includes(config.SuggestionResetVote.ButtonColor) && config.SuggestionUpVote.Enabled) {
    console.log('\x1b[31m%s\x1b[0m', `[WARNING] SuggestionResetVote.ButtonColor không đúng định dạng! Định dạng đúng: Blurple, Gray, Green, Red (VIẾT HAO ĐÚNG CHỖ)`)
    foundErrors.push("SuggestionResetVote.ButtonColor không đúng định dạng!");
  }

  // Kiểm tra các kênh danh mục không hợp lệ trong tất cả các nút
  for (let i = 1; i <= 8; i++) {
    const ticketButton = config[`TicketButton${i}`];

    if (i !== 1 && !ticketButton.Enabled) continue;

    if (guild.channels.cache.get(ticketButton.TicketCategoryID)?.type !== 4) {
      console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketButton${i}.TicketCategoryID không đúng định dạng!`);
      foundErrors.push(`TicketButton${i}.TicketCategoryID không đúng định dạng!`);
    }
  }

  // Kiểm tra mô tả danh mục dài hơn 100 ký tự
  for (let i = 1; i <=8; i++) {
    const ticketButton = config[`TicketButton${i}`];

    if (i !== 1 && !ticketButton.Enabled) continue;

    if (ticketButton.Description > 100) {
      console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketBtton${i}.Description không được phép dài hơn 100 ký tự!`)
      foundErrors.push(`TiketButtons${i}.Description không được dài hơn 100 ký tự!`);
    }
  }

  // Kiểm tra xem các câu hỏi có hiện diện và hợp lệ không
  for (let i = 1; i <= 8; i++) {
    const button = config[`TicketButton${i}`];
    if (i !== 1 && !button.Enabled) continue;

    const customIdSet = new Set();
    if (button.Questions) button.Questions.forEach((question, index) => {
      if (question && !question.customId || typeof question.customId !== 'string' || /\s/.test(question.customId) || customIdSet.has(question.customId)) {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketButton${i}.Questions${index} không đúng định dạng hoặc bị trùng lặp! CustomId phải là duy nhất, không trống và không có khoảng trắng`);
        foundErrors.push(`TicketButton${i}.Questions[${index}] không đúng định dạng hoặc bị trùng lặp! CustomId phải là duy nhất, không trống và không có khoảng trắng`);
      } else {
        customIdSet.add(question.customId);
      }

      // Kiểm tra định dạng
      const validStyles = ['short', 'paragraph'];
      if (!validStyles.includes(question.style.toLowerCase())) {
        console.log('\x1b[31m%s[0m', `[WARNING] TicketButton${i}.Questions[${index}] sai định dạng! Định dạng phải giống: ${validStyles.join(', ')}.`);
        foundErrors.push(`TicketButton${i}.Questions[${index}] sai định dạng! Định dạng phải giống: ${validStyles.join(', ')}.`);
      }
    });
  }

  // Kiểm tra role support cho tất cả các nút
  for (let i = 1; i <= 8; i++) {
    const button = config[`TicketButton${i}`];

    if (i !== 1 && !button.Enabled) continue;

    // Kiểm tra SupportRoles là mảng và đúng định dạng
    if (!Array.isArray(button.SupportRoles) || !button.SupportRoles.every(roleid => typeof roleid === 'string')) {
      console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketButton${i}.SupportRoles không đúng định dạng! Ví dụ: ["ROLE_ID", "ROLE_ID"] hoặc ["ROLE_ID"]`);
      foundErrors.push(`TicketButton${i}.SupportRoles không đúng định dạng! Ví dụ: ["ROLE_ID", "ROLE_ID"] hoặc ["ROLE_ID"]`);
      continue;
    }

    button.SupportRoles.forEach(roleid => {
      const role = guild.roles.cache.get(roleid);

      if (!role) {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketButton${i}.SupportRoles không đúng định dạng! (${roleid})`);
        foundErrors.push(`TicketButton${i}.SuportRoles không đúng định dạng!`);
      }
    });
  }

  // Check emojis trong tất cả các nút
  const emojiRegex = require('emoji-regex');
  const discordEmojiRegex = /a?:[a-zA-Z0-9_]+:(\d+)>/;

  for (let i = 1; i <= 8; i++) {
    const ticketButton = config(`TicketButton${i}`);

    if (i !== 1 && !ticketButton.Enabled) continue;

    if (ticketButton.ButtonEmoji) {
      const emojiPattern = emojiRegex();
      const emojiMatch = emojiPattern.exec(ticketButton.ButtonEmoji);
      const discordEmojiMatch = ticketButton.ButtonEmoji.match(discordEmojiRegex);

      if (!emojiMatch && !discordEmojiMatch) {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketButotn${i}.ButtonEmoji sai định dạng icon! (${ticketButton.ButtonEmoji})`);
        foundErrors.push(`TicketButton${i}.ButtonEmoji chứa sai emoji`);
      }
    }
  }

  // Kiểm tra nếu có nhiều hơn 5 câu hỏi trng toàn bộ nút
  for (let i = 1; i <= 8; i++) {
    const ticketButton = config[`TicketButton${i}`];

    if (i !== 1 && !ticketButton.Enabled) continue;

    if (Array.isArray(ticketButton.Questions) && ticketButton.Questions.length > 5) {
      console.log('\x1b[31m%s%s\x1b[0m', `[WARNING] TicketButton${i} có nhiều hơn 5 câu hỏi! (Mỗi danh mục chỉ có tối đa 5 câu hỏi, đây là giới hạn của Discord)`);
      foundErrors.push(`TicketButton${i} có nhiều hơn 5 câu hỏi!`);
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

  // Giáng Sinh
  if (month === 12 && day >= 20 && day <= 27) {
    const messages = [
      `${color.green('🎄 Ho Ho Ho!')} ${color.red('Giáng Sinh vui vẻ!')} ${color.yellow('🎅')}
      ${color.cyan('Chúc bạn xử lý ticket trơn tru mùa lễ này.')}
      ${color.magenta('Hãy nhanh như cỗ xe tuần lộc của ông già Noel nhé!')}`,

      `${color.green('🎄 Mùa lễ hội đã đến!')} ${color.red('Giáng Sinh vui vẻ!')} 🎅
      ${color.cyan('Giải quyết ticket nhanh như ông già Noel phát quà!')}
      ${color.yellow('Hiệu suất của bạn khiến cả các chú lùn cũng phải ghen tị!')}`,

      `${color.green('🎅 Ông già Noel đang quan sát!')} ${color.red('Giáng Sinh vui vẻ!')}
      ${color.cyan('Xử lý ticket đều tay để luôn nằm trong danh sách ngoan!')}
      ${color.magenta('🎁 Tăng tốc độ và năng suất mùa lễ này nhé!')}`,

      `${color.green('🎄 Giáng Sinh vui vẻ!')} 🎅  
      ${color.cyan('Chúc bạn một mùa lễ an vui, nhẹ nhàng và không căng thẳng với ticket!')}
      ${color.yellow('Hộp thư của bạn luôn sáng rực rỡ!')}`,

      `${color.green('🎁 Ho Ho Ho!')} ${color.red('Giáng Sinh vui vẻ!')}
      ${color.cyan('Giải quyết ticket với tinh thần lễ hội và ly cacao nóng!')}
      ${color.yellow('Các chú lùn cũng phải ngưỡng mộ năng suất của bạn!')}`
    ];
    return randomMessage(messages);
  }

  // Năm Mới
  if (month === 1 && day >= 1 && day <= 3) {
    const messages = [
      `${color.yellow('🎆 Chúc Mừng Năm Mới!')} ${color.blue('🎇')}
      ${color.cyan('Năm mới, quyết tâm mới — không để tồn đọng ticket!')}
      ${color.magenta('🎉 Hãy làm cho năm nay thật tuyệt vời!')}`,

      `${color.yellow('🎇 Chào đón khởi đầu mới!')} ${color.blue('Chúc Mừng Năm Mới!')}  
      ${color.cyan('Giải quyết ticket nhanh hơn cả pháo hoa!')}
      ${color.magenta('Giữ cho mọi thứ luôn mượt mà cả năm nhé!')}`,

      `${color.yellow('🎉 Năm mới, bạn vẫn tuyệt vời như cũ!')} ${color.blue('🎇')}
      ${color.cyan('Chúc bạn thêm một năm xử lý ticket xuất sắc!')}
      ${color.magenta('🎆 Tỏa sáng với hiệu suất của bạn!')}`,

      `${color.yellow('✨ Chúc một năm tuyệt vời phía trước!')} ${color.blue('🎇')}
      ${color.cyan('Tạm biệt cái cũ, chào đón cái đã xử lý!')}
      ${color.magenta('🎉 Bạn là MVP của đội xử lý ticket!')}`,

      `${color.yellow('🎆 Pháo hoa trên trời, hiệu suất trong queue!')}  
      ${color.cyan('Chúc Mừng Năm Mới! 🎇')}`
    ];
    return randomMessage(messages);
  }

  // Halloween
  if (month === 10 && day === 31) {
    const messages = [
      `${color.orange('🎃 Chúc Mừng Halloween!')} ${color.gray('👻')}
      ${color.cyan('Đừng để ticket ma ám bạn!')}
      ${color.magenta('Xử lý chúng trước khi đồng hồ điểm nửa đêm!')}
             .-"      "-.  
           .'    👻     '.  
          /      RIP      \\`,

      `${color.orange('🎃 Mùa ma quái đến rồi!')}  
      ${color.cyan('Cẩn thận với các ticket ma đang rình rập trong bóng tối!')}
      ${color.magenta('Xử lý chúng để người dùng luôn vui vẻ!')}`,

      `${color.orange('👻 Hù!')} ${color.cyan('Chúc Mừng Halloween!')}  
      ${color.magenta('Dọa bay mọi delay bằng tốc độ phản hồi siêu nhanh!')}`,

      `${color.orange('🎃 Trick or Treat?')}  
      ${color.cyan('Giải quyết ticket nhanh hơn cả chổi phù thủy!')}`,

      `${color.orange('🦇 Đừng phát điên nha!')} ${color.cyan('Chúc Mừng Halloween!')}  
      ${color.magenta('Giữ queue sạch sẽ và người dùng luôn vui!')}`
    ];
    return randomMessage(messages);
  }

  // Lễ Tình Nhân
  if (month === 2 && day === 14) {
    const messages = [
      `${color.magenta('💖 Chúc Mừng Ngày Valentine!')}  
      ${color.cyan('Thể hiện tình yêu bằng phản hồi nhanh chóng!')}
      ${color.yellow('Người dùng sẽ yêu quý bạn lắm đó!')}`,

      `${color.magenta('💌 Tình yêu lan tỏa trong không khí!')}  
      ${color.cyan('Giải quyết ticket với sự dịu dàng và tử tế!')}`,

      `${color.magenta('💕 Lan tỏa yêu thương!')} ${color.cyan('Chúc Mừng Ngày Valentine!')}  
      ${color.yellow('Phản hồi nhanh là món quà Valentine tuyệt vời nhất!')}`,

      `${color.magenta('💝 Thể hiện tình yêu với queue của bạn!')}  
      ${color.cyan('Dọn dẹp sạch sẽ và làm người dùng hạnh phúc!')}`,

      `${color.magenta('💖 Phản hồi nhanh = trái tim vui vẻ!')}  
      ${color.cyan('Hãy làm Valentine này thật đặc biệt cho người dùng của bạn!')}`
    ];
    return randomMessage(messages);
  }

  // Mặc định nếu không có dịp lễ
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
      attachment = await disordTranscripts.createTranscript(interaction.channel, {
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
      attachment = await disordTranscripts.createTranscript(channel, {
        limit: -1,
        minify: false,
        saveImages: config.TicketTranscriptSettings.saveImages,
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

const stripeModel = require('./models/stripeInvoicesModel.js');
const paypalModel = require('./models/paypalInvoicesModel.js');
const { error } = require('console');

// Kiểm tra thanh toán mới
// Phát hiện thanh toán Stripe
exports.checkStripePayments = async function () {
  let guild = client.guilds.cache.get(config.GuildID);

  try {
    const filtered = await stripeModel.find({ status: 'open' });

    if (!filtered.length) return;

    for (const eachPayment of filtered) {
      let channel = guild.channels.cache.get(eachPayment.channelID);
      let user = guild.members.cache.get(eachPayment.userID);
      let session;

      if (user) {
        session = await client.stripe.invoices.retrieve(eachPayment.invoiceID);

        if (!session || !channel) {
          await stripeModel.deleteMany({ invoiceID: eachPayment.invoiceID });
        }

        if (session.status === 'paid') {
          await stripeModel.updateOne({ invoiceID: session.id }, { $set: { status: 'paid' } });
          await stripeModel.updateOne({ invoiceID: session.id }, { $set: { status: 'deleted' } });
        }
      }

      if (channel && user && session && session.status === 'paid') {
        await channel.messages.fetch(eachPayment.messageID).then(async msg => {
          const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setStyle('Link')
              .setURL(`https://stripe.com`)
              .setLabel(config.Locale.PayPalPayInvoice)
              .setDisabled(true),
            new ButtonBuilder()
              .setCustomId(`${session.id}-paid`)
              .setStyle('Success')
              .setLabel(config.StripeSettings.StatusPaid)
              .setDisabled(true));

          let customerRole = guild.roles.cache.get(config.StripeSettings.RoleToGive);
          if (customerRole) user.roles.add(customerRole)

          const embed = msg.embeds[0];
          const embedColor = EmbedBuilder.from(embed);
          embedColor.setColor("Green");
          await msg.edit({ embeds: [embedColor], components: [row] });
        });
      }
    }
  } catch (error) {
    console.error('Lỗi ở checkStripePayments:', error);
  }
};

exports.CheckPayPalPayments = async function () {
  const guild = client.guilds.cache.get(config.GuildID);

  try {
    const filtered = await paypalModel.find({ status: 'DRAFT' });

    if (!filtered.length) return;

    for (const eachPayment of filtered) {
      const channel = guild.channels.cache.get(eachPayment.channelID);
      const user = guild.members.cache.get(eachPayment.userID);

      if (user) {
        client.paypal.invoice.get(eachPayment.invoiceID, async function (error, invoice) {
          if (error) {
            if (error.reponse.error === "invalid_client") {
              console.log('\x1b[31m%s\x1b[0m', `[ERROR] Thông tin xác thực API PayPal mà bạn chỉ định trong cấu hình không hợp lệ! Hãy đảm bảo bạn sử dụng chế độ "LIVE"!`);
            } else {
              console.error(`Đã xảy ra lỗi khi kiểm tra hóa đơn có ID ${eachPayment.invoiceID}, (${error.message}), Hóa đơn này đã tự động bị xóa khỏi cơ sở dữ liệu.`);
              await paypalModel.deleteMany({ invoiceID: eachPayment.invoiceID });
            }
          } else {
            if (!channel || !invoice) {
              await paypalModel.deleteMany({ invoiceID: invoice.id });
            }

            if (invoice.status === 'PAID') {
              await paypalModel.updateOne({ invoiceID: invoice.id }, { $set: { status: 'paid' } });
            }

            if (invoice && channel && user && invoice.status === 'PAID') {
              channel.messages.fetch(eachPayment.messageID)
                .catch(e => { })
                .then(async msg => {
                  const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                      .setStyle('Link')
                      .setURL(`https://paypal.com`)
                      .setLabel(config.Locale.PayPalPayInvoice)
                      .setDisabled(true),
                    new ButtonBuilder()
                      .setCustomId(`${invoice.id}-paid`)
                      .setStyle('Success')
                      .setLabel(config.PayPalSettings.StatusPaid)
                      .setDisabled(true));

                  const embed = msg.embeds[0];
                  const embedColor = EmbedBuilder.from(embed)
                    .setColor('Green');

                  let customerRole = guild.roles.cache.get(config.PayPalSettings.RoleToGive);
                  if (customerRole) user.roles.add(customerRole)

                  await msg.edit({ embeds: [embedColor], components: [row] });
                });
            }
          }
        });
      }
    }
  } catch (error) {
    console.error('Lỗi ở checkPayPalPayments:', error);
  }
};

exports.checkIfUserHasSupportRoles = async function (interaction, message) {
  let supportRole = false;
  let context = interaction || message;

  const ticketDB = await ticketModel.findOne({ channelID: context.channel.id });

  if (!ticketDB) {
    console.log('\x1b[31m%s\x1b[0m', '[SUPPORT ROLE CHECK] Không tìm thấy database');
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
  if (error.message.includes('Used disallowed intents')) {
    console.log(
      '\x1b[31m%s\x1b[0m',
      `Sử dụng các mục đích không được phép (ĐỌC CÁCH KHẮC PHỤC): \n\nBạn chưa bật Privileged Gateway Intents trong Discord Developer Portal!
      Để khắc phục điều này, bạn phải bật tất cả các ý định cổng đặc quyền trong Cổng thông tin nhà phát triển Discord của mình. Mở cổng thông tin, đi đến ứng dụng của bạn, nhấp vào "Bot" ở bên trái, cuộn xuống và bật Ý định hiện diện, Ý định thành viên máy chủ và Ý định nội dung tin nhắn.`
    );
    process.exit();
  } else if (error.message.includes('An invalid token was provided')) {
    console.log('\x1b[31m%s\x1b[0m', `[ERROR] Mã thông báo bot được chỉ định trong cấu hình không đúng`);
    process.exit();
  } else {
    console.log('\x1b[31m%s\x1b[0m', `[ERROR] Đã xảy ra lỗi khi cố gắng đăng nhập vào bot`);
    console.log(error);
    process.exit();
  }
});