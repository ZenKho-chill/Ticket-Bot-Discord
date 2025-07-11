const { SlashCommandBuilder } = require('@discordjs/builders');
const Discord = require ("discord.js")
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'))
const ticketModel = require("../../models/ticketModel");
const utils = require("../../utils.js");

module.exports = {
    enabled: commands.Ticket.Remove.Enabled,
    data: new SlashCommandBuilder()
        .setName('remove')
        .setDescription(commands.Ticket.Remove.Description)
        .addUserOption((option) => option.setName('user').setDescription('User').setRequired(true)),
    async execute(interaction, client) {
        const ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });
        if(!ticketDB) return interaction.reply({ content: config.Locale.NotInTicketChannel, ephemeral: true })

        let supportRole = await utils.checkIfUserHasSupportRoles(interaction)
        if(commands.Ticket.Remove.AllowEveryoneToUse === false && !supportRole) return interaction.reply({ content: config.Locale.NoPermsMessage, ephemeral: true })

        await interaction.deferReply({ ephemeral: true });

        let user = interaction.options.getUser("user");

        interaction.channel.permissionOverwrites.create(user, {
            SendMessages: false,
            ViewChannel: false,
            ReadMessageHistory: false
        });
        
        let logsChannel; 
        if(!config.userRemove.ChannelID) logsChannel = interaction.guild.channels.cache.get(config.TicketSettings.LogsChannelID);
        if(config.userRemove.ChannelID) logsChannel = interaction.guild.channels.cache.get(config.userRemove.ChannelID);
    
        const log = new Discord.EmbedBuilder()
        .setColor("Red")
        .setTitle(config.Locale.userRemoveTitle)
        .addFields([
            { name: `• ${config.Locale.logsExecutor}`, value: `> <@!${interaction.user.id}>\n> ${interaction.user.username}` },
            { name: `• ${config.Locale.logsUser}`, value: `> <@!${user.id}>\n> ${user.username}` },
            { name: `• ${config.Locale.logsTicket}`, value: `> <#${interaction.channel.id}>\n> #${interaction.channel.name}` },
          ])
        .setTimestamp()
        .setThumbnail(interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 }))
        .setFooter({ text: `${interaction.user.username}`, iconURL: `${interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })}` })

        let removeLocale = config.Locale.ticketUserRemove.replace(/{user}/g, `<@!${user.id}>`).replace(/{username}/g, `${user.username}`);
        const embed = new Discord.EmbedBuilder()
        .setColor("Red")
        .setDescription(removeLocale)
    
        interaction.editReply({ embeds: [embed] }) // %%__USER__%%
        if (logsChannel && config.userRemove.Enabled) logsChannel.send({ embeds: [log] })

    }

}