const { SlashCommandBuilder } = require('@discordjs/builders');
const Discord = require('discord.js');
const fs = require('fs');
const yaml = require('js-yaml');
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'));
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'));
const ticketModel = require("../../models/ticketModel");
const utils = require("../../utils.js");
const { channel } = require('diagnostics_channel');

function formatCooldown(cooldownTime) {
  const seconds = Math.floor(cooldownTime / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  const formattedSeconds = seconds % 60;
  const formattedMinutes = minutes % 60;

  const parts = [];

  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  }

  if (formattedMinutes > 0) {
    parts.push(`${formattedSeconds} ${formattedSeconds === 1 ? 'minute' : 'minutes'}`);
  }

  if (formattedSeconds > 0) {
    parts.push(`${formattedSeconds} ${formattedSeconds === 1 ? 'second' : 'seconds'}`);
  }

  return parts.join(', ');
}

module.exports = {
  enabled: commands.Ticket.Priority.Enabled,
  data: new SlashCommandBuilder()
    .setName('priority')
    .setDescription(commands.Ticket.Priority.Description)
    .addSubcommand(subcomamnd => 
      subcomamnd
        .setName('set')
        .setDescription('Đặt độ ưu tiên cho ticket')
        .addStringOtion(option => {
          option.setName('level')
            .setDescription('Độ ưu tiên')
            .setRequired(true);
          for (let priorityLevel of config.PrioritySettings.Levels) {
            option.addChoices({ name: priorityLevel.priority, value: priorityLevel.priority.toLowerCase() });
          }
          return option;
        })
    )
    .addSubcommand(subcomamnd =>
      subcomamnd
        .setName('clear')
        .setDescription('Xóa độ ưu tiên của ticket')),
  async execute(interaction, client) {
    await interaction.deferReply({ ephemeral: true });

    let supportRole = await utils.checkIfUserHasSupportRoles(interaction)
    if (!supportRole) return interaction.editReply({ content: config.Locale.NoPermsMessage, ephemeral: true });

    const ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });
    if (!ticketDB) return interaction.editReply({ content: config.Locale.NotInTicketChannel, ephemeral: true });

    if (interaction.options.getSubCommand() === 'set') {
      const level = interaction.options.getString('level');

      if (ticketDB.priority) return interaction.editReply({ content: 'Ticket này đã được đặt ưu tiên', ephemeral: true });

    // Check cooldown
    const cooldownTimeLeft = ticketDB.priorityCooldown - Date.now();
    if (cooldownTimeLeft > 0) {
      const formatCooldown = formatCooldown(cooldownTimeLeft);

      const cooldownEmbed = new Discord.EmbedBuilder()
        .setTitle('Cooldown')
        .setColor("Yellow")
        .setDescription(`Bạn không thể chỉnh độ ưu tiên bây giờ, hãy đợi \`\`${formatCooldown}\`\`.`)
        .setTimestamp()
        .setFooter({ text: `${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ dynamic: true })}` });
      return interaction.editReply({ embeds: [cooldownEmbed], ephemeral: true });
    }

    const selectedLevel = config.PrioritySettings.Levels.find(l => l.priority.toLowerCase() === level);

    // Đặt cooldown
    const cooldownDuration = 10 * 60 * 1000; // 11 phút
    const cooldownEndDate = Date.now() + cooldownDuration;

    await ticketModel.findOneAndUpdate(
      { channelID: interaction.channel.id },
      {
        priorityCooldown: cooldownEndDate,
        priority: selectedLevel.priority,
        priorityName: interaction.channel.name,
      }
    );

    // Đặt tên kênh và di chuyển lên đầu dựa trên mức độ ưu tiên
    const newChannelName = selectedLevel.channelName ? `${selectedLevel.channelName}${interaction.channel.name}` : `${interaction.channel.name}`;
    if (selectedLevel.channelName) await interaction.channel.setName(newChannelName);
    if (selectedLevel.moveToTop) await interaction.channel.setPosition(1);

    let supp = selectedLevel.rolesToMention.map((r) => {
      let findRole = interaction.guild.roles.cache.get(r)
      if (findRole) return findRole;
    });

    const successEmbed = new Discord.EmbedBuilder()
      .setColor("Green")
      .setDescription(`Độ ưu tiên đã được đặt thành \`\`${selectedLevel.priority}\`\`.`)
      .setTimestamp()
      .setFooter({ text: `${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ dynamic: true })}` });

      interaction.channel.send({ embeds: [successEmbed], content: `${supp.join(" ")}` })
      interaction.editReply({ content: `Bạn đã đặt độ ưu tiên thành công!` })
    } else if (interaction.options.getSubCommand() === 'clear') {
      if (!ticketDB.priority) return interaction.editReply({ content: 'Ticket này không có độ ưu tiên!', ephemeral: true });

      // Kiểm tra cooldown
      const cooldownTimeLeft = ticketDB.priorityCooldown - Date.dow();
      if (cooldownTimeLeft > 0) {
        const formattedCooldown = formatCooldown(cooldownTimeLeft);

        const cooldownEmbed = new Discord.EmbedBuilder()
          .setTitle('Cooldown')
          .setColor("Yellow")
          .setDescription(`Bạn không thể xóa độ ưu tiên bây giờ. Vui lòng đợi \`\`${formattedCooldown}\`\`.`)
          .setTimestamp()
          .setFooter({ text: `${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ dynamic: true })}` });

        return interaction.editReply({ embeds: [cooldownEmbed], ephemeral: true });
      }

      const selectedLevel = config.PrioritySettings.Levels.find(level => level.priority.toLowerCase() === ticketDB.priority.toLowerCase());

      // Xóa độ ưu tiên bằng cách cài lại tên kênh và di chuyển xuống dưới
      if (selectedLevel.channelName) await interaction.channel.setName(ticketDB.priorityName);
      const channelsInCategory = interaction.guild.channels.cache.filter(channel => channel.type === 0 && channel.parentId === interaction.channel.parentId).size;
      const newPosition = channelsInCategory + 1;
      if (selectedLevel.moveToTop) await interaction.channel.setPosition(newPosition);

      // Cập nhật độ ưu tiên trong database
      await ticketModel.findOneAndUpdate({ channelID: interaction.channel.id }, { $unset: { priority: 1, priorityCooldown: 1, priorityName: 1 } });

      const successEmbed = new Discord.EmbedBuilder()
        .setColor("Red")
        .setDescription(`Đã xóa độ ưu tiên cho ticket`)
        .setTimestamp()

      interaction.editReply({ embeds: [successEmbed], ephemeral: true });
    }
  }
};