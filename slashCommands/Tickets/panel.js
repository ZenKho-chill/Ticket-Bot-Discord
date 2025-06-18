const { SlashCommandBuilder } = require('@discordjs/builders');
const { Discord, ActionRowBuilder, ButtonBuilder, EmbedBuilder, StringSelectMenuBuilder, ButtonStyle } = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'))
const moment = require('moment-timezone');
const ticketPanelModel = require("../../models/ticketPanelModel");

const workingHoursRegex = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/;

module.exports = {
  enabled: commands.Ticket.Panel.Enabled,
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription(commands.Ticket.Panel.Description),
  async execute(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    if (!interaction.guild.channels.cache.get(config.TicketSettings.LogsChannelID)) return console.log('\x1b[31m%s\x1b[0m', `[WARNING] TicketSettings.LogsChannelID không phải là kênh hợp lệ!`)
    if (!interaction.member.permissions.has("Administrator")) return interaction.editReply({ content: config.Locale.NoPermsMessage, ephemeral: true });

    if (config.TicketButton1.ButtonColor === "Blurple") config.TicketButton1.ButtonColor = ButtonStyle.Primary
    if (config.TicketButton1.ButtonColor === "Gray") config.TicketButton1.ButtonColor = ButtonStyle.Secondary
    if (config.TicketButton1.ButtonColor === "Green") config.TicketButton1.ButtonColor = ButtonStyle.Success
    if (config.TicketButton1.ButtonColor === "Red") config.TicketButton1.ButtonColor = ButtonStyle.Danger

    if (config.TicketButton2.ButtonColor === "Blurple") config.TicketButton2.ButtonColor = ButtonStyle.Primary
    if (config.TicketButton2.ButtonColor === "Gray") config.TicketButton2.ButtonColor = ButtonStyle.Secondary
    if (config.TicketButton2.ButtonColor === "Green") config.TicketButton2.ButtonColor = ButtonStyle.Success
    if (config.TicketButton2.ButtonColor === "Red") config.TicketButton2.ButtonColor = ButtonStyle.Danger

    if (config.TicketButton3.ButtonColor === "Blurple") config.TicketButton3.ButtonColor = ButtonStyle.Primary
    if (config.TicketButton3.ButtonColor === "Gray") config.TicketButton3.ButtonColor = ButtonStyle.Secondary
    if (config.TicketButton3.ButtonColor === "Green") config.TicketButton3.ButtonColor = ButtonStyle.Success
    if (config.TicketButton3.ButtonColor === "Red") config.TicketButton3.ButtonColor = ButtonStyle.Danger

    if (config.TicketButton4.ButtonColor === "Blurple") config.TicketButton4.ButtonColor = ButtonStyle.Primary
    if (config.TicketButton4.ButtonColor === "Gray") config.TicketButton4.ButtonColor = ButtonStyle.Secondary
    if (config.TicketButton4.ButtonColor === "Green") config.TicketButton4.ButtonColor = ButtonStyle.Success
    if (config.TicketButton4.ButtonColor === "Red") config.TicketButton4.ButtonColor = ButtonStyle.Danger

    if (config.TicketButton5.ButtonColor === "Blurple") config.TicketButton5.ButtonColor = ButtonStyle.Primary
    if (config.TicketButton5.ButtonColor === "Gray") config.TicketButton5.ButtonColor = ButtonStyle.Secondary
    if (config.TicketButton5.ButtonColor === "Green") config.TicketButton5.ButtonColor = ButtonStyle.Success
    if (config.TicketButton5.ButtonColor === "Red") config.TicketButton5.ButtonColor = ButtonStyle.Danger

    if (config.TicketButton6.ButtonColor === "Blurple") config.TicketButton6.ButtonColor = ButtonStyle.Primary
    if (config.TicketButton6.ButtonColor === "Gray") config.TicketButton6.ButtonColor = ButtonStyle.Secondary
    if (config.TicketButton6.ButtonColor === "Green") config.TicketButton6.ButtonColor = ButtonStyle.Success
    if (config.TicketButton6.ButtonColor === "Red") config.TicketButton6.ButtonColor = ButtonStyle.Danger

    if (config.TicketButton7.ButtonColor === "Blurple") config.TicketButton7.ButtonColor = ButtonStyle.Primary
    if (config.TicketButton7.ButtonColor === "Gray") config.TicketButton7.ButtonColor = ButtonStyle.Secondary
    if (config.TicketButton7.ButtonColor === "Green") config.TicketButton7.ButtonColor = ButtonStyle.Success
    if (config.TicketButton7.ButtonColor === "Red") config.TicketButton7.ButtonColor = ButtonStyle.Danger

    if (config.TicketButton8.ButtonColor === "Blurple") config.TicketButton8.ButtonColor = ButtonStyle.Primary
    if (config.TicketButton8.ButtonColor === "Gray") config.TicketButton8.ButtonColor = ButtonStyle.Secondary
    if (config.TicketButton8.ButtonColor === "Green") config.TicketButton8.ButtonColor = ButtonStyle.Success
    if (config.TicketButton8.ButtonColor === "Red") config.TicketButton8.ButtonColor = ButtonStyle.Danger


    const button1 = new ButtonBuilder()
    button1.setCustomId('button1')
    button1.setLabel(config.TicketButton1.TicketName)
    button1.setStyle(config.TicketButton1.ButtonColor)
    if (config.TicketButton1.ButtonEmoji) button1.setEmoji(config.TicketButton1.ButtonEmoji)

    const button2 = new ButtonBuilder()
    button2.setCustomId('button2')
    button2.setLabel(config.TicketButton2.TicketName)
    button2.setStyle(config.TicketButton2.ButtonColor)
    if (config.TicketButton2.ButtonEmoji) button2.setEmoji(config.TicketButton2.ButtonEmoji)

    const button3 = new ButtonBuilder()
    button3.setCustomId('button3')
    button3.setLabel(config.TicketButton3.TicketName)
    button3.setStyle(config.TicketButton3.ButtonColor)
    if (config.TicketButton3.ButtonEmoji) button3.setEmoji(config.TicketButton3.ButtonEmoji)

    const button4 = new ButtonBuilder()
    button4.setCustomId('button4')
    button4.setLabel(config.TicketButton4.TicketName)
    button4.setStyle(config.TicketButton4.ButtonColor)
    if (config.TicketButton4.ButtonEmoji) button4.setEmoji(config.TicketButton4.ButtonEmoji)

    const button5 = new ButtonBuilder()
    button5.setCustomId('button5')
    button5.setLabel(config.TicketButton5.TicketName)
    button5.setStyle(config.TicketButton5.ButtonColor)
    if (config.TicketButton5.ButtonEmoji) button5.setEmoji(config.TicketButton5.ButtonEmoji)

    let row = ""
    if (!config.TicketButton2.Enabled && !config.TicketButton3.Enabled && !config.TicketButton4.Enabled && !config.TicketButton5.Enabled) row = new ActionRowBuilder().addComponents(button1);
    if (config.TicketButton2.Enabled && !config.TicketButton3.Enabled && !config.TicketButton4.Enabled && !config.TicketButton5.Enabled) row = new ActionRowBuilder().addComponents(button1, button2);
    if (config.TicketButton2.Enabled && config.TicketButton3.Enabled && !config.TicketButton4.Enabled && !config.TicketButton5.Enabled) row = new ActionRowBuilder().addComponents(button1, button2, button3);
    if (config.TicketButton2.Enabled && config.TicketButton3.Enabled && !config.TicketButton4.Enabled && config.TicketButton5.Enabled) row = new ActionRowBuilder().addComponents(button1, button2, button3, button5);
    if (config.TicketButton2.Enabled && config.TicketButton3.Enabled && config.TicketButton4.Enabled && !config.TicketButton5.Enabled) row = new ActionRowBuilder().addComponents(button1, button2, button3, button4);
    if (config.TicketButton2.Enabled && config.TicketButton3.Enabled && config.TicketButton4.Enabled && config.TicketButton5.Enabled) row = new ActionRowBuilder().addComponents(button1, button2, button3, button4, button5);
    if (config.TicketButton2.Enabled && !config.TicketButton3.Enabled && config.TicketButton4.Enabled && config.TicketButton5.Enabled) row = new ActionRowBuilder().addComponents(button1, button2, button4, button5);
    if (config.TicketButton2.Enabled && !config.TicketButton3.Enabled && !config.TicketButton4.Enabled && config.TicketButton5.Enabled) row = new ActionRowBuilder().addComponents(button1, button2, button5);
    if (config.TicketButton2.Enabled && !config.TicketButton3.Enabled && config.TicketButton4.Enabled && !config.TicketButton5.Enabled) row = new ActionRowBuilder().addComponents(button1, button2, button4);
    if (!config.TicketButton2.Enabled && config.TicketButton3.Enabled && config.TicketButton4.Enabled && config.TicketButton5.Enabled) row = new ActionRowBuilder().addComponents(button1, button3, button4, button5);
    if (!config.TicketButton2.Enabled && config.TicketButton3.Enabled && config.TicketButton4.Enabled && !config.TicketButton5.Enabled) row = new ActionRowBuilder().addComponents(button1, button3, button4);
    if (!config.TicketButton2.Enabled && !config.TicketButton3.Enabled && config.TicketButton4.Enabled && !config.TicketButton5.Enabled) row = new ActionRowBuilder().addComponents(button1, button4);
    if (!config.TicketButton2.Enabled && !config.TicketButton3.Enabled && config.TicketButton4.Enabled && config.TicketButton5.Enabled) row = new ActionRowBuilder().addComponents(button1, button4, button5);

    let startTimestamp = "Giờ làm việc đã bị vô hiệu hóa!";
    let endTimestamp = "Giờ làm việc đã bị vô hiệu hóa!";

    if (config.WorkingHours && config.WorkingHours.Enabled) {
      const currentDay = moment().tz(config.WorkingHours.Timezone).format('dddd');
      const workingHours = config.WorkingHours.Schedule[currentDay];

      if (!workingHours) {
        console.log('\x1b[31m%s\x1b[0m', `[ERROR] Giờ làm việc không được cấu hình cho ${currentDay}. Liên hệ với bộ phận hỗ trợ và cung cấp tệp config.yml của bạn.`);
        return;
      }

      const workingHoursMatch = workingHours.match(workingHoursRegex);

      if (!workingHoursMatch) {
        console.log('\x1b[31m%s\x1b[0m', `[ERROR] Cấu hình giờ làm việc không hợp lệ cho ${currentDay} (định dạng). Liên hệ với bộ phận hỗ trợ và cung cấp tệp config.yml của bạn.`);
        return;
      }

      const currentTime = moment().tz(config.WorkingHours.Timezone);
      const startDate = currentTime.format('YYYY-MM-DD');

      const startTime = moment.tz(startDate + ' ' + workingHoursMatch[1], 'YYYY-MM-DD H:mm', config.WorkingHours.Timezone);
      const endTime = moment.tz(startDate + ' ' + workingHoursMatch[2], 'YYYY-MM-DD H:mm', config.WorkingHours.Timezone);

      if (!startTime.isValid() || !endTime.isValid() || startTime.isSameOrAfter(endTime)) {
        console.log('\x1b[31m%s\x1b[0m', `[ERROR] Cấu hình giờ làm việc không hợp lệ cho ${currentDay}. Liên hệ với bộ phận hỗ trợ và cung cấp tệp config.yml của bạn.`);
        return;
      }

      startTimestamp = startTime.unix();
      endTimestamp = endTime.unix();
    }

    let workingHoursEmbedLocale = config.TicketPanelSettings.Embed.Description
      .replace(/{workingHours-startTime}/g, `<t:${startTimestamp}:t>`)
      .replace(/{workingHours-endTime}/g, `<t:${endTimestamp}:t>`);

    const workingHoursPlaceholders = {};

    for (const day in config.WorkingHours.Schedule) {
      const hours = config.WorkingHours.Schedule[day];
      const match = hours.match(workingHoursRegex);
      if (match) {
        const start = moment.tz(`${moment().format('YYYY-MM-DD')} ${match[1]}`, 'YYYY-MM-DD H:mm', config.WorkingHours.Timezone);
        const end = moment.tz(`${moment().format('YYYY-MM-DD')} ${match[2]}`, 'YYYY-MM-DD H:mm', config.WorkingHours.Timezone);
        workingHoursPlaceholders[`{workingHours-startTime-${day}}`] = `<t:${start.unix()}:t>`;
        workingHoursPlaceholders[`{workingHours-endTime-${day}}`] = `<t:${end.unix()}:t>`;
      } else {
        console.log('\x1b[31m%s\x1b[0m', `[ERROR] Cấu hình giờ làm việc không hợp lệ cho ${day} (định dạng). Liên hệ với bộ phận hỗ trợ và cung cấp tệp config.yml của bạn.`);
      }
    }

    for (const [placeholder, value] of Object.entries(workingHoursPlaceholders)) {
      workingHoursEmbedLocale = workingHoursEmbedLocale.replace(new RegExp(placeholder, 'g'), value);
    }

    const ticketEmbed = new EmbedBuilder()
    if (config.TicketPanelSettings.Embed.Title) ticketEmbed.setTitle(config.TicketPanelSettings.Embed.Title)
    ticketEmbed.setDescription(workingHoursEmbedLocale)
    if (config.TicketPanelSettings.Embed.Color) ticketEmbed.setColor(config.TicketPanelSettings.Embed.Color)
    if (!config.TicketPanelSettings.Embed.Color) ticketEmbed.setColor(config.EmbedColors)
    if (config.TicketPanelSettings.Embed.PanelImage) ticketEmbed.setImage(config.TicketPanelSettings.Embed.PanelImage)
    if (config.TicketPanelSettings.Embed.CustomThumbnailURL) ticketEmbed.setThumbnail(config.TicketPanelSettings.Embed.CustomThumbnailURL)
    if (config.TicketPanelSettings.Embed.Footer.Enabled && config.TicketPanelSettings.Embed.Footer.text) ticketEmbed.setFooter({ text: `${config.TicketPanelSettings.Embed.Footer.text}` })
    if (config.TicketPanelSettings.Embed.Footer.Enabled && config.TicketPanelSettings.Embed.Footer.text && config.TicketPanelSettings.Embed.Footer.CustomIconURL) ticketEmbed.setFooter({ text: `${config.TicketPanelSettings.Embed.Footer.text}`, iconURL: `${config.TicketPanelSettings.Embed.Footer.CustomIconURL}` })
    if (config.TicketPanelSettings.Embed.Timestamp) ticketEmbed.setTimestamp()

    const options = [];

    options.push({
      label: config.TicketButton1.TicketName,
      value: "button1",
      description: config.TicketButton1.Description,
      emoji: config.TicketButton1.ButtonEmoji,
    });

    for (let i = 2; i <= 8; i++) {
      const ticketButton = config[`TicketButton${i}`];
      if (ticketButton.Enabled) {
        options.push({
          label: ticketButton.TicketName,
          value: `button${i}`,
          description: ticketButton.Description,
          emoji: ticketButton.ButtonEmoji,
        });
      }
    }

    options.forEach((item) => {
      if (!item.emoji) delete item.emoji;
      if (!item.description) delete item.description;
    });

    let sMenu = new StringSelectMenuBuilder()
      .setCustomId("categorySelect")
      .setPlaceholder(config.Locale.selectCategory)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(options);

    let sRow = new ActionRowBuilder().addComponents(sMenu);
    if (config.TicketSettings.SelectMenu === false) {
      interaction.channel.send({ embeds: [ticketEmbed], components: [row] });
      interaction.editReply({ content: `Đã gửi bảng ticket thành công tới kênh này!`, ephemeral: true })
    }
    try {
      if (config.TicketSettings.SelectMenu) {
        const msg = await interaction.channel.send({ embeds: [ticketEmbed], components: [sRow] });

        const newDocument = new ticketPanelModel({
          guildID: config.GuildID,
          selectMenuOptions: options,
          msgID: msg.id,
        });

        await newDocument.save();
        await interaction.editReply({ content: `Đã gửi bảng ticket thành công tới kênh này!`, ephemeral: true });
      }
    } catch (error) {
      console.error('[ERROR] Không gửi được bảng ticket yêu cầu hoặc không lưu vào cơ sở dữ liệu:', error);
      interaction.editReply({ content: `❌ Không gửi được bảng ticket. Bảng ticket chưa được lưu vào cơ sở dữ liệu và sẽ không hoạt động. Hãy thử chạy lại lệnh hoặc liên hệ với bộ phận hỗ trợ.`, ephemeral: true });
    }
  }

}