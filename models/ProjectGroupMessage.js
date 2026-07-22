const mongoose = require("mongoose");

const ProjectGroupMessageSchema = new mongoose.Schema({
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Project",
        required: true
    },
    senderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    message: {
        type: String,
        default: ""
    },
    attachments: {
        filename: { type: String, default: "" },
        attachmentSetPath: { type: String, default: "uploads/temp" }
    },
    syncStatus: [{
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        status: { type: Boolean, default: false }
    }],
    replyTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ProjectGroupMessage",
        default: null
    },
    isEdited: {
        type: Boolean,
        default: false
    },
    deleted: {
        type: Boolean,
        default: false
    },
    seenBy: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    }]
}, { timestamps: true });

module.exports = mongoose.model("ProjectGroupMessage", ProjectGroupMessageSchema);