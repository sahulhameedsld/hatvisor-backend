const mongoose = require("mongoose");
const GroupSchema = new mongoose.Schema({
    groupName:{
        type:String,
        required:true
    },
    groupImage:{
        type:String,
        default:""
    },
    vendorId:{
        type:mongoose.Schema.Types.ObjectId,
        ref:"User"
    },
    members:[{
        userId:{
            type:mongoose.Schema.Types.ObjectId,
            ref:"User"
        }
    }]
},{timestamps:true});
module.exports = mongoose.model("Group", GroupSchema);