const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema({
  recipientId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User", 
    required: true,
    index: true // Faster queries for specific users
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
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Notification", NotificationSchema);