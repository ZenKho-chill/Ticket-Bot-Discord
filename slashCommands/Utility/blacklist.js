const { SlashCommandBuilder } = require('@discordjs/builders');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const Discord = require('discord.js');
const fs = require('fs');
const yaml = require('js-yaml');
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'));
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'));
const ticketModel = require('../../models/ticketModel');
const blacklistModel = require('../../models/blacklistedUsersModel');

function createBlacklistedUsersEmbed(blacklistedUsers, currentPage, totalPages) {
  const itemsPerPage = 10;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;

  const embed = new Discord.EmbedBuilder();

  if (blacklistedUsers.length !== 0) {
    embed.setTitle('Người dùng bị đưa vào danh sách đen');
    embed.setColor(config.EmbedColors);
    embed.setDescription('Danh sách người dùng hiện đang bị đưa vào danh sách đen');
    embed.setFooter({ text: `Trang ${currentPage}/${totalPages}` });

    if (startIndex < blacklistedUsers.length) {
      const fields = [];
    
      for (let i = startIndex; i < endIndex && i < blacklistedUsers.length; i++) {
        const user = blacklistedUsers[i];
        fields.push({ name: 'Người dùng', value: `<@!${user.userId}>`, inline: false });
      }
    
      if (fields.length > 0) {
        embed.addFields(fields);
      }
    }
  } else {
    embed.setColor('Red');
    embed.setDescription('Hiện tại không có người dùng nào bị đưa vào danh sách đen.');
    embed.setFooter({ text: `Trang ${currentPage}/${totalPages}` });
  }

  return embed;
}

