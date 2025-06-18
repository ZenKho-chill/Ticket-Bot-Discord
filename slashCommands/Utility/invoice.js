const { SlashCommandBuilder } = require('@discordjs/builders');
const { ActionRowBuilder, ButtonBuilder, EmbedBuilder } = require("discord.js");
const Discord = require ("discord.js");
const fs = require('fs');
const yaml = require("js-yaml");
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'));
const commands = yaml.load(fs.readFileSync('./commands.yml', 'utf8'));
const utils = require("../../utils.js");
const paypalModel = require("../../models/paypalInvoicesModel");
const stripeModel = require("../../models/stripeInvoicesModel");
const ticketModel = require("../../models/ticketModel");

module.exports = {
    enabled: commands.Utility.Invoice.Enabled,
    data: new SlashCommandBuilder()
        .setName('invoice')
        .setDescription('Tạo hoá đơn thanh toán cho khách hàng')
        .addSubcommand(subcommand =>
            subcommand
                .setName('paypal')
                .setDescription('Tạo hoá đơn PayPal')
                .addUserOption(option => option.setName('user').setDescription('Người nhận').setRequired(true))
                .addNumberOption(option => option.setName('price').setDescription('Số tiền').setRequired(true))
                .addStringOption(option => option.setName('service').setDescription('Tên dịch vụ').setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('stripe')
                .setDescription('Tạo hoá đơn Stripe')
                .addUserOption(option => option.setName('user').setDescription('Người nhận').setRequired(true))
                .addStringOption(option => option.setName('email').setDescription('Email khách hàng').setRequired(true))
                .addNumberOption(option => option.setName('price').setDescription('Số tiền').setRequired(true))
                .addStringOption(option => option.setName('service').setDescription('Tên dịch vụ').setRequired(true))),
    async execute(interaction, client) {

        const ticketDB = await ticketModel.findOne({ channelID: interaction.channel.id });

        const subCmd = interaction.options.getSubcommand();
        const user = interaction.options.getUser("user");
        const price = interaction.options.getNumber("price");
        const service = interaction.options.getString("service");
        const customerEmail = interaction.options.getString("email");

        // ===========================================
        // === TẠO HOÁ ĐƠN PAYPAL ===
        // ===========================================
        if(subCmd === "paypal") {

            if(config.PayPalSettings.Enabled === false) 
                return interaction.reply({ content: "❌ Lệnh này đã bị tắt trong cài đặt!", ephemeral: true });

            if(config.PayPalSettings.OnlyInTicketChannels && !ticketDB) 
                return interaction.reply({ content: config.Locale.NotInTicketChannel, ephemeral: true });

            let doesUserHaveRole = false;
            for(let i = 0; i < config.PayPalSettings.AllowedRoles.length; i++) {
                const role = interaction.guild.roles.cache.get(config.PayPalSettings.AllowedRoles[i]);
                if(role && interaction.member.roles.cache.has(role.id)) doesUserHaveRole = true;
            }
            if(!doesUserHaveRole) return interaction.reply({ content: config.Locale.NoPermsMessage, ephemeral: true });

            await interaction.deferReply();

            const logoURL = config.PayPalSettings.Logo || interaction.guild.iconURL();

            const invoiceObject = {
                "merchant_info": {
                    "email": config.PayPalSettings.Email,
                    "business_name": interaction.guild.name,
                },
                "items": [{
                    "name": service,
                    "quantity": 1.0,
                    "unit_price": {
                        "currency": config.PayPalSettings.Currency,
                        "value": price
                    },
                }],
                "logo_url": logoURL,
                "note": config.PayPalSettings.Description,
                "payment_term": { "term_type": "NET_45" },
                "tax_inclusive": false,
                "shipping_info": {}
            };

            client.paypal.invoice.create(invoiceObject, async (err, invoice) => {
                if (err) {
                    console.error('[LỖI] PayPal:', err);
                    return;
                }

                client.paypal.invoice.send(invoice.id, async (error) => {
                    if (error) {
                        console.log(error);
                        return;
                    }

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setStyle('Link')
                            .setURL(`https://www.paypal.com/invoice/payerView/details/${invoice.id}`)
                            .setLabel("💳 Thanh toán hoá đơn"),
                        new ButtonBuilder()
                            .setCustomId(`${invoice.id}-unpaid`)
                            .setStyle('Danger')
                            .setLabel("❌ Chưa thanh toán")
                            .setDisabled(true)
                    );

                    const embed = new EmbedBuilder()
                        .setTitle(`Hoá đơn PayPal - ${service}`)
                        .setColor(config.EmbedColors)
                        .setDescription(`💼 **Người bán:** <@${interaction.user.id}>\n👤 **Khách hàng:** <@${user.id}>\n💰 **Số tiền:** ${config.PayPalSettings.CurrencySymbol}${price} (${config.PayPalSettings.Currency})\n📝 **Dịch vụ:** ${service}`)
                        .setThumbnail(user.displayAvatarURL({ format: 'png', dynamic: true }))
                        .setTimestamp()
                        .setFooter({ text: `Người tạo: ${interaction.user.username}` });

                    const msg = await interaction.editReply({ embeds: [embed], components: [row] });

                    const newModel = new paypalModel({
                        invoiceID: invoice.id,
                        userID: user.id,
                        sellerID: interaction.user.id,
                        channelID: interaction.channel.id,
                        messageID: msg.id,
                        price: price,
                        service: service,
                        status: invoice.status,
                    });
                    await newModel.save();

                    const logsChannel = interaction.guild.channels.cache.get(config.paypalInvoice?.ChannelID || config.TicketSettings.LogsChannelID);
                    if (logsChannel && config.paypalInvoice.Enabled) {
                        const log = new EmbedBuilder()
                            .setColor("Green")
                            .setTitle("📑 Log Hoá đơn PayPal")
                            .addFields([
                                { name: "• Người tạo", value: `<@${interaction.user.id}> (${interaction.user.username})` },
                                { name: "• Khách hàng", value: `<@${user.id}> (${user.username})` },
                                { name: "• Số tiền", value: `${config.PayPalSettings.CurrencySymbol}${price}` },
                                { name: "• Dịch vụ", value: `${service}` },
                            ])
                            .setTimestamp()
                            .setThumbnail(interaction.user.displayAvatarURL({ format: 'png', dynamic: true }))
                            .setFooter({ text: `${interaction.user.username}` });
                        logsChannel.send({ embeds: [log] });
                    }

                    let checkInvoice = setInterval(async () => {
                        await utils.checkPayPalPayments();
                        const invoiceDB = await paypalModel.findOne({ invoiceID: invoice.id });
                        if (invoiceDB?.status === "paid" || invoiceDB?.status === "deleted") {
                            clearInterval(checkInvoice);
                            await paypalModel.findOneAndDelete({ invoiceID: invoice.id });
                        }
                    }, 20000);
                });
            });

        }

        // ===========================================
        // === TẠO HOÁ ĐƠN STRIPE ===
        // ===========================================
        else if (subCmd === "stripe") {

            if(config.StripeSettings.Enabled === false) 
                return interaction.reply({ content: "❌ Lệnh này đã bị tắt trong cài đặt!", ephemeral: true });

            if(config.StripeSettings.OnlyInTicketChannels && !ticketDB) 
                return interaction.reply({ content: config.Locale.NotInTicketChannel, ephemeral: true });

            let doesUserHaveRole = false;
            for(let i = 0; i < config.StripeSettings.AllowedRoles.length; i++) {
                const role = interaction.guild.roles.cache.get(config.StripeSettings.AllowedRoles[i]);
                if(role && interaction.member.roles.cache.has(role.id)) doesUserHaveRole = true;
            }
            if(!doesUserHaveRole) return interaction.reply({ content: config.Locale.NoPermsMessage, ephemeral: true });

            const fixpriced = price * 100;

            await interaction.deferReply();

            client.stripe.customers.create({
                email: customerEmail,
                name: user.username,
                description: `ID người dùng: ${user.id}`
            }).then((customer) => {
                return client.stripe.invoiceItems.create({
                    customer: customer.id,
                    amount: fixpriced,
                    currency: config.StripeSettings.Currency,
                    description: service,
                }).then((invoiceItem) => {
                    return client.stripe.invoices.create({
                        collection_method: 'send_invoice',
                        days_until_due: 30,
                        customer: invoiceItem.customer,
                        payment_settings: {
                            payment_method_types: config.StripeSettings.PaymentMethods,
                        },
                    });
                }).then(async (invoice) => {
                    await client.stripe.invoices.sendInvoice(invoice.id);
                    const invoice2 = await client.stripe.invoices.retrieve(invoice.id);

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setStyle('Link')
                            .setURL(`${invoice2.hosted_invoice_url}`)
                            .setLabel("💳 Thanh toán hoá đơn"),
                        new ButtonBuilder()
                            .setCustomId(`${invoice.id}-unpaid`)
                            .setStyle('Danger')
                            .setLabel("❌ Chưa thanh toán")
                            .setDisabled(true)
                    );

                    const embed = new EmbedBuilder()
                        .setTitle(`Hoá đơn Stripe - ${service}`)
                        .setColor(config.EmbedColors)
                        .setDescription(`💼 **Người bán:** <@${interaction.user.id}>\n👤 **Khách hàng:** <@${user.id}>\n💰 **Số tiền:** ${config.StripeSettings.CurrencySymbol}${price} (${config.StripeSettings.Currency})\n📝 **Dịch vụ:** ${service}`)
                        .setThumbnail(user.displayAvatarURL({ format: 'png', dynamic: true }))
                        .setTimestamp()
                        .setFooter({ text: `Người tạo: ${interaction.user.username}` });

                    const msg = await interaction.editReply({ embeds: [embed], components: [row] });

                    const newModel = new stripeModel({
                        invoiceID: invoice2.id,
                        userID: user.id,
                        sellerID: interaction.user.id,
                        channelID: interaction.channel.id,
                        messageID: msg.id,
                        customerID: invoice2.customer,
                        price: price,
                        service: service,
                        status: invoice2.status,
                    });
                    await newModel.save();

                    const logsChannel = interaction.guild.channels.cache.get(config.stripeInvoice?.ChannelID || config.TicketSettings.LogsChannelID);
                    if (logsChannel && config.stripeInvoice.Enabled) {
                        const log = new EmbedBuilder()
                            .setColor("Green")
                            .setTitle("📑 Log Hoá đơn Stripe")
                            .addFields([
                                { name: "• Người tạo", value: `<@${interaction.user.id}> (${interaction.user.username})` },
                                { name: "• Khách hàng", value: `<@${user.id}> (${user.username})` },
                                { name: "• Số tiền", value: `${config.StripeSettings.CurrencySymbol}${price}` },
                                { name: "• Dịch vụ", value: `${service}` },
                            ])
                            .setTimestamp()
                            .setThumbnail(interaction.user.displayAvatarURL({ format: 'png', dynamic: true }))
                            .setFooter({ text: `${interaction.user.username}` });
                        logsChannel.send({ embeds: [log] });
                    }

                    let checkInvoice = setInterval(async () => {
                        await utils.checkStripePayments();
                        const invoiceDB = await stripeModel.findOne({ invoiceID: invoice2.id });
                        if (invoiceDB?.status === "paid" || invoiceDB?.status === "deleted") {
                            clearInterval(checkInvoice);
                            await stripeModel.findOneAndDelete({ invoiceID: invoice2.id });
                        }
                    }, 20000);

                }).catch(console.error);
            });

        }

    }
};
