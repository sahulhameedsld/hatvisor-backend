const mongoose = require("mongoose");
const ProjectGroupSchema = new mongoose.Schema({
    groupName: {
        type: String,
        required: true,
        default: "Project Group"
    },
    groupImage: {
        type: String,
        default: ""
    },
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Project",
        required: true
    },
    members: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
        }
    }]
}, { timestamps: true });
module.exports = mongoose.model("ProjectGroup", ProjectGroupSchema);