module.exports = {
  enabled: commands.Utility.Blacklist.Enabled,
  data: new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Quản lý danh sách đen người dùng')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Thêm người dùng vào danh sách đen')
        .addUserOption((option) => option.setName('user').setDescription('User').setRequired(true))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('Xóa người dùng khỏi danh sách đen')
        .addUserOption((option) => option.setName('user').setDescription('User').setRequired(true))
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('Liệt kê tất cả người dùng hiện đang bị đưa vào danh sách đen')
    ),
  async execute(interaction, client) {
    try {
      await interaction.deferReply({ ephemeral: true });
      if (!interaction.member.permissions.has('ManageChannels')) return interaction.editReply({ content: config.Locale.NoPermsMessage, ephemeral: true });

      const subcommand = interaction.options.getSubcommand();
      const user = interaction.options.getUser('user');

      const itemsPerPage = 5;
      
      let blacklistedUser = await blacklistModel.findOne({ userId: user?.id });

      if (!blacklistedUser) {
        blacklistedUser = new blacklistModel({ userId: user?.id });
      }

      if (subcommand === 'add') {
        if (blacklistedUser.blacklisted) {
          const alreadyBlacklistedLocale = config.Locale.alreadyBlacklisted.replace(/{user}/g, `<@!${user.id}>`).replace(/{username}/g, `${user.username}`);
          const alreadyBlacklisted = new Discord.EmbedBuilder().setColor('Red').setDescription(alreadyBlacklistedLocale);
          return interaction.editReply({ embeds: [alreadyBlacklisted], ephemeral: true });
        }

        blacklistedUser.blacklisted = true;
        await blacklistedUser.save();

        const successfullyBlacklistedLocale = config.Locale.successfullyBlacklisted.replace(/{user}/g, `<@!${user.id}>`).replace(/{username}/g, `${user.username}`);
        const embed = new Discord.EmbedBuilder().setColor('Green').setDescription(successfullyBlacklistedLocale);

        interaction.editReply({ embeds: [embed], ephemeral: true });
      } else if (subcommand === 'remove') {
        if (!blacklistedUser.blacklisted) {
          const notBlacklistedLocale = config.Locale.notBlacklisted.replace(/{user}/g, `<@!${user.id}>`).replace(/{username}/g, `${user.username}`);
          const notBlacklisted = new Discord.EmbedBuilder().setColor('Red').setDescription(notBlacklistedLocale);
          return interaction.editReply({ embeds: [notBlacklisted], ephemeral: true });
        }

        blacklistedUser.blacklisted = false;
        await blacklistedUser.save();

        const successfullyUnblacklistedLocale = config.Locale.successfullyUnblacklisted.replace(/{user}/g, `<@!${user.id}>`).replace(/{username}/g, `${user.username}`);
        const embed = new Discord.EmbedBuilder().setColor('Green').setDescription(successfullyUnblacklistedLocale);

        interaction.editReply({ embeds: [embed], ephemeral: true });
      } else if (subcommand === 'list') {
        const blacklistedUsers = await blacklistModel.find({ blacklisted: true });

        const totalPages = Math.max(1, Math.ceil(blacklistedUsers.length / itemsPerPage));
        let currentPage = 1;
    
        const calculateIndices = () => {
          const startIndex = (currentPage - 1) * itemsPerPage;
          const endIndex = Math.min(startIndex + itemsPerPage, blacklistedUsers.length);
      
          if (startIndex >= blacklistedUsers.length) {
              const lastPageStartIndex = Math.max(0, blacklistedUsers.length - itemsPerPage);
              return { startIndex: lastPageStartIndex, endIndex: blacklistedUsers.length };
          }
      
          return { startIndex, endIndex };
      };
    
      if (blacklistedUsers.length !== 0) {
        const paginationButtons = new Discord.ActionRowBuilder().addComponents(
            new Discord.ButtonBuilder()
                .setCustomId('prevPage')
                .setLabel('Trang trước')
                .setStyle('Primary'),
            new Discord.ButtonBuilder()
                .setCustomId('nextPage')
                .setLabel('Trang tiếp theo')
                .setStyle('Primary'),
        );
    
        const { startIndex, endIndex } = calculateIndices();
        const embed = createBlacklistedUsersEmbed(blacklistedUsers.slice(startIndex, endIndex), currentPage, totalPages);
        
        const initialMessageOptions = {
            embeds: [embed],
            components: [paginationButtons],
        };
    
        await interaction.editReply(initialMessageOptions);
    
        const collectorFilter = (buttonInteraction) => {
            return buttonInteraction.user.id === interaction.user.id && ['prevPage', 'nextPage'].includes(buttonInteraction.customId);
        };
    
        const collector = interaction.channel.createMessageComponentCollector({
            filter: collectorFilter,
            time: 180000,
        });
    
        collector.on('collect', async (buttonInteraction) => {
          if (buttonInteraction.customId === 'prevPage' && currentPage > 1) {
              currentPage--;
          } else if (buttonInteraction.customId === 'nextPage' && currentPage < totalPages) {
              currentPage++;
          }
      
          const { startIndex, endIndex } = calculateIndices();
      
          const updatedEmbed = createBlacklistedUsersEmbed(blacklistedUsers.slice(startIndex, endIndex), currentPage, totalPages);
      
          updatedEmbed.fields = [];
      
          for (let i = startIndex; i < endIndex && i < blacklistedUsers.length; i++) {
              const user = blacklistedUsers[i];
              updatedEmbed.addFields({ name: 'Người dùng', value: `<@!${user.userId}>`, inline: false });
          }
      
          if (endIndex < blacklistedUsers.length) {
              updatedEmbed.addFields(
                  blacklistedUsers
                      .slice(endIndex, Math.min(endIndex + itemsPerPage, blacklistedUsers.length))
                      .map(user => ({ name: 'Người dùng', value: `<@!${user.userId}>`, inline: false }))
              );
          }
      
          try {
              await buttonInteraction.update({ embeds: [updatedEmbed], components: [paginationButtons] });
          } catch (updateError) {
              console.error('Lỗi khi cập nhật tương tác nút:', updateError);
              collector.stop();
          }
      });
      
    } else {
        const embed = createBlacklistedUsersEmbed(blacklistedUsers, currentPage, totalPages);
        await interaction.editReply({ embeds: [embed] });
    }
    }
} catch (error) {
    console.error('Lỗi khi quản lý người dùng bị đưa vào danh sách đen:', error);
    interaction.editReply({ content: "Có lỗi khi quản lý người dùng bị đưa vào danh sách đen. Hãy thử lại.", ephemeral: true });
}
},
};