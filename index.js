if (process.platform !== "win32") require("child_process").exec("npm install");

const color = require('ansi-colors');
const axios = require('axios');
console.log(`${color.yellow(`Khởi động bot, có thể mất chút thời gian...`)}`);
const fs = require('fs');

const version = Number(process.version.split('.')[0].replace('v', ''));
if (version < 18) {
  console.log(`${color.red(`[ERROR] ZenKho Ticket Bot yêu cầu NodeJS 18 hoặc cao hơn!\nBạn có thể kiểm tra phiên bản NodeJS bằng lệnh "node -v" trong terminal.`)}`);

  console.log(`${color.blue(`\n[INFO] Để cập nhật Node.js, làm theo hướng dẫn sau trong:`)}`);
  console.log(`${color.green(`- Windows:`)} Tải và chạy phần mềm từ ${color.cyan(`https:/nodejs.org/`)}`);
  console.log(`${color.green(`- Ubuntu/Debian:`)} Chạy lệnh ở dưới trong Terminal:`);
  console.log(`${color.cyan(`   - sudo apt update`)}`);
  console.log(`${color.cyan(`   - sudo apt upgrade nodejs`)}`);
  console.log(`${color.green(`- CentOS:`)} Chạy lệnh ở dưới trên Terminal:`);
  console.log(`${color.cyan(`   - sudo yum update`)}`);
  console.log(`${color.cyan(`   -sudo yum install -y nodejs`)}`);

  let logMsg = `\n\n[${new Date().toLocaleString()}] [ERROR] ZenKho Ticket Bot yêu cầu NodeJS 18 hoặc cao hơn!`;
  fs.appendFile("./logs.txt", logMsg, (e) => {
    if (e) console.log(e);
  });
  process.exit()
}

const packageFile = require('./package.json');
let logMsg = `\n\n[${new Date().toLocaleString()}] [STARTING] Thử khởi động bot..\nPhiên bản NodeJS: ${process.version}\nPhiên bản bot: ${packageFile.version}`;
fs.appendFile("./logs.txt", logMsg, (e) => {
  if(e) console.log(e);
});

const { Collection, Client, Discord, ActionRowBuilder, ButtonBuilder, GatewayIntentBits, ActivityType } = require('discord.js');
const yaml = require('js-yaml');
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
  prosence: {
    status: 'dnd',
    activities: [{ name: 'Khởi động...', type: ActivityType.Playing }]
  },
  retryLimit: 3
});

let config = ""
try {
  config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
} catch (e) {
  if (e instanceof yaml.YAMLException) {
    console.error(color.red('Đã có lỗi ở trong file config.yml'), e.message);
    console.error(``);
    console.error(color.yellow(`Vị trí lỗi: Dòng ${e.mark.line + 1}, Cột ${e.mark.column + 1}`));
    console.error(``);

    console.error(color.red('THÔNG TIN QUAN TRỌNG:'));
    console.error(color.yellow('Các tệp YAML có quy định nghiêm ngặt về cách sắp xếp và định vị văn bản'))
    console.error(color.yellow('Đảm bảo mỗi dòng được căn chỉnh chính xác.'));
    console.error(color.yellow('Sử dụng khoảng cách để thụt lề và giữ cho chúng thống nhất.'));
    console.error(color.yellow('Kiểm tra xem mỗi phần có bắt đầu bằng đúng số khoảng trắng hay không.'));
    console.error(color.yellow('Thông báo ở trên sẽ hiển thị phần không được định dạng đúng và vị trí.'));
  } else {
    console.error(color.red('Lỗi đọc file cấu hình:'), e.message);
  }
  process.exit(1);
}

module.exports = client
require("./utils.js");

const utils = require("./utils.js");
const { error } = require("console");
const createTranscriptFolder = async () => {
  let dashboardExists = await utils.checkDashboard();
  if (config.TicketTranscriptSettings.SaveInFolder && !dashboardExists && !fs.existsSync('./transcripts')) fs.mkdirSync('./transcripts');
  if (dashboardExists && !fs.existsSync('./addons/Dashboard/transcripts')) fs.mkdirSync('./addons/Dashboard/transcripts');
};
createTranscriptFolder()

async function uploadToHaste(textToUpload) {
  try {
    const response = await axios.post('https://paste.plexdevelopment.net/documents', textToUpload);
    return response.data.key;
  } catch (error) {
    if (error.response) {
      console.error('Lỗi khi upload lên Haste. Trạng thái:', error.response.status);
      console.error('Dữ liệu trả về:', error.response.data);
    } else {
      console.error('Lỗi khi upload lên Haste:', error.message);
    }
    return null;
  }
}

const filePath = './logs.txt';
const maxLength = 300;

async function handleAndUploadError(erroType, error) {
  console.log(error);

  const errorPrefix = `[${new Date().toLocaleString()}] [${erroType}] [v${packageFile.version}]`;
  const errorMsg = `\n\n${errorPrefix}\n${error.stack}`;
  fs.appendFile("./logs.txt", errorMsg, (e) => {
    if (e) console.log(e);
  });

  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      console.error('Lỗi khi đọc file:', err.message);
      return;
    }

    const lines = data.split('\n');
    const truncatedContent = lines.length > maxLength ? lines.slice(-maxLength).join('\n') : data;

    uploadToHaste(truncatedContent).then(key => {
      if (key) {
        const hasteURL = `https://paste.plexdevelopment.net/${key}`;
        console.log(`${color.green.bold(`[${packageFile.version}]`)} ${color.red(`Nếu bạn cần hỗ trợ, hãy tạo một phiếu trên máy chủ Discord của chúng tôi và chia sẻ liên kết này:`)} ${color.yellow(hasteURL)}\n\n`);
      } else {
        console.log('Dán và upload thất bại.');
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