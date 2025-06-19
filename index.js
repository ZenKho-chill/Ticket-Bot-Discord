if (process.platform !== "win32") require("child_process").exec("npm install");


const color = require('ansi-colors');
const axios = require('axios');
console.log(`${color.yellow(`Bắt đầu bot, điều này có thể mất một lúc ..`)}`);
const fs = require('fs');

const version = Number(process.version.split('.')[0].replace('v', ''));
if (version < 18) {
  console.log(`${color.red(`[ERROR] ZenKho Ticket Yêu cầu phiên bản NodeJS từ 18 trở lên!\nBạn có thể kiểm tra NodeJS của mình bằng cách chạy lệnh "Node -v" trong terminal của bạn.`)}`);

  console.log(`${color.blue(`\n[INFO] Để cập nhật Node.js, hãy làm theo các hướng dẫn bên dưới cho hệ điều hành của bạn:`)}`);
  console.log(`${color.green(`- Windows:`)} Tải xuống và chạy trình cài đặt từ ${color.cyan(`https://nodejs.org/`)}`);
  console.log(`${color.green(`- Ubuntu/Debian:`)} Chạy các lệnh sau trong Terminal:`);
  console.log(`${color.cyan(`  - sudo apt update`)}`);
  console.log(`${color.cyan(`  - sudo apt upgrade nodejs`)}`);
  console.log(`${color.green(`- CentOS:`)} Chạy các lệnh sau trong Terminal:`);
  console.log(`${color.cyan(`  - sudo yum update`)}`);
  console.log(`${color.cyan(`  - sudo yum install -y nodejs`)}`);

  let logMsg = `\n\n[${new Date().toLocaleString()}] [ERROR] ZenKho Ticket Yêu cầu phiên bản NodeJS từ 18 trở lên!`;
  fs.appendFile("./logs.txt", logMsg, (e) => { 
    if(e) console.log(e);
  });

  process.exit()
}

const packageFile = require('./package.json');
let logMsg = `\n\n[${new Date().toLocaleString()}] [STARTING] Cố gắng bắt đầu bot ..\nNodeJS Phiên bản: ${process.version}\nPhiên bản bot: ${packageFile.version}`;
fs.appendFile("./logs.txt", logMsg, (e) => { 
  if(e) console.log(e);
});

const { Collection, Client, Discord, ActionRowBuilder, ButtonBuilder, GatewayIntentBits, ActivityType } = require('discord.js');
const yaml = require("js-yaml")
const client = new Client({ 
  restRequestTimeout: 60000,
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.GuildMembers, 
    GatewayIntentBits.GuildPresences, 
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessageReactions
  ],
  presence: {
    status: 'dnd',
    activities: [{ name: 'Bắt đầu ...', type: ActivityType.Playing }]
  },
  retryLimit: 3
});

let config = ""
try {
  config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
  } catch (e) {
    if (e instanceof yaml.YAMLException) {
      console.error(color.red('Một lỗi đã được tìm thấy trong tệp config.yml của bạn'), e.message);
      console.error(``);
      console.error(color.yellow(`Vị trí lỗi: dòng ${e.mark.line + 1}, Cột ${e.mark.column + 1}`));
      console.error(``);

      console.error(color.red('Thông tin quan trọng:'));
      console.error(color.yellow('Các tập tin YAML nghiêm ngặt về cách văn bản được đặt và định vị.'));
      console.error(color.yellow('Hãy chắc chắn rằng mọi dòng được xếp hàng chính xác.'));
      console.error(color.yellow('Sử dụng không gian để thụt lề và giữ chúng nhất quán.'));
      console.error(color.yellow('Kiểm tra xem mỗi phần bắt đầu với số lượng không gian phù hợp.'));
      console.error(color.yellow('Thông báo trên sẽ hiển thị phần không được định dạng đúng và vị trí.'));
    } else {
      console.error(color.red('Lỗi khi đọc tệp cấu hình:'), e.message);
    }
    process.exit(1); 
  }

module.exports = client
require("./utils.js");

const utils = require("./utils.js");
const createTranscriptFolder = async () => {
  let dashboardExists = await utils.checkDashboard();
  if(config.TicketTranscriptSettings.SaveInFolder && !dashboardExists && !fs.existsSync('./transcripts')) fs.mkdirSync('./transcripts');
  if(dashboardExists && !fs.existsSync('./addons/Dashboard/transcripts')) fs.mkdirSync('./addons/Dashboard/transcripts');
};
createTranscriptFolder()


async function uploadToHaste(textToUpload) {
  try {
    const response = await axios.post('https://paste.plexdevelopment.net/documents', textToUpload);
    return response.data.key;
  } catch (error) {
    if (error.response) {
      console.error('Lỗi tải lên để Haste-Server.Trạng thái:', error.response.status);
      console.error('Dữ liệu phản hồi:', error.response.data);
    } else {
      console.error('Tải lên Lỗi lên Haste-Server:', error.message);
    }
    return null;
  }
}

const filePath = './logs.txt';
const maxLength = 300;

async function handleAndUploadError(errorType, error) {
  console.log(error);

  const errorPrefix = `[${new Date().toLocaleString()}] [${errorType}] [v${packageFile.version}]`;
  const errorMsg = `\n\n${errorPrefix}\n${error.stack}`;
  fs.appendFile("./logs.txt", errorMsg, (e) => {
    if (e) console.log(e);
  });

  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error('Lỗi khi đọc tệp:', err.message);
      return;
    }

    const lines = data.split('\n');
    const truncatedContent = lines.length > maxLength ? lines.slice(-maxLength).join('\n') : data;

    uploadToHaste(truncatedContent).then(key => {
      if (key) {
        const hasteURL = `https://paste.plexdevelopment.net/${key}`;
        console.log(`${color.green.bold(`[v${packageFile.version}]`)} ${color.red(`Nếu bạn yêu cầu hỗ trợ, hãy tạo vé trong máy chủ Discord của chúng tôi và chia sẻ liên kết này:`)} ${color.yellow(hasteURL)}\n\n`);
      } else {
        console.log('Tải lên không thành công.');
      }
    });
  });
}

client.on('warn', async (error) => {
  handleAndUploadError('WARN', error);
});

client.on('error', async (error) => {
  handleAndUploadError('ERROR', error);
});

process.on('unhandledRejection', async (error) => {
  handleAndUploadError('unhandledRejection', error);
});

process.on('uncaughtException', async (error) => {
  handleAndUploadError('uncaughtException', error);
});
