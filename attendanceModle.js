const mongoose = require('mongoose');

const AttendanceSchema = new mongoose.Schema({
  labourId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  vendorId: String,
  date: { type: String }, 
  dailyWage: Number,
  otPay: Number,
  totalPay: Number
});

// Identifier conflict varaama irukka check panni export pannuvom
module.exports = mongoose.models.Attendance || mongoose.model("Attendance", AttendanceSchema);
