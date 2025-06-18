const { SlashCommandBuilder } = require('@discordjs/builders');
const { ActionRowBuilder, EmbedBuilder, ButtonBuilder } = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml");
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'));
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'));
const ticketModel = require("../../models/ticketModel");

module.exports = {
    enabled: commands.Utility.Crypto.Enabled,
    data: new SlashCommandBuilder()
        .setName('crypto')
        .setDescription('Tạo thông tin thanh toán Crypto')
        .addUserOption(option => option.setName('user').setDescription('Người nhận').setRequired(true))
        .addStringOption(option => option.setName('currency').setDescription('Loại Crypto bạn sẽ thanh toán').addChoices(
            { name: 'BTC', value: 'BTC' },
            { name: 'ETH', value: 'ETH' },
            { name: 'USDT', value: 'USDT' },
            { name: 'LTC', value: 'LTC' },
        ).setRequired(true))
        .addNumberOption(option => option.setName('price').setDescription(`Số tiền tính theo ${config.CryptoSettings.Currency}`).setRequired(true))
        .addStringOption(option => option.setName('service').setDescription('Tên dịch vụ').setRequired(true))
        .addStringOption(option => option.setName('address').setDescription('Địa chỉ ví crypto (nếu có)')),
    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true });
        const ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });

        if (config.CryptoSettings.Enabled === false) return interaction.editReply({ content: "❌ Lệnh này đã bị tắt trong cấu hình!", ephemeral: true });
        if (config.CryptoSettings.OnlyInTicketChannels && !ticketDB) return interaction.editReply({ content: config.Locale.NotInTicketChannel, ephemeral: true });

        let hasRole = false;
        for (let i = 0; i < config.CryptoSettings.AllowedRoles.length; i++) {
            const role = interaction.guild.roles.cache.get(config.CryptoSettings.AllowedRoles[i]);
            if (role && interaction.member.roles.cache.has(role.id)) hasRole = true;
        }
        if (!hasRole) return interaction.editReply({ content: config.Locale.NoPermsMessage, ephemeral: true });

        const user = interaction.options.getUser("user");
        const currency = interaction.options.getString("currency");
        const price = interaction.options.getNumber("price");
        const service = interaction.options.getString("service");
        let address = interaction.options.getString("address") || "";

        // Lấy địa chỉ mặc định từ config nếu không nhập
        if (!address) {
            address = config.CryptoAddresses[currency] || "";
        }
        if (!address) return interaction.editReply({ content: `❌ Không tìm thấy địa chỉ ví cho ${currency} trong config!`, ephemeral: true });

        // Tính quy đổi sang đơn vị chính
        const fromCurrency = currency;
        const toCurrency = config.CryptoSettings.Currency;
        const conversionMethod = client.cryptoConvert[toCurrency][fromCurrency];
        const convertedAmount = conversionMethod(price);

        let cryptoFullName = "";
        if (currency === "BTC") cryptoFullName = "bitcoin";
        if (currency === "ETH") cryptoFullName = "ethereum";
        if (currency === "USDT") cryptoFullName = "tether";
        if (currency === "LTC") cryptoFullName = "litecoin";

        // Tạo QR code + Embed
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setStyle('Link')
                .setURL(`https://quickchart.io/qr?text=${cryptoFullName.toLowerCase()}%3A${address}%3Famount=${price}`)
                .setLabel(config.Locale.cryptoQRCode || "Mã QR Crypto")
        );

        const embedSettings = config.CryptoSettings.Embed;
        const embed = new EmbedBuilder();

        if (embedSettings.Title) embed.setTitle(embedSettings.Title
            .replace('{seller.username}', interaction.user.username)
            .replace('{user.username}', user.username)
            .replace('{currency}', currency.toUpperCase()));
        embed.setColor(embedSettings.Color || config.EmbedColors);
        if (embedSettings.Description) embed.setDescription(embedSettings.Description);

        if (embedSettings.ThumbnailEnabled) {
            embed.setThumbnail(embedSettings.CustomThumbnail || user.displayAvatarURL({ format: 'png', dynamic: true }));
        }

        embed.addFields(embedSettings.Fields.map(field => ({
            name: field.name,
            value: field.value
                .replace('{seller}', `<@!${interaction.user.id}>`)
                .replace('{seller.username}', interaction.user.username)
                .replace('{user}', `<@!${user.id}>`)
                .replace('{user.username}', user.username)
                .replace('{service}', service)
                .replace('{price}', `${convertedAmount} (${price} ${toCurrency})`)
                .replace('{address}', address)
        })));

        if (embedSettings.Timestamp) embed.setTimestamp();

        const footerText = embedSettings.Footer.text.replace('{user.username}', user.username);
        if (footerText.trim() !== '') {
            embed.setFooter({
                text: footerText,
                iconURL: embedSettings.Footer.IconEnabled && embedSettings.Footer.CustomIconURL
                    ? embedSettings.Footer.CustomIconURL
                    : user.displayAvatarURL({ format: 'png', dynamic: true })
            });
        }

        await interaction.editReply({ content: "✅ Tạo thông tin thanh toán crypto thành công!" });
        await interaction.channel.send({ embeds: [embed], components: [row] });

        // Gửi log
        const logsChannel = interaction.guild.channels.cache.get(config.cryptoPayments?.ChannelID || config.TicketSettings.LogsChannelID);
        if (logsChannel && config.cryptoPayments.Enabled) {
            const log = new EmbedBuilder()
                .setColor("Green")
                .setTitle(config.Locale.cryptoLogTitle || "📑 Log Thanh Toán Crypto")
                .addFields([
                    { name: `• ${config.Locale.logsExecutor || "Người tạo"}`, value: `> <@!${interaction.user.id}>\n> ${interaction.user.username}` },
                    { name: `• ${config.Locale.PayPalUser || "Khách hàng"}`, value: `> <@!${user.id}>\n> ${user.username}` },
                    { name: `• ${config.Locale.PayPalPrice || "Số tiền"}`, value: `> ${config.CryptoSettings.CurrencySymbol}${price} (${price} ${currency})` },
                    { name: `• ${config.Locale.PayPalService || "Dịch vụ"}`, value: `> ${service}` },
                ])
                .setTimestamp()
                .setThumbnail(interaction.user.displayAvatarURL({ format: 'png', dynamic: true }))
                .setFooter({ text: interaction.user.username, iconURL: interaction.user.displayAvatarURL({ format: 'png', dynamic: true }) });
            logsChannel.send({ embeds: [log] });
        }

    }
};
