const { SlashCommandBuilder } = require('@discordjs/builders');
const Discord = require('discord.js');
const fs = require('fs');
const yaml = require('js-yaml');
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'));
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'));
const ticketModel = require("../../models/ticketModel");
const utils = require("../../utils.js");

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
        parts.push(`${formattedMinutes} ${formattedMinutes === 1 ? 'minute' : 'minutes'}`);
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
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Đặt mức độ ưu tiên của một ticket')
                .addStringOption(option => {
                    option.setName('level')
                        .setDescription('Độ ưu tiên')
                        .setRequired(true);
                    
                    for (let priorityLevel of config.PrioritySettings.Levels) {
                        option.addChoices({ name: priorityLevel.priority, value: priorityLevel.priority.toLowerCase() });
                    }
                    
                    return option;
                })
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('clear')
                .setDescription('Xóa ưu tiên của một ticket')),
    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true });

        let supportRole = await utils.checkIfUserHasSupportRoles(interaction)
        if (!supportRole) return interaction.editReply({ content: config.Locale.NoPermsMessage, ephemeral: true });

        const ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });
        if (!ticketDB) return interaction.editReply({ content: config.Locale.NotInTicketChannel, ephemeral: true });

        if (interaction.options.getSubcommand() === 'set') {
            const level = interaction.options.getString('level');

            if (ticketDB.priority) return interaction.editReply({ content: 'Ticket này đã được đặt ưu tiên.', ephemeral: true });

        // Check cooldown
        const cooldownTimeLeft = ticketDB.priorityCooldown - Date.now();
        if (cooldownTimeLeft > 0) {
            const formattedCooldown = formatCooldown(cooldownTimeLeft);

            const cooldownEmbed = new Discord.EmbedBuilder()
                .setTitle('Cooldown')
                .setColor("Yellow")
                .setDescription(`Bạn không thể thiết lập mức độ ưu tiên ngay bây giờ. Vui lòng đợi \`\`${formattedCooldown}\`\`.`)
                .setTimestamp()
                .setFooter({ text: `${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ dynamic: true })}` });

            return interaction.editReply({ embeds: [cooldownEmbed], ephemeral: true });
        }

            const selectedLevel = config.PrioritySettings.Levels.find(l => l.priority.toLowerCase() === level);

            // Thiết lập thời gian hồi chiêu
            const cooldownDuration = 10 * 60 * 1000; // 11 phút thời gian hồi phục
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
            if(selectedLevel.channelName) await interaction.channel.setName(newChannelName);
            if(selectedLevel.moveToTop) await interaction.channel.setPosition(1);

            let supp = selectedLevel.rolesToMention.map((r) => {
                let findRole = interaction.guild.roles.cache.get(r)
  
                if (findRole) return findRole;
            });

        const successEmbed = new Discord.EmbedBuilder()
            .setColor("Green")
            .setDescription(`Ưu tiên được đặt thành \`\`${selectedLevel.priority}\`\` cho ticket này.`)
            .setTimestamp()
            .setFooter({ text: `${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ dynamic: true })}` });

            interaction.channel.send({ embeds: [successEmbed], content: `${supp.join(" ")}` })
            interaction.editReply({ content: `Bạn đã thiết lập thành công mức độ ưu tiên cho ticket này!` })
        } else if (interaction.options.getSubcommand() === 'clear') {
            if (!ticketDB.priority) return interaction.editReply({ content: 'Ticket này không có ưu tiên!', ephemeral: true });

        // Check cooldown
        const cooldownTimeLeft = ticketDB.priorityCooldown - Date.now();
        if (cooldownTimeLeft > 0) {
            const formattedCooldown = formatCooldown(cooldownTimeLeft);

            const cooldownEmbed = new Discord.EmbedBuilder()
                .setTitle('Cooldown')
                .setColor("Yellow")
                .setDescription(`Bạn không thể xóa ưu tiên ngay bây giờ. Vui lòng đợi \`\`${formattedCooldown}\`\`.`)
                .setTimestamp()
                .setFooter({ text: `${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ dynamic: true })}` });

            return interaction.editReply({ embeds: [cooldownEmbed], ephemeral: true });
        }

            const selectedLevel = config.PrioritySettings.Levels.find(level => level.priority.toLowerCase() === ticketDB.priority.toLowerCase());

            // Xóa ưu tiên bằng cách đặt lại tên kênh và di chuyển nó xuống dưới cùng
            if(selectedLevel.channelName) await interaction.channel.setName(ticketDB.priorityName);
            const channelsInCategory = interaction.guild.channels.cache.filter(channel => channel.type === 0 && channel.parentId === interaction.channel.parentId).size;
            const newPosition = channelsInCategory + 1;
            if(selectedLevel.moveToTop) await interaction.channel.setPosition(newPosition);

            // Cập nhật mức độ ưu tiên trong cơ sở dữ liệu
            await ticketModel.findOneAndUpdate({ channelID: interaction.channel.id }, { $unset: { priority: 1, priorityCooldown: 1, priorityName: 1 } });

            const successEmbed = new Discord.EmbedBuilder()
                .setColor("Red")
                .setDescription(`Đã xóa quyền ưu tiên khỏi ticket này.`)
                .setTimestamp()

            interaction.editReply({ embeds: [successEmbed], ephemeral: true });
        }
    }
};
