const { Discord, ActionRowBuilder, ButtonBuilder, EmbedBuilder, InteractionType, Message, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const utils = require("../utils.js");
const moment = require('moment-timezone');
const guildModel = require("../models/guildModel");
const suggestionModel = require("../models/suggestionModel");
const ticketModel = require("../models/ticketModel");
const ticketPanelModel = require("../models/ticketPanelModel");
const reviewsModel = require("../models/reviewsModel");
const blacklistModel = require('../models/blacklistedUsersModel');
const dashboardModel = require("../models/dashboardModel");
const color = require('ansi-colors');
const { eventHandler } = require('../utils.js');
const { SnowflakeUtil } = require("discord.js")

const Cooldown = new Map();

const validButtonConfigs = {};
for (let i = 1; i <= 8; i++) {
  const key = `TicketButton${i}`;
  if (config[key]?.Questions?.length > 0) {
    // Build modal sớm
    const components = config[key].Questions.map(question => {
      const input = new TextInputBuilder()
      input.setCustomId(question.customId)
      input.setLabel(question.question)
      input.setStyle(TextInputStyle[question.style.charAt(0).toUpperCase() + question.style.slice(1).toLowerCase()])
      input.setRequired(question.required)
      if (question.minLength) input.setMinLength(question.minLength)
      input.setMaxLength(2000);

      if (question.placeholder) input.setPlaceholder(question.placeholder);

      return new ActionRowBuilder().addComponents(input);
    });

    const modal = new ModalBuilder()
      .setCustomId(`questionModal-${i}-template`)
      .setTitle(config[key].TicketName)
      .addComponents(...components);

    validButtonConfigs[key] = {
      modal: modal,
      name: config[key].TicketName
    };
  }
}

module.exports = async (client, interaction) => {

  if (interaction.isChatInputCommand()) {
    const command = client.slashCommands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction, client);

      let logMsg = `\n\n[${new Date().toLocaleString()}] [SLASH COMMAND] Lệnh: ${interaction.commandName}, Người dùng: ${interaction.user.username}`;
      fs.appendFile("./logs.txt", logMsg, (e) => {
        if (e) console.log(e);
      });

      if (config.LogCommands) console.log(`${color.yellow(`[SLASH COMMAND] ${color.cyan(`${interaction.user.username}`)} sử dụng ${color.cyan(`/${interaction.commandName}`)}`)}`);
      return
    } catch (error) {
      if (error) return console.error(error);
    }

  }

  let logMsg2 = `\n\n[${new Date().toLocaleString()}] [INTERACTION] ${interaction.customId}`;
  fs.appendFile("./logs.txt", logMsg2, (e) => {
    if (e) console.log(e);
  });

  let sMenu;
  if (interaction.values && config.TicketSettings.SelectMenu) {
    sMenu = interaction.values[0];
  } else {
    sMenu = interaction.customId;
  }

  if (!config.TicketSettings.SelectMenu &&
    (interaction.customId.startsWith('questionModal-') || interaction.customId.startsWith('button'))) {
    const buttonConfig = config[`TicketButton${sMenu.slice(-1)}`];
    if (!buttonConfig || !buttonConfig.Questions || buttonConfig.Questions.length === 0) {
      await interaction.deferReply({ ephemeral: true });
    }
  }

  // Đặt lại lựa chọn menu Chọn
  async function handleSelectMenuUpdate(interaction, menuCategory) {
    try {
      const buttonConfig = config[`TicketButton${menuCategory.slice(-1)}`];

      if (!buttonConfig || !buttonConfig.Questions || buttonConfig.Questions.length === 0) {
        console.log('\x1b[33m%s\x1b[0m', '[SELECT MENU UPDATE] Không có câu hỏi được cấu hình, bỏ qua');
        return;
      }

      const tPanel = await ticketPanelModel.findOne({ msgID: interaction.message.id });

      if (!tPanel) {
        console.log('\x1b[31m%s\x1b[0m', `[WARNING] Không tìm thấy bảng điều khiển cho ID tin nhắn: ${interaction.message.id}`);
        return;
      }

      let msg;
      try {
        msg = await interaction.channel.messages.fetch(tPanel.msgID);
      } catch (fetchError) {
        console.error('\x1b[31m%s\x1b[0m', `[ERROR] Không thể tải tin nhắn bảng điều khiển: ${fetchError.message}`);
        return;
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("categorySelect")
        .setPlaceholder(config.Locale.selectCategory)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(tPanel.selectMenuOptions);

      const sRow = new ActionRowBuilder().addComponents(selectMenu);

      try {
        await msg.edit({ components: [sRow] });

      } catch (editError) {
        console.error('\x1b[31m%s\x1b[0m', `[ERROR] Không thể chỉnh sửa tin nhắn bảng điều khiển: ${editError.message}`);
      }

    } catch (error) {
      console.error('\x1b[31m%s\x1b[0m', `[SELECT MENU UPDATE] Lỗi không xác định: ${error.message}`);
    }
  }
  //


  async function processTicketCreation(interaction, buttonConfig, customIdentifier, buttonNumber, responses) {

    const statsDB = await guildModel.findOne({ guildID: config.GuildID });

    if (config.WorkingHours && config.WorkingHours.Enabled && !config.WorkingHours.AllowTicketsOutsideWorkingHours) {
      const workingHoursRegex = /^(\d{1,2}:\d{2})-(\d{1,2}:\d{2})$/;

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

      const withinWorkingHours = currentTime.isBetween(startTime, endTime);

      // Tạo chỗ giữ chỗ giờ làm việc cho tất cả các ngày
      const workingHoursPlaceholders = {};
      for (const day in config.WorkingHours.Schedule) {
        const hours = config.WorkingHours.Schedule[day];
        const match = hours.match(workingHoursRegex);
        if (match) {
          const start = moment.tz(startDate + ' ' + match[1], 'YYYY-MM-DD H:mm', config.WorkingHours.Timezone);
          const end = moment.tz(startDate + ' ' + match[2], 'YYYY-MM-DD H:mm', config.WorkingHours.Timezone);
          workingHoursPlaceholders[`{startTime-${day}}`] = `<t:${start.unix()}:t>`;
          workingHoursPlaceholders[`{endTime-${day}}`] = `<t:${end.unix()}:t>`;
        } else {
          console.log('\x1b[31m%s\x1b[0m', `[ERROR] Cấu hình giờ làm việc không hợp lệ cho ${day} (định dạng). Liên hệ với bộ phận hỗ trợ và cung cấp tệp config.yml của bạn.`);
        }
      }

      // Thay thế trình giữ chỗ trong chuỗi địa phương
      let workingHoursEmbedLocale = config.WorkingHours.outsideWorkingHours;
      for (const [placeholder, value] of Object.entries(workingHoursPlaceholders)) {
        workingHoursEmbedLocale = workingHoursEmbedLocale.replace(new RegExp(placeholder, 'g'), value);
      }

      // Thay thế người giữ chỗ trong ngày hiện tại
      workingHoursEmbedLocale = workingHoursEmbedLocale
        .replace(/{startTime-currentDay}/g, workingHoursPlaceholders[`{startTime-${currentDay}}`])
        .replace(/{endTime-currentDay}/g, workingHoursPlaceholders[`{endTime-${currentDay}}`]);

      if (!withinWorkingHours) {
        let workingHoursEmbed = new EmbedBuilder()
          .setTitle(config.WorkingHours.outsideWorkingHoursTitle)
          .setColor("Red")
          .setDescription(workingHoursEmbedLocale)
          .setFooter({
            text: `${interaction.user.username}`,
            iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}`
          })
          .setTimestamp();

        return interaction.editReply({ embeds: [workingHoursEmbed], ephemeral: true });
      }
    }

    const cooldown = Cooldown.get(interaction.user.id);
    const remainingTimeSeconds = Math.ceil((cooldown + (config.TicketSettings.TicketCooldown * 1000 - Date.now())) / 1000);
    const unixTimestamp = Math.floor(Date.now() / 1000) + remainingTimeSeconds;

    let cooldownEmbedLocale = config.Locale.cooldownEmbedMsg.replace(/{time}/g, `<t:${unixTimestamp}:R>`);
    let cooldownEmbed = new EmbedBuilder()
      .setTitle(config.Locale.cooldownEmbedMsgTitle)
      .setColor("Red")
      .setDescription(cooldownEmbedLocale)
      .setFooter({
        text: `${interaction.user.username}`,
        iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}`
      })
      .setTimestamp();
    if (Cooldown.has(interaction.user.id)) return interaction.editReply({ embeds: [cooldownEmbed], ephemeral: true })

    let logMsg = `\n\n[${new Date().toLocaleString()}] [TICKET CREATION] Nút: ${buttonNumber}, Người dùng: ${interaction.user.username}`;
    fs.appendFile("./logs.txt", logMsg, (e) => {
      if (e) console.log(e);
    });

    // Kiểm tra các vai trò cần thiết
    if (buttonConfig.RequiredRoles && buttonConfig.RequiredRoles?.length > 0) {
      let reqRole = false
      let ticketRoleNotAllowed = new EmbedBuilder()
        .setTitle(config.Locale.requiredRoleTitle)
        .setColor("Red")
        .setDescription(config.Locale.requiredRoleMissing)
        .setFooter({
          text: `${interaction.user.username}`,
          iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}`
        })
        .setTimestamp();

      for (let i = 0; i < buttonConfig.RequiredRoles.length; i++) {
        if (!interaction.guild.roles.cache.get(buttonConfig.RequiredRoles[i])) {
          reqRole = true
          break;
        }
        if (interaction.member.roles.cache.has(buttonConfig.RequiredRoles[i])) {
          reqRole = true;
          break;
        }
      }
      if (reqRole === false) return interaction.editReply({ embeds: [ticketRoleNotAllowed], ephemeral: true })
    }

    // Kiểm tra các vai trò trong danh sách đen
    let userBlacklisted = new EmbedBuilder()
      .setTitle(config.Locale.userBlacklistedTitle)
      .setColor("Red")
      .setDescription(config.Locale.userBlacklistedMsg)
      .setFooter({
        text: `${interaction.user.username}`,
        iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}`
      })
      .setTimestamp();


    // Kiểm tra xem người dùng có bị danh sách đen không phải là tạo vé không
    const blacklistedUser = await blacklistModel.findOne({ userId: interaction.user.id });
    if (blacklistedUser && blacklistedUser.blacklisted) {
      if (!buttonConfig.Questions || (buttonConfig.Questions && buttonConfig.Questions.length < 0)) {
        return interaction.editReply({ embeds: [userBlacklisted], ephemeral: true });
      }

      if (buttonConfig.Questions && buttonConfig.Questions.length > 0) {
        return interaction.editReply({ embeds: [userBlacklisted], ephemeral: true });
      }
    }

    let blRole = false
    let ticketRoleBlacklisted = new EmbedBuilder()
      .setTitle(config.Locale.RoleBlacklistedTitle)
      .setColor("Red")
      .setDescription(config.Locale.RoleBlacklistedMsg)
      .setFooter({
        text: `${interaction.user.username}`,
        iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}`
      })
      .setTimestamp();

    for (let i = 0; i < config.TicketSettings.BlacklistedRoles.length; i++) {
      if (interaction.member.roles.cache.has(config.TicketSettings.BlacklistedRoles[i])) blRole = true;
    }
    if (blRole === true) return interaction.editReply({ embeds: [ticketRoleBlacklisted], ephemeral: true })

    if (!interaction.guild.channels.cache.get(buttonConfig.TicketCategoryID)) return console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${buttonNumber}.TicketCategoryID không phải là danh mục hợp lệ!`)

    let max = config.TicketSettings.MaxTickets
    let tNow = 0

    let maxTickets = config.Locale.AlreadyOpenMsg.replace(/{max}/g, `${max}`);
    let ticketAlreadyOpened = new EmbedBuilder()
      .setTitle(config.Locale.AlreadyOpenTitle)
      .setColor("Red")
      .setDescription(maxTickets)
      .setFooter({
        text: `${interaction.user.username}`,
        iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}`
      })
      .setTimestamp();

    const ticketDB = await ticketModel.findOne({ userID: interaction.user.id, status: 'Open' });

    if (ticketDB) {
      const channels = Array.from(interaction.guild.channels.cache);
      for (const c of channels) {
        const ticketInChannel = await ticketModel.findOne({ channelID: c[1].id });
        if (ticketInChannel) {
          let ticketData = ticketInChannel.userID;
          if (ticketData && ticketData === interaction.user.id && ticketInChannel.status !== "Closed") {
            tNow = tNow + 1;
          }
        }
      }
    }

    if (tNow >= max) {
      if (interaction.deferred) return interaction.editReply({ embeds: [ticketAlreadyOpened], ephemeral: true }).then(() => { tNow = 0; });
      if (!interaction.deferred) return interaction.reply({ embeds: [ticketAlreadyOpened], ephemeral: true }).then(() => { tNow = 0; });
    }

    let permissionOverwriteArray = [{
      id: interaction.member.id,
      allow: ['SendMessages', 'ViewChannel', 'AttachFiles', 'EmbedLinks', 'ReadMessageHistory']
    },
    {
      id: interaction.guild.id,
      deny: ['SendMessages', 'ViewChannel']
    },
    {
      id: client.user.id,
      allow: ['SendMessages', 'ViewChannel']
    },
    ]

    await buttonConfig.SupportRoles.forEach(roleid => {
      role = interaction.guild.roles.cache.get(roleid);
      if (!role) return console.log('\x1b[31m%s\x1b[0m', `[WARNING] ${buttonNumber}.SupportRoles không phải là vai trò hợp lệ!`)
      let tempArray = {
        id: role.id,
        allow: ['SendMessages', 'ViewChannel', 'AttachFiles', 'EmbedLinks', 'ReadMessageHistory']
      }
      permissionOverwriteArray.push(tempArray);
    })

    // Kiểm tra xem người dùng có vai trò ưu tiên không
    const priorityRole = config.PriorityRoles.Roles.find(role => interaction.member.roles.cache.has(role.RoleID));

    let channel;
    let priorityActive = false
    let priorityLevel;

    let tChannelName = buttonConfig.ChannelName.replace(/{username}/g, `${interaction.user.username}`).replace(/{total-tickets}/g, `${statsDB.totalTickets}`).replace(/{user-id}/g, `${interaction.user.id}`)

    const maxChannelsPerCategory = 50;

    // Lấy danh mục hiện tại
    const parentCategory = interaction.guild.channels.cache.get(buttonConfig.TicketCategoryID);
    const categoryChannels = interaction.guild.channels.cache.filter(channel => channel.parentId === parentCategory.id);
    const channelCount = categoryChannels.size;

    if (channelCount >= maxChannelsPerCategory) {
      // Tạo một danh mục mới tự động
      const newCategory = await interaction.guild.channels.create({
        name: `${parentCategory.name} Overflow`,
        type: 4,
        position: parentCategory.rawPosition + 1,
        permissionOverwrites: parentCategory.permissionOverwrites.cache.map(perm => perm),
      });

      buttonConfig.TicketCategoryID = newCategory.id;
    }

    if (config.PrioritySettings.Enabled && config.PriorityRoles.Enabled && priorityRole) {

      priorityLevel = priorityRole.PriorityLevel.toLowerCase();

      const matchingPriorityLevel = config.PrioritySettings.Levels.find(level => level.priority.toLowerCase() === priorityLevel);

      if (matchingPriorityLevel) {
        const { channelName } = matchingPriorityLevel;

        const newChannelName = channelName ? `${channelName}${tChannelName}` : `${tChannelName}`;

        channel = await interaction.guild.channels.create({
          name: newChannelName,
          type: 0,
          parent: buttonConfig.TicketCategoryID,
          topic: config.TicketSettings.ChannelTopic.replace(/{username}/g, `<@!${interaction.user.id}>`).replace(/{category}/g, `${buttonConfig.TicketName}`),
          permissionOverwrites: permissionOverwriteArray,
          position: 1
        });

        priorityActive = true
      }
    }

    if (priorityActive === false) {
      channel = await interaction.guild.channels.create({
        name: tChannelName,
        type: 0,
        parent: buttonConfig.TicketCategoryID,
        topic: config.TicketSettings.ChannelTopic.replace(/{username}/g, `<@!${interaction.user.id}>`).replace(/{category}/g, `${buttonConfig.TicketName}`),
        permissionOverwrites: permissionOverwriteArray
      });
    }

    const ticketDeleteButton = new ButtonBuilder()
      .setCustomId('closeTicket')
      .setLabel(config.Locale.CloseTicketButton)
      .setStyle(config.ButtonColors.closeTicket)
      .setEmoji(config.ButtonEmojis.closeTicket)

    const ticketClaimButton = new ButtonBuilder()
      .setCustomId('ticketclaim')
      .setLabel(config.Locale.claimTicketButton)
      .setEmoji(config.ButtonEmojis.ticketClaim)
      .setStyle(config.ButtonColors.ticketClaim)

    let row1 = ""
    if (config.ClaimingSystem.Enabled) row1 = new ActionRowBuilder().addComponents(ticketDeleteButton, ticketClaimButton);
    if (config.ClaimingSystem.Enabled === false) row1 = new ActionRowBuilder().addComponents(ticketDeleteButton);

    let NewTicketMsg = buttonConfig.TicketMessage.replace(/{user}/g, `<@!${interaction.user.id}>`).replace(/{createdAt}/g, `<t:${(Date.now() / 1000 | 0)}:R>`);
    let NewTicketMsgTitle = buttonConfig.TicketMessageTitle.replace(/{category}/g, `${buttonConfig.TicketName}`);
    var userIcon = interaction.user.displayAvatarURL({
      format: 'png',
      dynamic: true,
      size: 1024
    });
    const deleteEmbed = new EmbedBuilder()
    if (config.TicketOpenEmbed.UserIconAuthor) deleteEmbed.setAuthor({
      name: `${NewTicketMsgTitle}`,
      iconURL: `${userIcon}`
    })
    if (config.TicketOpenEmbed.UserIconAuthor === false) deleteEmbed.setAuthor({
      name: `${NewTicketMsgTitle}`
    })
    if (!config.TicketOpenEmbed.EmbedColor) deleteEmbed.setColor(config.EmbedColors)
    if (config.TicketOpenEmbed.EmbedColor) deleteEmbed.setColor(config.TicketOpenEmbed.EmbedColor)
    if (config.TicketOpenEmbed.UserIconThumbnail) deleteEmbed.setThumbnail(userIcon)
    deleteEmbed.setDescription(`${NewTicketMsg}`)
    if (config.ClaimingSystem.Enabled) deleteEmbed.addFields([{
      name: `${config.Locale.ticketClaimedBy}`,
      value: `> ${config.Locale.ticketNotClaimed}`
    },])
    if (config.TicketOpenEmbed.FooterMsg) deleteEmbed.setFooter({
      text: `${config.TicketOpenEmbed.FooterMsg}`
    })
    if (config.TicketOpenEmbed.FooterMsg && config.TicketOpenEmbed.FooterIcon) deleteEmbed.setFooter({
      text: `${config.TicketOpenEmbed.FooterMsg}`,
      iconURL: `${config.TicketOpenEmbed.FooterIcon}`
    })
    if (config.TicketOpenEmbed.Timestamp) deleteEmbed.setTimestamp()

    channel.send({
      embeds: [deleteEmbed],
      components: [row1],
      fetchReply: true
    }).then(async (m2) => {
      let ticketOpened = new EmbedBuilder()
        .setTitle(config.Locale.ticketCreatedTitle)
        .setColor("Green")
        .setDescription(`${config.Locale.ticketCreatedMsg} <#${channel.id}>`)
        .setFooter({
          text: `${interaction.user.username}`,
          iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}`
        })
        .setTimestamp();

      const row2 = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setStyle('Link')
            .setURL(`${m2.url}`)
            .setLabel(config.Locale.logsTicket)
            .setEmoji(config.ButtonEmojis.ticketCreated))

      if (interaction.deferred) interaction.editReply({ embeds: [ticketOpened], components: [row2], ephemeral: true })
      if (!interaction.deferred) interaction.reply({ embeds: [ticketOpened], components: [row2], ephemeral: true })



      if (config.TicketSettings.MentionAuthor) channel.send({
        content: `<@!${interaction.user.id}>`
      }).then(msg => setTimeout(() => msg.delete().catch(e => { }), 500));

      if (buttonConfig.MentionSupportRoles) {
        let supp = buttonConfig.SupportRoles.map((r) => {
          let findSupport = interaction.guild.roles.cache.get(r)

          if (findSupport) return findSupport;
        });

        channel.send(supp.join(" ")).then((msg) => setTimeout(() => msg.delete().catch(e => { }), 500));
      }

      // Kiểm tra xem câu hỏi có được bật trong cấu hình không
      if (buttonConfig.Questions && buttonConfig.Questions.length > 0) {
        const newModel = new ticketModel({
          guildID: interaction.guild.id,
          channelID: channel.id,
          userID: interaction.user.id,
          ticketType: buttonConfig.TicketName,
          button: buttonNumber,
          msgID: m2.id,
          claimed: false,
          claimUser: "",
          messages: 0,
          lastMessageSent: Date.now(),
          status: "Open",
          closeUserID: "",
          waitingReplyFrom: "staff",
          questions: buttonConfig.Questions.map(question => ({
            ...question,
            response: responses[question.customId] || '', // Đặt phản hồi từ đối tượng hoặc chuỗi trống nếu không tìm thấy
          })),
          ticketCreationDate: Date.now(),
          identifier: customIdentifier,
        });
        await newModel.save();
      } else {
        // Câu hỏi không được bật, hãy tạo một mô hình không có câu hỏi
        const newModel = new ticketModel({
          guildID: interaction.guild.id,
          channelID: channel.id,
          userID: interaction.user.id,
          ticketType: buttonConfig.TicketName,
          button: buttonNumber,
          msgID: m2.id,
          claimed: false,
          claimUser: "",
          messages: 0,
          lastMessageSent: Date.now(),
          status: "Open",
          closeUserID: "",
          waitingReplyFrom: "staff",
          ticketCreationDate: Date.now(),
          identifier: customIdentifier,
        });
        await newModel.save();
      }

      if (priorityActive && priorityLevel) {
        await ticketModel.findOneAndUpdate(
          { channelID: channel.id },
          {
            priority: priorityLevel,
            priorityName: tChannelName,
          }
        );
      }

      // Đặt thời gian hồi phục khi người dùng tạo ticket
      let ticketCooldown = config.TicketSettings.TicketCooldown * 1000
      if (config.TicketSettings.TicketCooldown > 0) Cooldown.set(interaction.user.id, Date.now())
      if (config.TicketSettings.TicketCooldown > 0) setTimeout(() => Cooldown.delete(interaction.user.id), ticketCooldown)
      //

      client.emit('ticketCreate', interaction, channel, buttonNumber);

    })
  }

  async function handleTicketButton(interaction, buttonConfig, buttonNumber) {
    try {
      const interactionCreationTime = interaction.createdTimestamp;

      const configKey = `TicketButton${buttonNumber}`;
      const cachedConfig = validButtonConfigs[configKey];
      const sMenu = `button${buttonNumber}`;

      if (!buttonConfig) {
        console.error(`Cấu hình nút không hợp lệ cho ${configKey}`);
        return interaction.reply({
          content: 'Đã xảy ra lỗi khi cấu hình ticket.',
          ephemeral: true
        });
      }

      if (!cachedConfig?.modal) {
        try {
          const customIdentifier = generateUniqueIdentifier();

          if (config.TicketSettings.SelectMenu) {
            handleSelectMenuUpdate(interaction, sMenu).catch(console.error);
          }

          await processTicketCreation(interaction, buttonConfig, customIdentifier, buttonNumber);
          return;
        } catch (processError) {
          console.error('\x1b[31m%s\x1b[0m', 'Lỗi trong quá trình tạo ticket:', processError);

          console.log(`- Thời gian lỗi: ${new Date().toISOString()}`);
          console.log(`- Độ trễ do lỗi: ${Date.now() - interactionCreationTime} ms`);

          return interaction.reply({
            content: 'Không tạo được ticket. Vui lòng thử lại.',
            ephemeral: true
          });
        }
      }

      const modal = new ModalBuilder()
        .setCustomId(`questionModal-${buttonNumber}-${Date.now()}`)
        .setTitle(cachedConfig.name);

      try {
        cachedConfig.modal.components.forEach(row => {
          modal.addComponents(ActionRowBuilder.from(row));
        });
      } catch (modalError) {
        console.error('\x1b[31m%s\x1b[0m', 'Lỗi thành phần mô hình:', modalError);

        return interaction.reply({
          content: 'Không chuẩn bị được ticket. Vui lòng liên hệ bộ phận hỗ trợ.',
          ephemeral: true
        });
      }

      try {
        await interaction.showModal(modal);

        if (config.TicketSettings.SelectMenu) {
          handleSelectMenuUpdate(interaction, sMenu).catch(console.error);
        }

      } catch (modalShowError) {
        console.error('\x1b[31m%s\x1b[0m', 'Không hiển thị được hộp thoại:', modalShowError);

        return interaction.reply({
          content: 'Không thể mở ticket. Vui lòng thử lại.',
          ephemeral: true
        });
      }

    } catch (error) {
      console.error('\x1b[31m%s\x1b[0m', 'Lỗi xử lý nút ticket toàn diện:', error);

      console.log(`- Thời gian lỗi: ${new Date().toISOString()}`);
      console.log(`- Độ trễ do lỗi: ${Date.now() - interactionCreationTime} ms`);
      console.log(`- Tên lỗi: ${error.name}`);
      console.log(`- Tin nhắn lỗi: ${error.message}`);

      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: 'Đã xảy ra lỗi không mong muốn. Vui lòng thử lại hoặc liên hệ với bộ phận hỗ trợ.',
            ephemeral: true
          });
        } else if (interaction.deferred) {
          await interaction.editReply({
            content: 'Đã xảy ra lỗi không mong muốn. Vui lòng thử lại hoặc liên hệ với bộ phận hỗ trợ.',
            ephemeral: true
          });
        }
      } catch (fallbackError) {
        console.error('Không gửi được tin nhắn lỗi:', fallbackError);
      }
    }
  }

  function generateUniqueIdentifier() {
    const characters = 'ABCDEFGHIJKLMNPQRSTUVWXYZ123456789';
    let identifier = '';
    for (let i = 0; i < 6; i++) {
      identifier += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return identifier;
  }

  async function handleModalSubmission(interaction, buttonConfig, buttonNumber) {
    try {

      await interaction.deferReply({ ephemeral: true }).catch(deferError => {
        console.error('Không thể hoãn trả lời theo kiểu modal:', deferError);
      });

      if (!buttonConfig || !buttonConfig.Questions) {
        console.error('Cấu hình nút không hợp lệ hoặc thiếu câu hỏi');
        return interaction.editReply({
          content: 'Lỗi cấu hình ticket. Vui lòng liên hệ bộ phận hỗ trợ.',
          ephemeral: true
        });
      }

      const responses = {};
      try {
        buttonConfig.Questions.forEach(question => {
          const response = interaction.fields.getTextInputValue(question.customId);

          if (question.required && (!response || response.trim() === '')) {
            throw new Error(`Câu hỏi bắt buộc "${question.question}" đang trống`);
          }

          responses[question.customId] = response;
        });
      } catch (responseError) {
        console.error('Lỗi xử lý phản hồi của hộp thoại:', responseError);
        return interaction.editReply({
          content: `Lỗi xác thực: ${responseError.message}`,
          ephemeral: true
        });
      }

      // Kiểm tra xác thực song song
      const [blacklistResult, workingHoursResult] = await Promise.all([
        blacklistModel.findOne({ userId: interaction.user.id }),
        validateWorkingHours(interaction)
      ]).catch(validationError => {
        console.error('Lỗi kiểm tra xác thực:', validationError);
        return [null, null];
      });

      // Kiểm tra danh sách đen
      if (blacklistResult?.blacklisted) {
        return interaction.editReply({
          embeds: [userBlacklisted],
          ephemeral: true
        });
      }

      //Kiểm tra giờ làm việc
      if (workingHoursResult?.outsideHours) {
        return interaction.editReply({
          embeds: [workingHoursResult.embed],
          ephemeral: true
        });
      }

      try {
        const customIdentifier = generateUniqueIdentifier();
        await processTicketCreation(interaction, buttonConfig, customIdentifier, buttonNumber, responses);
      } catch (creationError) {
        console.error('Lỗi tạo ticket:', creationError);
        return interaction.editReply({
          content: 'Không tạo được ticket. Vui lòng thử lại hoặc liên hệ bộ phận hỗ trợ.',
          ephemeral: true
        });
      }

    } catch (error) {
      console.error('Lỗi gửi mẫu toàn diện:', error);

      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: 'Đã xảy ra lỗi không mong muốn trong quá trình gửi phiếu yêu cầu.',
            ephemeral: true
          });
        } else if (interaction.deferred) {
          await interaction.editReply({
            content: 'Đã xảy ra lỗi không mong muốn trong quá trình gửi phiếu yêu cầu.',
            ephemeral: true
          });
        }
      } catch (fallbackError) {
        console.error('Lỗi khi gửi tin nhắn lỗi', fallbackError);
      }
    }
  }

  async function validateWorkingHours(interaction) {
    if (!config.WorkingHours?.Enabled || config.WorkingHours.AllowTicketsOutsideWorkingHours) {
      return { outsideHours: false };
    }

    const currentTime = moment().tz(config.WorkingHours.Timezone);
    const currentDay = currentTime.format('dddd');
    const workingHours = config.WorkingHours.Schedule[currentDay];

    if (!workingHours) return { outsideHours: true };

    const [startTime, endTime] = workingHours.split('-');
    const isWithinHours = currentTime.isBetween(
      moment.tz(`${currentTime.format('YYYY-MM-DD')} ${startTime}`, config.WorkingHours.Timezone),
      moment.tz(`${currentTime.format('YYYY-MM-DD')} ${endTime}`, config.WorkingHours.Timezone)
    );

    if (!isWithinHours) {
      return {
        outsideHours: true,
        embed: new EmbedBuilder()
          .setTitle(config.WorkingHours.outsideWorkingHoursTitle)
          .setColor("Red")
          .setDescription(config.WorkingHours.outsideWorkingHours)
          .setFooter({
            text: interaction.user.username,
            iconURL: interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })
          })
          .setTimestamp()
      };
    }

    return { outsideHours: false };
  }


  // Gửi câu trả lời câu hỏi cho vé
  if (interaction.type === InteractionType.ModalSubmit && interaction.customId.startsWith('questionModal')) {
    const [, buttonConfigKey, timestamp] = interaction.customId.split('-');
    const buttonConfig = config[`TicketButton${buttonConfigKey}`];

    if (!buttonConfig) {
      console.error(`Không tìm thấy cấu hình nút cho khóa: TicketButton${buttonConfigKey}`);
      return;
    }

    await handleModalSubmission(interaction, buttonConfig, buttonConfigKey);
  }

  const handleTicketCategory = async (categoryName, buttonConfig, interaction) => {
    if (!buttonConfig || (!buttonConfig.Questions || buttonConfig.Questions.length === 0)) {
      const customIdentifier = generateUniqueIdentifier();
      const sMenu = `button${categoryName.match(/\d+/)[0]}`;

      if (config.TicketSettings.SelectMenu) {
        handleSelectMenuUpdate(interaction, sMenu).catch(console.error);
      }

      await processTicketCreation(interaction, buttonConfig, customIdentifier, categoryName, {});
      return;
    }

    const buttonNumber = categoryName.match(/\d+/)[0];

    await handleTicketButton(interaction, buttonConfig, buttonNumber);
  };

  const buttonHandlers = {
    button1: () => handleTicketCategory("TicketButton1", config.TicketButton1, interaction),
    button2: () => handleTicketCategory("TicketButton2", config.TicketButton2, interaction),
    button3: () => handleTicketCategory("TicketButton3", config.TicketButton3, interaction),
    button4: () => handleTicketCategory("TicketButton4", config.TicketButton4, interaction),
    button5: () => handleTicketCategory("TicketButton5", config.TicketButton5, interaction),
    button6: () => handleTicketCategory("TicketButton6", config.TicketButton6, interaction),
    button7: () => handleTicketCategory("TicketButton7", config.TicketButton7, interaction),
    button8: () => handleTicketCategory("TicketButton8", config.TicketButton8, interaction)
  };

  if (buttonHandlers[sMenu]) {
    await buttonHandlers[sMenu]();
  }


  //Nút đóng ticket
  if (interaction.customId === 'closeTicket') {


    if (!config.TicketSettings.TicketCloseReason) await interaction.deferReply().catch()

    let supportRole = await utils.checkIfUserHasSupportRoles(interaction)
    if (config.TicketSettings.RestrictTicketClose && !supportRole) {
      if (!config.TicketSettings.TicketCloseReason) return interaction.editReply({ content: config.Locale.restrictTicketClose, ephemeral: true });
      if (config.TicketSettings.TicketCloseReason) return interaction.reply({ content: config.Locale.restrictTicketClose, ephemeral: true });
    }


    // đặt closerUserID trong cơ sở dữ liệu ticket
    await ticketModel.updateOne({ channelID: interaction.channel.id }, { $set: { closeUserID: interaction.user.id, closedAt: Date.now() } });

    if (config.TicketSettings.TicketCloseReason) {
      const modal = new ModalBuilder()
        .setCustomId('closeReason')
        .setTitle(config.Locale.ticketCloseReasonTitle);

      const reasonForClose = new TextInputBuilder()
        .setCustomId('reasonForClose')
        .setLabel(config.Locale.whyCloseTicket)
        .setStyle("Short");

      const row1 = new ActionRowBuilder().addComponents(reasonForClose);

      modal.addComponents(row1);
      return await interaction.showModal(modal);
    }


    await client.emit('ticketClose', interaction);
  }

  if (config.TicketSettings.TicketCloseReason && interaction.isModalSubmit() && interaction.customId === "closeReason") {

    const reasonForClose = interaction.fields.getTextInputValue('reasonForClose');

    await ticketModel.updateOne({ channelID: interaction.channel.id }, { $set: { closeReason: reasonForClose } });

    await client.emit('ticketClose', interaction);
  }

  if (interaction.customId === 'ticketclaim') {
    await interaction.deferReply({ ephemeral: true });

    let ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });

    let logMsg = `\n\n[${new Date().toLocaleString()}] [TICKET CLAIM] Người dùng: ${interaction.user.username}`;
    fs.appendFile("./logs.txt", logMsg, (e) => {
      if (e) console.log(e);
    });


    if (config.ClaimingSystem.Enabled === false) return interaction.editReply({ content: "Tính năng nhận ticket đã bị tắt trong config", ephemeral: true })

    let supportRole = await utils.checkIfUserHasSupportRoles(interaction)
    console.log(supportRole)
    if (config.ClaimingSystem.Enabled && !supportRole) {
      return interaction.editReply({ content: config.Locale.restrictTicketClaim, ephemeral: true });
    }


    let embedClaimVar = config.Locale.ticketClaimed.replace(/{user}/g, `<@!${interaction.user.id}>`);
    const embed = new EmbedBuilder()
      .setTitle(config.Locale.ticketClaimedTitle)
      .setColor("Green")
      .setDescription(embedClaimVar)
      .setTimestamp()
      .setFooter({ text: `${config.Locale.ticketClaimedBy} ${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ dynamic: true })}` })
    interaction.editReply({ content: config.Locale.claimTicketMsg, ephemeral: false })
    interaction.channel.send({ embeds: [embed], ephemeral: false })
    interaction.channel.messages.fetch(ticketDB.msgID).then(async msg => {

      const embed = msg.embeds[0]
      embed.fields[0] = { name: `${config.Locale.ticketClaimedBy}`, value: `> <@!${interaction.user.id}> (${interaction.user.username})` }

      const ticketDeleteButton = new ButtonBuilder()
        .setCustomId('closeTicket')
        .setLabel(config.Locale.CloseTicketButton)
        .setStyle('Danger')
        .setEmoji(config.ButtonEmojis.closeTicket)

      const ticketClaimButton = new ButtonBuilder()
        .setCustomId('ticketclaim')
        .setLabel(config.Locale.claimTicketButton)
        .setEmoji(config.ButtonEmojis.ticketClaim)
        .setStyle('Secondary')
        .setDisabled(true)

      const ticketUnClaimButton = new ButtonBuilder()
        .setCustomId('ticketunclaim')
        .setLabel(config.Locale.unclaimTicketButton)
        .setStyle(config.ButtonColors.ticketUnclaim)

      let row2 = new ActionRowBuilder().addComponents(ticketDeleteButton, ticketClaimButton, ticketUnClaimButton);

      msg.edit({ embeds: [embed], components: [row2] })
      client.emit('ticketClaim', interaction);

      const editPermissionOverwrites = async (interaction, supportRoles) => {
        await Promise.all(supportRoles.map(async (sRoles) => {
          const role = interaction.guild.roles.cache.get(sRoles);
          if (role) {
            await interaction.channel.permissionOverwrites.edit(role, {
              SendMessages: config.ClaimingSystem.UserPerms.SendMessages,
              ViewChannel: config.ClaimingSystem.UserPerms.ViewChannel
            });
          }
        }));
      };

      let tButton = ticketDB.button;
      switch (tButton) {
        case "TicketButton1":
          await editPermissionOverwrites(interaction, config.TicketButton1.SupportRoles);
          break;
        case "TicketButton2":
          await editPermissionOverwrites(interaction, config.TicketButton2.SupportRoles);
          break;
        case "TicketButton3":
          await editPermissionOverwrites(interaction, config.TicketButton3.SupportRoles);
          break;
        case "TicketButton4":
          await editPermissionOverwrites(interaction, config.TicketButton4.SupportRoles);
          break;
        case "TicketButton5":
          await editPermissionOverwrites(interaction, config.TicketButton5.SupportRoles);
          break;
        case "TicketButton6":
          await editPermissionOverwrites(interaction, config.TicketButton6.SupportRoles);
          break;
        case "TicketButton7":
          await editPermissionOverwrites(interaction, config.TicketButton7.SupportRoles);
          break;
        case "TicketButton8":
          await editPermissionOverwrites(interaction, config.TicketButton8.SupportRoles);
          break;
      }


      await interaction.channel.permissionOverwrites.edit(interaction.user, {
        SendMessages: true,
        ViewChannel: true,
        AttachFiles: true,
        EmbedLinks: true,
        ReadMessageHistory: true
      })

      await ticketModel.updateOne(
        { channelID: interaction.channel.id },
        {
          $set: {
            claimed: true,
            claimUser: interaction.user.id,
          },
        }
      );

      let logsChannel;
      if (!config.claimTicket.ChannelID) logsChannel = interaction.guild.channels.cache.get(config.TicketSettings.LogsChannelID);
      if (config.claimTicket.ChannelID) logsChannel = interaction.guild.channels.cache.get(config.claimTicket.ChannelID);

      const log = new EmbedBuilder()
        .setColor("Green")
        .setTitle(config.Locale.ticketClaimedLog)
        .addFields([
          { name: `• ${config.Locale.logsExecutor}`, value: `> <@!${interaction.user.id}>\n> ${interaction.user.username}` },
          { name: `• ${config.Locale.logsTicket}`, value: `> <#${interaction.channel.id}>\n> #${interaction.channel.name}\n> ${ticketDB.ticketType}` },
        ])
        .setTimestamp()
        .setThumbnail(interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 }))
        .setFooter({ text: `${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}` })
      if (logsChannel && config.claimTicket.Enabled) logsChannel.send({ embeds: [log] })

    })
  }

  if (interaction.customId === 'ticketunclaim') {
    await interaction.deferReply({ ephemeral: true });

    let ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });

    let logMsg = `\n\n[${new Date().toLocaleString()}] [TICKET UNCLAIM] Người dùng: ${interaction.user.username}`;
    fs.appendFile("./logs.txt", logMsg, (e) => {
      if (e) console.log(e);
    });

    if (config.ClaimingSystem.Enabled === false) return interaction.editReply({ content: "Tính năng nhận ticket đã bị tắt trong config", ephemeral: true })
    if (ticketDB.claimed === false) return interaction.editReply({ content: "Ticket này chưa được nhận", ephemeral: true })
    let msgClaimUserVar = config.Locale.ticketDidntClaim.replace(/{user}/g, `<@!${ticketDB.claimUser}>`);
    if (ticketDB.claimUser !== interaction.user.id) return interaction.editReply({ content: msgClaimUserVar, ephemeral: true })

    let supportRole = await utils.checkIfUserHasSupportRoles(interaction)
    if (config.ClaimingSystem.Enabled && !supportRole) {
      return interaction.editReply({ content: config.Locale.restrictTicketClaim, ephemeral: true });
    }

    let tButton = ticketDB.button;

    const applyPermissionOverwrites = async (interaction, supportRoles) => {
      await Promise.all(supportRoles.map(async (sRoles) => {
        const role = interaction.guild.roles.cache.get(sRoles);
        if (role) {
          await interaction.channel.permissionOverwrites.edit(role, {
            SendMessages: true,
            ViewChannel: true
          });
        }
      }));
    };

    switch (tButton) {
      case "TicketButton1":
        await applyPermissionOverwrites(interaction, config.TicketButton1.SupportRoles);
        break;
      case "TicketButton2":
        await applyPermissionOverwrites(interaction, config.TicketButton2.SupportRoles);
        break;
      case "TicketButton3":
        await applyPermissionOverwrites(interaction, config.TicketButton3.SupportRoles);
        break;
      case "TicketButton4":
        await applyPermissionOverwrites(interaction, config.TicketButton4.SupportRoles);
        break;
      case "TicketButton5":
        await applyPermissionOverwrites(interaction, config.TicketButton5.SupportRoles);
        break;
      case "TicketButton6":
        await applyPermissionOverwrites(interaction, config.TicketButton6.SupportRoles);
        break;
      case "TicketButton7":
        await applyPermissionOverwrites(interaction, config.TicketButton7.SupportRoles);
        break;
      case "TicketButton8":
        await applyPermissionOverwrites(interaction, config.TicketButton8.SupportRoles);
        break;
    }


    let embedClaimVar2 = config.Locale.ticketUnClaimed.replace(/{user}/g, `<@!${interaction.user.id}>`);
    const embed = new EmbedBuilder()
      .setTitle(config.Locale.ticketUnClaimedTitle)
      .setColor("Red")
      .setDescription(embedClaimVar2)
      .setTimestamp()
      .setFooter({ text: `${config.Locale.ticketUnClaimedBy} ${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ dynamic: true })}` })
    interaction.editReply({ content: config.Locale.unclaimTicketMsg, ephemeral: true })
    interaction.channel.send({ embeds: [embed] })

    interaction.channel.messages.fetch(ticketDB.msgID).then(async msg => {

      const embed = msg.embeds[0]
      embed.fields[0] = { name: `${config.Locale.ticketClaimedBy}`, value: `> ${config.Locale.ticketNotClaimed}` }


      const ticketDeleteButton = new ButtonBuilder()
        .setCustomId('closeTicket')
        .setLabel(config.Locale.CloseTicketButton)
        .setStyle(config.ButtonColors.closeTicket)
        .setEmoji(config.ButtonEmojis.closeTicket)

      const ticketClaimButton = new ButtonBuilder()
        .setCustomId('ticketclaim')
        .setLabel(config.Locale.claimTicketButton)
        .setEmoji(config.ButtonEmojis.ticketClaim)
        .setStyle(config.ButtonColors.ticketClaim)

      let row3 = new ActionRowBuilder().addComponents(ticketDeleteButton, ticketClaimButton);

      msg.edit({ embeds: [embed], components: [row3] })


      await ticketModel.updateOne(
        { channelID: interaction.channel.id },
        {
          $set: {
            claimed: false,
            claimUser: "",
          },
        }
      );

      let logsChannel;
      if (!config.unclaimTicket.ChannelID) logsChannel = interaction.guild.channels.cache.get(config.TicketSettings.LogsChannelID);
      if (config.unclaimTicket.ChannelID) logsChannel = interaction.guild.channels.cache.get(config.unclaimTicket.ChannelID);

      const log = new EmbedBuilder()
        .setColor("Red")
        .setTitle(config.Locale.ticketUnClaimedLog)
        .addFields([
          { name: `• ${config.Locale.logsExecutor}`, value: `> <@!${interaction.user.id}>\n> ${interaction.user.username}` },
          { name: `• ${config.Locale.logsTicket}`, value: `> <#${interaction.channel.id}>\n> #${interaction.channel.name}\n> ${ticketDB.ticketType}` },
        ])
        .setTimestamp()
        .setThumbnail(interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 }))
        .setFooter({ text: `${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}` })
      if (logsChannel && config.unclaimTicket.Enabled) logsChannel.send({ embeds: [log] })
    })
  }



  // HỆ THỐNG GỢI Ý

  // Nút bình chọn
  if (interaction.customId === 'upvote') {
    await interaction.deferReply({ ephemeral: true });

    const suggestion = await suggestionModel.findOne({ msgID: interaction.message.id });
    if (!suggestion) return interaction.editReply('Không tìm thấy gợi ý trong cơ sở dữ liệu.')

    const statsDB = await guildModel.findOne({ guildID: config.GuildID });

    let cantvoteVariable = config.Locale.suggestionCantVote.replace(/{link}/g, `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}`);
    let cantVote = new EmbedBuilder()
      .setTitle(config.Locale.suggestionCantVoteTitle)
      .setColor("Red")
      .setDescription(cantvoteVariable)
      .setFooter({ text: `${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}` })
      .setTimestamp();

    // Kiểm tra xem đề xuất đã được chấp nhận hay bị từ chối
    if (suggestion.status === 'Accepted' || suggestion.status === 'Denied') {
      return interaction.editReply({ embeds: [cantVote], ephemeral: true });
    }

    let alreadyvotedVariable = config.Locale.suggestionAlreadyVoted.replace(/{link}/g, `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}`);
    let alreadyVoted = new EmbedBuilder()
      .setTitle(config.Locale.suggestionAlreadyVotedTitle)
      .setColor("Red")
      .setDescription(alreadyvotedVariable)
      .setFooter({ text: `${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}` })
      .setTimestamp();

    // Kiểm tra xem người dùng đã bỏ phiếu chưa
    const existingVote = suggestion.voters.find(voter => voter.userID === interaction.user.id);
    if (existingVote) return interaction.editReply({ embeds: [alreadyVoted], ephemeral: true });

    // Nếu người dùng đã bỏ phiếu, hãy tiến hành theo logic bỏ phiếu
    suggestion.upVotes += 1;
    suggestion.voters.push({ userID: interaction.user.id, voteType: 'upvote' });
    await suggestion.save();

    interaction.channel.messages.fetch(suggestion.msgID).then(async msg => {

      let upvotedVariable = config.Locale.suggestionUpvoted.replace(/{link}/g, `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}`);
      let sugUpvoted = new EmbedBuilder()
        .setTitle(config.Locale.suggestionUpvotedTitle)
        .setColor("Green")
        .setDescription(upvotedVariable)
        .setFooter({ text: `${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}` })
        .setTimestamp();

      interaction.editReply({ embeds: [sugUpvoted], ephemeral: true })

      const embed = msg.embeds[0]
      if (config.SuggestionSettings.EnableAcceptDenySystem) embed.fields[1] = { name: `• ${config.Locale.suggestionInformation}`, value: `> **${config.Locale.suggestionFrom}** <@!${suggestion.userID}>\n> **${config.Locale.suggestionUpvotes}** ${suggestion.upVotes}\n> **${config.Locale.suggestionDownvotes}** ${suggestion.downVotes}\n> **${config.Locale.suggestionStatus}** ${config.SuggestionStatuses.Pending}` }
      if (config.SuggestionSettings.EnableAcceptDenySystem === false) embed.fields[1] = { name: `• ${config.Locale.suggestionInformation}`, value: `> **${config.Locale.suggestionFrom}** <@!${suggestion.userID}>\n> **${config.Locale.suggestionUpvotes}** ${suggestion.upVotes}\n> **${config.Locale.suggestionDownvotes}** ${suggestion.downVotes}` }

      let suggestionLogsChannel = interaction.guild.channels.cache.get(config.SuggestionSettings.LogsChannel);
      const upvoteLog = new EmbedBuilder()
        .setColor("Green")
        .setDescription(`${config.SuggestionUpvote.ButtonEmoji} | <@!${interaction.user.id}> (${interaction.user.username}) **thích** [bài này](https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}) suggestion!`)
      if (config.SuggestionSettings.LogsChannel && suggestionLogsChannel) suggestionLogsChannel.send({ embeds: [upvoteLog] })

      msg.edit({ embeds: [embed] })

      statsDB.totalSuggestionUpvotes++;
      await statsDB.save();

    });

  }


  // Nút bỏ phiếu xuống
  if (interaction.customId === 'downvote') {
    await interaction.deferReply({ ephemeral: true });

    const suggestion = await suggestionModel.findOne({ msgID: interaction.message.id });
    if (!suggestion) return interaction.editReply('Không tìm thấy gợi ý trong cơ sở dữ liệu.')

    const statsDB = await guildModel.findOne({ guildID: config.GuildID });

    let cantvoteVariable = config.Locale.suggestionCantVote.replace(/{link}/g, `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}`);
    let cantVote = new EmbedBuilder()
      .setTitle(config.Locale.suggestionCantVoteTitle)
      .setColor("Red")
      .setDescription(cantvoteVariable)
      .setFooter({ text: `${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}` })
      .setTimestamp();

    // Kiểm tra xem đề xuất đã được chấp nhận hay bị từ chối
    if (suggestion.status === 'Accepted' || suggestion.status === 'Denied') {
      return interaction.editReply({ embeds: [cantVote], ephemeral: true });
    }

    let alreadyVotedVariable = config.Locale.suggestionAlreadyVoted.replace(/{link}/g, `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}`);
    let alreadyVoted = new EmbedBuilder()
      .setTitle(config.Locale.suggestionAlreadyVotedTitle)
      .setColor("Red")
      .setDescription(alreadyVotedVariable)
      .setFooter({ text: `${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}` })
      .setTimestamp();

    // Kiểm tra xem người dùng đã bỏ phiếu chưa
    const existingVote = suggestion.voters.find(voter => voter.userID === interaction.user.id);
    if (existingVote) return interaction.editReply({ embeds: [alreadyVoted], ephemeral: true });

    // Nếu người dùng đã bỏ phiếu, hãy tiến hành theo logic bỏ phiếu
    suggestion.downVotes += 1;
    suggestion.voters.push({ userID: interaction.user.id, voteType: 'downvote' });
    await suggestion.save();

    interaction.channel.messages.fetch(suggestion.msgID).then(async msg => {

      let downvoteVariable = config.Locale.suggestionDownvoted.replace(/{link}/g, `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}`);
      let sugDownvoted = new EmbedBuilder()
        .setTitle(config.Locale.suggestionDownvotedTitle)
        .setColor("Red")
        .setDescription(downvoteVariable)
        .setFooter({ text: `${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}` })
        .setTimestamp();

      interaction.editReply({ embeds: [sugDownvoted], ephemeral: true })

      const embed = msg.embeds[0]
      if (config.SuggestionSettings.EnableAcceptDenySystem) embed.fields[1] = { name: `• ${config.Locale.suggestionInformation}`, value: `> **${config.Locale.suggestionFrom}** <@!${suggestion.userID}>\n> **${config.Locale.suggestionUpvotes}** ${suggestion.upVotes}\n> **${config.Locale.suggestionDownvotes}** ${suggestion.downVotes}\n> **${config.Locale.suggestionStatus}** ${config.SuggestionStatuses.Pending}` }
      if (config.SuggestionSettings.EnableAcceptDenySystem === false) embed.fields[1] = { name: `• ${config.Locale.suggestionInformation}`, value: `> **${config.Locale.suggestionFrom}** <@!${suggestion.userID}>\n> **${config.Locale.suggestionUpvotes}** ${suggestion.upVotes}\n> **${config.Locale.suggestionDownvotes}** ${suggestion.downVotes}` }

      let suggestionLogsChannel = interaction.guild.channels.cache.get(config.SuggestionSettings.LogsChannel);
      const upvoteLog = new EmbedBuilder()
        .setColor("Red")
        .setDescription(`${config.SuggestionDownvote.ButtonEmoji} | <@!${interaction.user.id}> (${interaction.user.username}) **không thích** [bài này](https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}) suggestion!`)
      if (config.SuggestionSettings.LogsChannel && suggestionLogsChannel) suggestionLogsChannel.send({ embeds: [upvoteLog] })

      msg.edit({ embeds: [embed] })

      statsDB.totalSuggestionDownvotes++;
      await statsDB.save();

    });

  }

  // Nút đặt lại phiếu bầu
  if (interaction.customId === 'resetvote') {
    await interaction.deferReply({ ephemeral: true });

    const suggestion = await suggestionModel.findOne({ msgID: interaction.message.id });
    if (!suggestion) return interaction.editReply('Không tìm thấy gợi ý trong cơ sở dữ liệu.')

    let noVoteVariable = config.Locale.suggestionNoVote.replace(/{link}/g, `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}`);
    let noVote = new EmbedBuilder()
      .setTitle(config.Locale.suggestionNoVoteTitle)
      .setColor("Red")
      .setDescription(noVoteVariable)
      .setFooter({ text: `${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}` })
      .setTimestamp();

    // Kiểm tra xem người dùng đã bỏ phiếu chưa
    const existingVote = suggestion.voters.find(voter => voter.userID === interaction.user.id);
    if (!existingVote) return interaction.editReply({ embeds: [noVote], ephemeral: true })

    let cantvoteVariable = config.Locale.suggestionCantVote.replace(/{link}/g, `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}`);
    let cantVote = new EmbedBuilder()
      .setTitle(config.Locale.suggestionCantVoteTitle)
      .setColor("Red")
      .setDescription(cantvoteVariable)
      .setFooter({ text: `${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}` })
      .setTimestamp();

    // Kiểm tra xem đề xuất đã được chấp nhận hay bị từ chối
    if (suggestion.status === 'Accepted' || suggestion.status === 'Denied') {
      return interaction.editReply({ embeds: [cantVote], ephemeral: true });
    }

    if (existingVote.voteType === 'upvote') {
      suggestion.upVotes -= 1;
    } else if (existingVote.voteType === 'downvote') {
      suggestion.downVotes -= 1;
    }

    suggestion.voters.pull({ userID: interaction.user.id });
    await suggestion.save();

    interaction.channel.messages.fetch(suggestion.msgID).then(msg => {

      let voteResetVariable = config.Locale.suggestionVoteReset.replace(/{link}/g, `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}`);
      let voteReset = new EmbedBuilder()
        .setTitle(config.Locale.suggestionVoteResetTitle)
        .setColor("Green")
        .setDescription(voteResetVariable)
        .setFooter({ text: `${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}` })
        .setTimestamp();

      interaction.editReply({ embeds: [voteReset], ephemeral: true })

      const embed = msg.embeds[0]
      if (config.SuggestionSettings.EnableAcceptDenySystem) embed.fields[1] = { name: `• ${config.Locale.suggestionInformation}`, value: `> **${config.Locale.suggestionFrom}** <@!${suggestion.userID}>\n> **${config.Locale.suggestionUpvotes}** ${suggestion.upVotes}\n> **${config.Locale.suggestionDownvotes}** ${suggestion.downVotes}\n> **${config.Locale.suggestionStatus}** ${config.SuggestionStatuses.Pending}` }
      if (config.SuggestionSettings.EnableAcceptDenySystem === false) embed.fields[1] = { name: `• ${config.Locale.suggestionInformation}`, value: `> **${config.Locale.suggestionFrom}** <@!${suggestion.userID}>\n> **${config.Locale.suggestionUpvotes}** ${suggestion.upVotes}\n> **${config.Locale.suggestionDownvotes}** ${suggestion.downVotes}` }

      let suggestionLogsChannel = interaction.guild.channels.cache.get(config.SuggestionSettings.LogsChannel);
      const upvoteLog = new EmbedBuilder()
        .setColor("Orange")
        .setDescription(`${config.SuggestionResetvote.ButtonEmoji} | <@!${interaction.user.id}> (${interaction.user.username}) đã **đặt lại lượt thích** [bài này](https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}) suggestion!`)
      if (config.SuggestionSettings.LogsChannel && suggestionLogsChannel) suggestionLogsChannel.send({ embeds: [upvoteLog] })

      msg.edit({ embeds: [embed] })
    });
  }


  // Nút chấp nhận
  if (interaction.isMessageContextMenuCommand() && interaction.commandName.startsWith('Accept')) {
    if (config.SuggestionSettings.EnableAcceptDenySystem === false) return;
    await interaction.deferReply({ ephemeral: true });

    const suggestion = await suggestionModel.findOne({ msgID: interaction.targetId });
    if (!suggestion) return interaction.editReply('Không tìm thấy gợi ý trong cơ sở dữ liệu.')

    let sRole = false
    await config.SuggestionSettings.AllowedRoles.forEach(r => {
      role = interaction.guild.roles.cache.get(r);
      if (role) {
        if (interaction.member.roles.cache.has(role.id)) {
          sRole = true
        }
      }
    })
    if (sRole === false) return interaction.editReply({ content: config.Locale.suggestionNoPerms, ephemeral: true })

    suggestion.status = "Accepted";
    await suggestion.save();

    interaction.channel.messages.fetch(suggestion.msgID).then(msg => {
      let acceptedVariable = config.Locale.suggestionAccepted.replace(/{link}/g, `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}`);
      let sugAccepted = new EmbedBuilder()
        .setTitle(config.Locale.suggestionAcceptedTitle)
        .setColor("Green")
        .setDescription(acceptedVariable)
        .setFooter({ text: `${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}` })
        .setTimestamp();

      interaction.editReply({ embeds: [sugAccepted], ephemeral: true })

      const embed = msg.embeds[0]
      if (config.SuggestionSettings.EnableAcceptDenySystem) embed.fields[1] = { name: `• ${config.Locale.suggestionInformation}`, value: `> **${config.Locale.suggestionFrom}** <@!${suggestion.userID}>\n> **${config.Locale.suggestionUpvotes}** ${suggestion.upVotes}\n> **${config.Locale.suggestionDownvotes}** ${suggestion.downVotes}\n> **${config.Locale.suggestionStatus}** ${config.SuggestionStatuses.Accepted}` }

      const embedColor = EmbedBuilder.from(embed)
      embedColor.setColor(config.SuggestionStatusesEmbedColors.Accepted)

      if (config.SuggestionSettings.RemoveAllButtonsIfAcceptedOrDenied === false) msg.edit({ embeds: [embedColor] })
      if (config.SuggestionSettings.RemoveAllButtonsIfAcceptedOrDenied) msg.edit({ embeds: [embedColor], components: [] })

      let suggestionLogsChannel = interaction.guild.channels.cache.get(config.SuggestionSettings.LogsChannel);
      const upvoteLog = new EmbedBuilder()
        .setColor("Green")
        .setDescription(`${config.SuggestionAccept.Emoji} | <@!${interaction.user.id}> (${interaction.user.username}) đã **chấp nhận** [bài này](https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}) suggestion!`)
      if (config.SuggestionSettings.LogsChannel && suggestionLogsChannel) suggestionLogsChannel.send({ embeds: [upvoteLog] })

    });
  }


  // Nút từ chối
  if (interaction.isMessageContextMenuCommand() && interaction.commandName.startsWith('Deny')) {
    if (config.SuggestionSettings.EnableAcceptDenySystem === false) return;
    await interaction.deferReply({ ephemeral: true });

    const suggestion = await suggestionModel.findOne({ msgID: interaction.targetId });
    if (!suggestion) return interaction.editReply('Không tìm thấy gợi ý trong cơ sở dữ liệu.')

    let sRole = false
    await config.SuggestionSettings.AllowedRoles.forEach(r => {
      role = interaction.guild.roles.cache.get(r);
      if (role) {
        if (interaction.member.roles.cache.has(role.id)) {
          sRole = true
        }
      }
    })
    if (sRole === false) return interaction.editReply({ content: config.Locale.suggestionNoPerms, ephemeral: true })

    suggestion.status = "Denied";
    await suggestion.save();

    interaction.channel.messages.fetch(suggestion.msgID).then(msg => {

      let deniedVariable = config.Locale.suggestionDenied.replace(/{link}/g, `https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}`);
      let sugAccepted = new EmbedBuilder()
        .setTitle(config.Locale.suggestionDeniedTitle)
        .setColor("Red")
        .setDescription(deniedVariable)
        .setFooter({ text: `${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}` })
        .setTimestamp();

      interaction.editReply({ embeds: [sugAccepted], ephemeral: true })

      const embed = msg.embeds[0]
      if (config.SuggestionSettings.EnableAcceptDenySystem) embed.fields[1] = { name: `• ${config.Locale.suggestionInformation}`, value: `> **${config.Locale.suggestionFrom}** <@!${suggestion.userID}>\n> **${config.Locale.suggestionUpvotes}** ${suggestion.upVotes}\n> **${config.Locale.suggestionDownvotes}** ${suggestion.downVotes}\n> **${config.Locale.suggestionStatus}** ${config.SuggestionStatuses.Denied}` }

      const embedColor = EmbedBuilder.from(embed)
      embedColor.setColor(config.SuggestionStatusesEmbedColors.Denied)

      if (config.SuggestionSettings.RemoveAllButtonsIfAcceptedOrDenied === false) msg.edit({ embeds: [embedColor] })
      if (config.SuggestionSettings.RemoveAllButtonsIfAcceptedOrDenied) msg.edit({ embeds: [embedColor], components: [] })

      let suggestionLogsChannel = interaction.guild.channels.cache.get(config.SuggestionSettings.LogsChannel);
      const upvoteLog = new EmbedBuilder()
        .setColor("Red")
        .setDescription(`${config.SuggestionDeny.Emoji} | <@!${interaction.user.id}> (${interaction.user.username}) đã **từ chối** [bài này](https://discord.com/channels/${interaction.guild.id}/${interaction.channel.id}/${suggestion.msgID}) suggestion!`)
      if (config.SuggestionSettings.LogsChannel && suggestionLogsChannel) suggestionLogsChannel.send({ embeds: [upvoteLog] })

    });
  }




  // Hệ thống xếp hạng ticket
  if (interaction.customId === 'ratingSelect') {

    // Tìm tin nhắn đánh giá
    const reviewDataDB = await reviewsModel.findOne({
      reviewDMUserMsgID: interaction.message.id,
      userID: interaction.user.id,
    });
    if (!reviewDataDB) return;

    const modal = new ModalBuilder()
      .setCustomId('modal-whyRating')
      .setTitle(config.Locale.ticketRating)

    const reviewInput = new TextInputBuilder()
      .setCustomId('textinput-whyRating')
      .setLabel(config.Locale.ticketRating)
      .setStyle('Paragraph')
      .setMinLength(config.TicketReviewSettings.MinimumWords)
      .setMaxLength(config.TicketReviewSettings.MaximumWords)
      .setPlaceholder(config.Locale.explainWhyRating)
      .setRequired(true)

    const modalActionRow = new ActionRowBuilder().addComponents(reviewInput);
    modal.addComponents(modalActionRow);

    async function handleStarRating(interaction, rating) {
      const arr = [{
        rating: rating,
        guildID: config.GuildID,
        userID: interaction.user.id,
      }];


      if (config.TicketReviewSettings.AskWhyModal) await interaction.showModal(modal);

      if (!reviewDataDB.alreadyRated || reviewDataDB.alreadyRated === false) {
        // Cập nhật reviewsModel và thiết lập xếp hạng
        await reviewsModel.updateOne(
          { reviewDMUserMsgID: interaction.message.id },
          {
            $set: { rating: rating, alreadyRated: true }
          }
        );

        // Cập nhật guildModel với xếp hạng và số liệu thống kê totalReview
        await guildModel.updateOne(
          { guildID: config.GuildID },
          {
            $push: { reviews: { $each: arr } },
            $inc: { totalReviews: 1 }
          }
        );
      }


      const reviewDB = await reviewsModel.findOne({ reviewDMUserMsgID: interaction.message.id });

      let guild = client.guilds.cache.get(config.GuildID)
      let logsChannel;
      if (!config.ticketClose.ChannelID) logsChannel = guild.channels.cache.get(config.TicketSettings.LogsChannelID);
      if (config.ticketClose.ChannelID) logsChannel = guild.channels.cache.get(config.ticketClose.ChannelID);


      let star = "⭐".repeat(rating);

      if (config.TicketReviewSettings.AskWhyModal === false) {
        logsChannel.messages.fetch(reviewDB.tCloseLogMsgID).then(msg => {
          const embed = msg.embeds[0]
          embed.fields[3] = { name: `• ${config.Locale.ticketRating}`, value: `> ${star} \`\`(${rating}/5)\`\`` }
          msg.edit({ embeds: [embed] })
        })

        interaction.channel.messages.fetch(reviewDB.reviewDMUserMsgID).then(msg => {
          msg.edit({ components: [] })
          interaction.reply({ content: config.TicketReviewSettings.ReviewMsg, ephemeral: true })
        });
      }
    }

    switch (interaction.values[0]) {
      case "one_star":
        await handleStarRating(interaction, 1);
        break;

      case "two_star":
        await handleStarRating(interaction, 2);
        break;

      case "three_star":
        await handleStarRating(interaction, 3);
        break;

      case "four_star":
        await handleStarRating(interaction, 4);
        break;

      case "five_star":
        await handleStarRating(interaction, 5);
        break;

      default:
      // Xử lý các trường hợp khác
    }
  }

  if (interaction.type === InteractionType.ModalSubmit && config.TicketReviewSettings.AskWhyModal && !interaction.customId.startsWith('questionModal') && interaction.customId !== "closeReason") {
    await interaction.deferReply({ ephemeral: true });

    const reviewDB = await reviewsModel.findOne({ reviewDMUserMsgID: interaction.message.id });
    const statsDB = await guildModel.findOne({ guildID: config.GuildID });
    const ticketDB = await ticketModel.findOne({ channelID: reviewDB.ticketChannelID });


    if (interaction.customId === 'modal-whyRating' && reviewDB.reviewDMUserMsgID === interaction.message.id && reviewDB.userID === interaction.user.id) {
      const firstResponse = interaction.fields.getTextInputValue('textinput-whyRating');

      let guild = client.guilds.cache.get(config.GuildID)
      let logsChannel;
      if (!config.ticketClose.ChannelID) logsChannel = guild.channels.cache.get(config.TicketSettings.LogsChannelID);
      if (config.ticketClose.ChannelID) logsChannel = guild.channels.cache.get(config.ticketClose.ChannelID);


      const channel = interaction.channel || (await client.channels.fetch(interaction.channelId));
      if (channel) {
        await channel.messages.fetch(reviewDB.reviewDMUserMsgID).then(async (msg) => {

          let claimUser = await client.users.cache.get(ticketDB.claimUser)
          if (!claimUser) claimUser = config.Locale.notClaimedCloseDM;

          let star = ""
          for (var i = 0; i < reviewDB.rating; i++) {
            star += "⭐"
          }

          // Cập nhật reviewsModel và thiết lập xếp hạng
          await reviewsModel.updateOne(
            { reviewDMUserMsgID: interaction.message.id },
            {
              $set: { reviewMessage: firstResponse }
            }
          );

          let ticketCloseLocale = config.TicketUserCloseDM.CloseEmbedMsg.replace(/{guildName}/g, `${guild.name}`).replace(/{closedAt}/g, `<t:${(ticketDB.closedAt / 1000 | 0)}:R>`).replace(/{close-reason}/g, `${ticketDB.closeReason}`);
          let ticketCloseReviewLocale = config.TicketReviewSettings.ticketReviewed.replace(/{star}/g, `${star}`).replace(/{rating}/g, `${reviewDB.rating}`).replace(/{reviewMessage}/g, `${firstResponse}`).replace(/{close-reason}/g, `${ticketDB.closeReason}`);
          let ticketCloseRatingLocale = config.TicketReviewSettings.ticketRated.replace(/{star}/g, `${star}`).replace(/{rating}/g, `${reviewDB.rating}`);

          const originalEmbed = msg.embeds[0];

          const embed = new EmbedBuilder()
          embed.setTitle(config.Locale.ticketClosedCloseDM)
          if (!config.TicketUserCloseDM.Enabled && firstResponse) embed.setDescription(ticketCloseReviewLocale)
          if (config.TicketUserCloseDM.Enabled && firstResponse) embed.setDescription(`${config.TicketUserCloseDM.CloseEmbedMsg}\n${ticketCloseReviewLocale}`)
          if (config.TicketUserCloseDM.Enabled) embed.setDescription(`${ticketCloseLocale}\n${ticketCloseRatingLocale}`)
          if (!config.TicketUserCloseDM.Enabled) embed.setDescription(`${ticketCloseRatingLocale}`)
          originalEmbed.fields.forEach(field => {
            embed.addFields(field);
          });
          embed.setColor(config.EmbedColors)

          msg.edit({ embeds: [embed], components: [] })
        });
      } else {
        console.error("Không tìm thấy kênh!");
      }

      await interaction.editReply({ content: config.TicketReviewSettings.ReviewMsg, ephemeral: true })


      let star = ""
      for (var i = 0; i < reviewDB.rating; i++) {
        star += "⭐"
      }

      let ticketAuthor = client.users.cache.get(reviewDB.ticketCreatorID)
      let reviewChannel = guild.channels.cache.get(config.ReviewChannel.ChannelID);

      const embedSettings = config.ReviewChannel.Embed;
      const embed = new EmbedBuilder()
      if (embedSettings.Title) embed.setTitle(embedSettings.Title.replace('{totalReviews}', statsDB.totalReviews).replace('{ticketCreator.username}', ticketAuthor.username).replace('{ticket.totalMessages}', reviewDB.totalMessages).replace('{ticketCategory}', reviewDB.category).replace('{ticketCategory}', reviewDB.category))
      if (embedSettings.Color) embed.setColor(embedSettings.Color);
      if (!embedSettings.Color) embed.setColor(config.EmbedColors);

      if (embedSettings.ThumbnailEnabled) {
        if (embedSettings.CustomThumbnail && embedSettings.CustomThumbnail !== '') {
          embed.setThumbnail(embedSettings.CustomThumbnail);
        } else {
          embed.setThumbnail(interaction.user.displayAvatarURL({ format: 'png', dynamic: true }));
        }
      }

      embed.addFields(embedSettings.Fields.map(field => ({
        name: field.name,
        value: field.value
          .replace('{ticketCreator.id}', ticketAuthor.id)
          .replace('{ticketCreator.username}', ticketAuthor.username)
          .replace('{ticketCategory}', reviewDB.category)
          .replace('{ticket.totalMessages}', reviewDB.totalMessages)
          .replace('{stars}', star)
          .replace('{reviewMessage}', firstResponse),
      })));

      if (embedSettings.Timestamp) {
        embed.setTimestamp();
      }

      const footerText = embedSettings.Footer.text
        .replace('{ticketCreator.username}', ticketAuthor.username)
        .replace('{ticketCategory}', reviewDB.category)
        .replace('{ticket.totalMessages}', reviewDB.totalMessages)

      // Kiểm tra xem footer.text có trống không trước khi đặt chân trang
      if (footerText.trim() !== '') {
        if (embedSettings.Footer.Enabled && embedSettings.Footer.CustomIconURL == '' && embedSettings.Footer.IconEnabled) {
          embed.setFooter({
            text: footerText,
            iconURL: interaction.user.displayAvatarURL({ format: 'png', dynamic: true }),
          });
        } else {
          embed.setFooter({
            text: footerText,
          });
        }
      }

      // Các tùy chọn tùy chỉnh bổ sung từ config.yaml
      if (footerText.trim() !== '' && embedSettings.Footer.CustomIconURL !== '' && embedSettings.Footer.IconEnabled) {
        embed.setFooter({
          text: footerText,  // Bao gồm văn bản nếu nó không trống
          iconURL: embedSettings.Footer.CustomIconURL,
        });
      }

      const nonce = SnowflakeUtil.generate();

      if (reviewChannel && config.ReviewChannel.Enabled) reviewChannel.send({ embeds: [embed], enforceNonce: true, nonce: nonce.toString() })

      await logsChannel.messages.fetch(reviewDB.tCloseLogMsgID).then(async (msg) => {
        const embed = msg.embeds[0]
        embed.fields[3] = { name: `• ${config.Locale.ticketRating}`, value: `> ${star} \`\`(${reviewDB.rating}/5)\`\`\n> ${firstResponse}` }
        await msg.edit({ embeds: [embed] })
      })

    }
  }

  // Nút xóa ticket
  if (interaction.customId === 'deleteTicket') {

    let supportRole = await utils.checkIfUserHasSupportRoles(interaction)
    if (!supportRole) {
      return interaction.reply({ content: config.Locale.notAllowedDelete, ephemeral: true });
    }

    if (!config.TicketSettings.TicketCloseReason) await interaction.deferReply().catch()

    let ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });

    interaction.channel.messages.fetch(ticketDB.archiveMsgID).then(msg => {
      msg.delete()
    })

    // set closerUserID in the tickets db
    await ticketModel.updateOne(
      { channelID: interaction.channel.id },
      {
        $set: {
          closeUserID: interaction.user.id,
          closedAt: Date.now(),
        },
      }
    );
    await client.emit('ticketClose', interaction);
  }


  eventHandler.emit('interactionCreate', interaction);

}