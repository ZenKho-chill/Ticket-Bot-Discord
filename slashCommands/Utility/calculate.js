const { SlashCommandBuilder } = require('@discordjs/builders');
const Discord = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml");
const axios = require("axios");
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'));
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'));

module.exports = {
    enabled: commands.Utility.Calculate.Enabled,
    data: new SlashCommandBuilder()
        .setName('calculate')
        .setDescription('Tính toán biểu thức toán học')
        .addStringOption(option => option.setName('question').setDescription('Nhập phép tính cần giải').setRequired(true)),
    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const question = interaction.options.getString("question");
            const question2 = question.replace(/x/gi, "*");
            const encodedInput = encodeURIComponent(question2);

            const response = await axios.get(`http://api.mathjs.org/v4/?expr=${encodedInput}`);
            const result = response.data;

            const embed = new Discord.EmbedBuilder()
                .setColor(config.EmbedColors)
                .setTitle('📐 Kết quả tính toán')
                .addFields([
                    { name: '➤ Biểu thức', value: `\`\`\`css\n${question}\`\`\`` },
                    { name: '➤ Kết quả', value: `\`\`\`css\n${result}\`\`\`` },
                ])
                .setFooter({
                    text: `Yêu cầu bởi: ${interaction.user.username}`,
                    iconURL: interaction.user.displayAvatarURL({ format: 'png', dynamic: true, size: 1024 })
                })
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('❌ Lỗi khi tính toán:', error);
            await interaction.editReply({ content: '⚠️ Đã xảy ra lỗi khi tính toán. Vui lòng thử lại sau!', ephemeral: true });
        }
    }
};
