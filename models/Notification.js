const mongoose = require("mongoose");

const NotificationRecipientSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    isRead: {
      type: Boolean,
      default: false
    }
  },
  {
    _id: false
  }
);

const NotificationSchema = new mongoose.Schema({
  recipients: {
    type: [NotificationRecipientSchema],
    default: []
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  senderName: { type: String, default: "" },
  senderPic: { type: String, default: "" },
  type: { 
    type: String, 
    enum: ["project_assigned", "material_shipped", "feed_like", "task_media_upload", "task_comment", "task_like"], 
    required: true 
  },
  title: { type: String, required: true },
  message: { type: String, required: true },
  projectId: { type: String, default: "" }, // Routing match purposes
  viewName: { type: String, default: "" },  // inside taskMedia images tracking
  createdAt: { type: Date, default: Date.now, index: true }
});

NotificationSchema.index({
  "recipients.userId": 1,
  createdAt: -1
});

module.exports = mongoose.model("Notification", NotificationSchema);