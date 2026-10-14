const mongoose = require("mongoose");

const OrphanCacheSchema = new mongoose.Schema({
  s3Key: {
    type: String,
    required: true,
    unique: true
  },
  orphanedAt: {
    type: Date,
    required: true,
    default: Date.now
  }
});

module.exports = mongoose.model(
  "OrphanCache",
  OrphanCacheSchema
);
