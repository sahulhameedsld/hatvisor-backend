const mongoose = require("mongoose");

const SavedCacheSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // Save panna user
  projectId: { type: String, required: true }, // Primary Project identifier pointer
  projectName: String,
  companyInfo: {
    _id: String,
    name: String,
    logo: String,
    phone: String
  },
  propertyDetails: {
    location: Object,
    about: String
  },
  // Dynamic snapshot mapping array that stays safe forever until un-saved!
  taskMedia: {
    frontView: { url: String },
    backView: { url: String },
    leftView: { url: String },
    rightView: { url: String },
    ceilingView: { url: String },
    floorView: { url: String }
  },
  savedAt: { type: Date, default: Date.now }
});

// Compound unique index so a user cannot duplicate save the same project snapshot
SavedCacheSchema.index({ userId: 1, projectId: 1 }, { unique: true });

module.exports = mongoose.model("SavedCache", SavedCacheSchema);