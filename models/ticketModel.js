const mongoose = require('mongoose');

const schema = new mongoose.Schema ({
    guildID: String,
    channelID: String,
    userID: String,
    ticketType: String,
    button: String,
    msgID: String,
    claimed: Boolean,
    claimUser: String,
    messages: Number,
    lastMessageSent: Date,
    status: String,
    closeUserID: String,
    archiveMsgID: String,
    questions: [
        {
            customId: String,
            required: Boolean,
            question: String,
            style: String,
            response: String,
        },
    ],
    ticketCreationDate: Date,
    closedAt: Date,
    identifier: String,
    closeReason: { type: String, default: "Không có lý do nào được cung cấp." },
    closeNotificationTime: Number,
    closeNotificationMsgID: String,
    closeNotificationUserID: String,
    transcriptID: String,
    priority: String,
    priorityName: String,
    waitingReplyFrom: String,
    firstStaffResponse: Date,
    inactivityWarningSent: { type: Boolean, default: false },
    priorityCooldown: Date,
}, {
    timestamps: true,
});

module.exports = mongoose.model('ticket', schema);