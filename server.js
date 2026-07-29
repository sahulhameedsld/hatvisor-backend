const express = require("express");
const mongoose = require("mongoose");
require("dotenv").config();
const router = express.Router();
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const multer = require("multer");
const cors = require("cors");
const Attendance = require('./attendanceModle');
const SavedCache = require("./models/SavedCache");
const Notification = require("./models/Notification");
const Group = require("./models/Group");
const GroupMessage = require("./models/GroupMessage");
const ProjectGroup = require("./models/ProjectGroup");
const ProjectGroupMessage = require("./models/ProjectGroupMessage");
const Razorpay = require("razorpay");

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

const fs = require("fs");
const path = require("path");
const cron = require('node-cron');

const app = express();
app.use(cors());
app.use(express.json());

const cacheDir = path.join(__dirname, "uploads", "cache");
if (!fs.existsSync(cacheDir)){
    fs.mkdirSync(cacheDir, { recursive: true });
}
const tempDir = path.join(__dirname, "uploads", "temp");
if (!fs.existsSync(tempDir)){
    fs.mkdirSync(tempDir, { recursive: true });
}
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/uploads/cache", express.static(path.join(__dirname, "uploads/cache")));
app.use("/uploads/temp", express.static(path.join(__dirname, "uploads/temp")));

/* ================= VERIFY PHONE & GENERATE OTP & SEND MAIL TO VENDOR ================= */

const transporter = nodemailer.createTransport({
    host: "asi.acousticalsurfaces.in",
    port: 465,
    secure: true,
    auth: {
        user: "seo@asi.acousticalsurfaces.in",
        pass: "Welcome@321"
    },
    tls: {
      rejectUnauthorized: false
    }
});
transporter.verify(function (error, success) {
  if (error) {
    console.log("❌ SMTP Connection Error Details:", error);
  } else {
    console.log("✅ SMTP Server is ready to deliver secure messages!");
  }
});

/* ================= HELPER TO SAFELY DELETE FILE ================= */

const deletePhysicalFile = (fileName) => {
  const tempPath = path.join(__dirname, 'uploads/temp', fileName);
  if (fs.existsSync(tempPath)) {
    fs.unlink(tempPath, (err) => {
      if (err) console.error("Error deleting temp file:", err);
      else console.log(`Successfully deleted ${fileName} from temp space permanently!`);
    });
  }
};

/* ================= 24-HOUR STALE ASSETS FORCE CLEANUP ================= */

cron.schedule('0 * * * *', () => {
  console.log("Running hourly temp cleanup verification scheduler...");
  const tempDir = path.join(__dirname, 'uploads/temp');
  fs.readdir(tempDir, (err, files) => {
    if (err) {
      console.error("Failed to read temp directory:", err);
      return;
    }
    const now = Date.now();
    const expiryDuration = 24 * 60 * 60 * 1000;
    files.forEach((file) => {
      const filePath = path.join(tempDir, file);
      fs.stat(filePath, (statErr, stats) => {
        if (statErr) return;
        const fileAge = now - new Date(stats.mtime).getTime();
        if (fileAge > expiryDuration) {
          fs.unlink(filePath, (unlinkErr) => {
            if (unlinkErr) console.error(`Hourly cron run: could not delete ${file}`, unlinkErr);
            else console.log(`Hourly cron cleanups: 24h Expired file removed - ${file}`);
          });
        }
      });
    });
  });
});

/* ================= 🔔 CENTRAL NOTIFICATION HELPER ENGINE ================= */

async function triggerNotification({ recipientId, senderId, senderName, senderPic, type, title, message, projectId = "", viewName = "" }) {
  try {
    // Unga core requirement padi exact target user-ku mattum dynamic notification create aagum
    const newNotif = new Notification({
      recipientId,
      senderId,
      senderName,
      senderPic,
      type,
      title,
      message,
      projectId,
      viewName
    });
    await newNotif.save();
    console.log(`🔔 Notification Created Successfully in DB for User: ${recipientId} - Action Type: ${type}`);
  } catch (err) {
    console.error("❌ Notification Engine Insertion Failure:", err);
  }
}

/* ================= TIME FRAME ================= */

setInterval(async () => {
  try {
    const expiryThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const expiredUsers = await User.find({
      "projectData.isPublic": true,
      "projectData.postedAt": { $lt: expiryThreshold }
    });
    for (let user of expiredUsers) {
      let modified = false;
      user.projectData.forEach(project => {
        if (project.isPublic && project.postedAt && project.postedAt < expiryThreshold) {
          project.isPublic = false;
          project.postedAt = null;
          modified = true;
        }
      });
      if (modified) {
        user.markModified("projectData");
        await user.save();
        console.log(`[ENGINE] Auto-Expired custom post elements for account: ${user._id}`);
      }
    }
  } catch (cronErr) {
    console.error("Cleanup engine execution exception error loop:", cronErr);
  }
}, 30 * 60 * 1000);

/* ================= MULTER ================= */

const storage = multer.diskStorage({
  destination: (req,file,cb)=>{
    let uploadPath = 'uploads/';
    if (file.fieldname === 'attachment') {
      uploadPath = 'uploads/temp/';
    } else if (file.fieldname === 'logo') {
      uploadPath = 'uploads/logos/';
    } else if (file.fieldname === 'product') {
      uploadPath = 'uploads/products/';
    }
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req,file,cb)=>{
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

/* ================= UPLOAD STORAGE ================= */

const upload = multer({ storage: storage });

/* ================= ROUTE ================= */

app.post("/upload", upload.single("task"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ msg: "No file uploaded" });
    }
    // Success: Return the filename
    res.json({ imageUrl: req.file.filename }); 
  } catch (err) {
    console.error("Upload Error:", err);
    res.status(500).json({ msg: "Upload failed" });
  }
});

/* ================= STATIC ================= */

app.use("/uploads", express.static("uploads"));

/* ================= MONGODB ================= */

mongoose.connect("mongodb+srv://hatvisor:SLD%40cse311@hatvisor.xpvbtkl.mongodb.net/Hatvisor?retryWrites=true&w=majority")
.then(()=>console.log("MongoDB Connected"))
.catch(err=>console.log(err));

/* ================= SCHEMA ================= */

const UserSchema = new mongoose.Schema({

  name:String,

  phone:{
    type:String,
    required:true,
    unique:true
  },

  email: String,
  password:String,
  role:String,

  profilePic:String,
  idProof: String,

  location:{
    lat:Number,
    lng:Number,
    city:String
  },

  resetOTP: { 
    type: String, 
    default: null 
  },

  resetOTPExpires: { 
    type: Date, 
    default: null 
  },

  /* COMPANY */
  companyLogo:{ type: String, default: "" },
  companyName:{ type: String, default: "" },
  companyCover:{ type: String, default: "" },
  aboutCompany:{ type: String, default: "" },

  companyLocation:{
    lat:Number,
    lng:Number,
    city:String
  },
  category:String,
  tag:String,
  companyPhone:String,

  /* PRODUCTS SAFE */
  products: {
    type: [
      {
        name: String,
        price: String,
        type: { type: [String], default: [] },
        image: String
      }
    ],
    default: []
  },
  address: String,

  /* GROUP CHAT */
  attachmentPermission: {
    type: Boolean,
    default: undefined
  },
  folderCreated: [{
    attachmentId: { type: mongoose.Schema.Types.ObjectId, ref: "GroupMessage" },
    attachmentStatus: { type: Boolean, default: false },
    attachmentSetPath: { type: String, default: "uploads/temp" },
    attachmentGetPath: { type: String, default: "" } // Custom storage path configuration mapping
  }],

  /* LABOUR */
  jobRole: { type: String, default: "" },

  createdBy: String,
  usedBy: String,

  isActiveForVendor: {
    type: Boolean,
    default: true
  },

  assignType: { 
    type: String, 
    default: "" 
  },
  
  paymentType: { 
    type: String, 
    default: "Day" 
  },
  amount: String,

  attendanceStatus: {
    type: String,
    default: "OUT"
  },
  isActiveForVendor: {
    type: Boolean,
    default: true
  },
  startTime:String,
  endTime:String,
  outTime:Date,

  overtime: {
    type: Boolean,
    default: false
  },
  otStart:Date,
  otEnd:Date,

  actualInTime: { type: String, default: "" },
  actualOutTime: { type: String, default: "" },
  otStartTime: { type: String, default: "--:--" },
  otEndTime: { type: String, default: "--:--" },
  overtimeAmount: { type: String, default: "0" },

  lastUpdateDate: { type: String, default: "" },

  /* EMPLOYEE */
  designation: String,
  subRole: String, // Super Admin, Admin etc.
  email: { type: String, lowercase: true },

  /* EMPLOYEE Fields in UserSchema */
  sickLeaves: {
    type: [Object],
    default: [] 
  },

  casualLeaves: {
    type: [Object],
    default: []
  },

  weekOff: [String],

  generalLeaves: [
    {
      startDate: { type: Date },
      endDate: { type: Date },
      type: { type: String },
      reason: { type: String }
    }
  ],

  /* ENTERPRISE - RATTING */
  rating: { type: Number, default: 0 },

  /* ENTERPRISE - PRODUCTION LOGIC */
  productionData: [
    {
      productName: String,
      qty: String,
      description: String,
      images: {
        type: [String],
        default: ["", ""]
      },
      likedBy: [{ 
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, 
        subRole: String 
      }],
      comments: [{ 
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, 
        subRole: String, 
        text: String, 
        userName: String, 
        userPic: String,
        createdAt: { type: Date, default: Date.now }
      }],
      createdAt: {
        type: Date,
        default: Date.now
      }
    }
  ],

  /* ENTERPRISE - MATERIALS & PROJECTS */
  materialData: [{
    productName: String,
    qty: Number,
    description: String,
    images: { type: [String], default: ["", ""] }, 
    createdAt: { type: Date, default: Date.now }
  }],

  likedProjects: [
    {
      projectId: { type: mongoose.Schema.Types.ObjectId },
      liked: { type: Boolean, default: false },
      updatedAt: { type: Date, default: Date.now }
    }
  ],

  /* PROJECT */
  projectData: [
    {
      projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
      projectName: String,
      cover: String,
      status: {
        type: String,
        enum: ["onprogress", "completed"],
        default: "onprogress"
      },
      inProject: {
        type: Boolean,
        default: true
      },
      materialStock: [
        {
          materialId: { type: mongoose.Schema.Types.ObjectId },
          materialName: String,
          qty: Number,
          images: [String],
          suppliedDate: { type: Date, default: Date.now },
          reOrder: { type: Boolean, default: false },
          note: { type: String, default: "" },
          driverDetails: {
            name: { type: String, default: "" },
            phone: { type: String, default: "" },
            dp: { type: String, default: "" },
            location: { type: String, default: "Tracking off" }
          }
        }
      ],
      projectLabour: [
        {
          labourId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
          inLabour: { type: Boolean, default: false },
          pActualInTime: String,
          pActualOutTime: String,
          potStartTime: String,
          potEndTime: String,
          assignedAt: { type: Date, default: Date.now }
        }
      ],
      propertyOwners: Array,
      propertyDetails: {
        location: Object,
        about: String
      },
      supportSources: Array,
        
      taskMedia: {
        frontView: { 
          url: { type: String, default: "" }, 
          fileType: { type: String, default: "image" },
          likedBy: [{ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } }],
          comments: [{ 
            userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, 
            text: String, userName: String, userPic: String,
            createdAt: { type: Date, default: Date.now }
          }]
        },
        backView: { 
          url: { type: String, default: "" }, 
          fileType: { type: String, default: "image" },
          likedBy: [{ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } }],
          comments: [{ 
            userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, 
            text: String, userName: String, userPic: String,
            createdAt: { type: Date, default: Date.now }
          }]
        },
        leftView: { 
          url: { type: String, default: "" }, 
          fileType: { type: String, default: "image" },
          likedBy: [{ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } }],
          comments: [{ 
            userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, 
            text: String, userName: String, userPic: String,
            createdAt: { type: Date, default: Date.now }
          }]
        },
        rightView: { 
          url: { type: String, default: "" }, 
          fileType: { type: String, default: "image" },
          likedBy: [{ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } }],
          comments: [{ 
            userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, 
            text: String, userName: String, userPic: String,
            createdAt: { type: Date, default: Date.now }
          }]
        },
        ceilingView: { 
          url: { type: String, default: "" }, 
          fileType: { type: String, default: "image" },
          likedBy: [{ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } }],
          comments: [{ 
            userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, 
            text: String, userName: String, userPic: String,
            createdAt: { type: Date, default: Date.now }
          }]
        },
        floorView: { 
          url: { type: String, default: "" }, 
          fileType: { type: String, default: "image" },
          likedBy: [{ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' } }],
          comments: [{ 
            userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, 
            text: String, userName: String, userPic: String,
            createdAt: { type: Date, default: Date.now }
          }]
        }
      },
      likedByFeed: [
        {
          userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
          userName: String,
          likedAt: { type: Date, default: Date.now }
        }
      ],
      likeCount: { type: Number, default: 0 },
      isPublic: { type: Boolean, default: false },
      feedDescription: { type: String, default: "" },
      postedAt: { type: Date, default: null },
      createdAt: { type: Date, default: Date.now }
    }
  ],

  /* INVENTORY */
  supplyData: [{
    materialId: { type: mongoose.Schema.Types.ObjectId },
    materialName: String,
    qty: Number,
    images: [String],
    toDetails: {
      id: mongoose.Schema.Types.ObjectId,
      companyName: String,
      location: String
    },
    suppliedDate: { type: Date, default: Date.now },
    dispatchStatus: { type: String, default: "shipped" },
    driverDetails: {
      _id: { type: mongoose.Schema.Types.ObjectId },
      name: { type: String, default: "" },
      phone: { type: String, default: "" },
      dp: { type: String, default: "" },
      location: { type: String, default: "Tracking off" }
    }
  }],

  importData: [{
    materialName: String,
    qty: Number,
    images: [String],
    fromDetails: {
      id: mongoose.Schema.Types.ObjectId,
      companyName: String,
      location: String
    },
    importDate: { type: Date, default: Date.now },
    dispatchStatus: { type: String, default: "shipped" },
    driverDetails: {
      _id: { type: mongoose.Schema.Types.ObjectId },
      name: { type: String, default: "" },
      phone: { type: String, default: "" },
      dp: { type: String, default: "" },
      location: { type: String, default: "Tracking off" }
    } 
  }],

  rating: { type: Number, default: 0 },
  ratedBy: [
    {
      vendorId:{
          type:mongoose.Schema.Types.ObjectId,
          ref:"User"
      },
      companyName:String,
      companyLogo:String,
      companyLocation:String,
      rating:Number,
      ratedAt:{
          type:Date,
          default:Date.now
      }
    }
  ],
 
  createdAt: { type: Date, default: Date.now },

  /* SUBSCRIPTION */
  subscription:{
    plan:{
      type:String,
      default:"trial"
    },
    payment:{
      type:Boolean,
      default:false
    },
    trialStart:{
      type:Date,
      default:Date.now
    },
    trialEnd:{
      type:Date,
      default:function(){
          return new Date(Date.now()+14*24*60*60*1000);
      }
    },
    subscriptionStart:{
      type:Date,
      default:null
    },
    subscriptionEnd:{
      type:Date,
      default:null
    },
    paymentId:{
      type:String,
      default:""
    },
    orderId:{
      type:String,
      default:""
    }
  },

  /* DASHBOARD SETTINGS */
  dashboardSettings: {
    headerBackground: {
      type: String,
      default: "linear-gradient(180deg, #2D435C 0%, #1E3148 50%, #0F1B2D 100%)"
    },
    headerFontColor: {
      type: String,
      default: "#FFFFFF"
    },
    modules: {
      employees: {
        type: Boolean,
        default: true
      },
      production: {
        type: Boolean,
        default: true
      }
    }
  }
});


const User = mongoose.model("User", UserSchema);

/* ================= MSG SCHEMA ================= */

const MessageSchema = new mongoose.Schema({
  senderId: String,
  receiverId: String,
  text: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Message = mongoose.model("Message", MessageSchema);

/* ================= SIGNUP ================= */

app.post("/signup", async(req,res)=>{
  try{
    const phone = req.body.phone.trim();
    const exist = await User.findOne({ phone });
    if(exist){
      return res.status(400).json({ message:"Phone exists" });
    }
    const user = new User({ ...req.body, phone });
    await user.save();
    res.json({ message:"Signup success", user });
  }catch(err){
    console.log(err);
    res.status(500).json({ message:"Error" });
  }
});

/* ================= LOGIN ================= */

app.post("/login", async(req,res)=>{
  try{
    const { phone, password } = req.body;
    const user = await User.findOne({ phone });
    if(user && user.password === password){
      res.json({ message:"Login success", user });
    }else{
      res.status(401).json({ message:"Invalid login" });
    }
  }catch(err){
    console.log(err);
    res.status(500).json({ message:"Error" });
  }
});

/* ================= UPDATE USER ================= */

app.put("/updateUser/:id", async(req,res)=>{
  try{
    const { role } = req.body;
    let updateQuery = { $set: req.body };
    if (role) {
      updateQuery = {
        $set: { 
          role: role,
          assignType: "",
          attendanceStatus: "OUT",
          overtime: false,
          actualInTime: "--:--",
          actualOutTime: "--:--",
          otStartTime: "--:--",
          otEndTime: "--:--",
          currentProjectName: ""
        },
        $unset: { 
          usedBy: ""
        }
      };
    }
    const user = await User.findByIdAndUpdate(
      req.params.id,
      updateQuery,
      { returnDocument: 'after' }
    );
    if (!user) {
      return res.status(404).json({ message: "User profile not found buddy" });
    }
    res.json(user);
  }catch(err){
    console.log(err);
    res.status(500).json({ message:"Update failed" });
  }
});

/* ================= PROFILE DP ================= */

app.post("/uploadDP/:id", upload.single("dp"), async(req,res)=>{
  try{
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { profilePic:req.file.filename },
      { returnDocument: 'after' }
    );
    res.json(user);
  }catch(err){
    console.log(err);
    res.status(500).json({ message:"Upload failed" });
  }
});

/* ================= COMPANY COVER UPLOAD ================= */

app.post("/uploadCompanyCover/:id", upload.single("cover"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded buddy!" });
    }
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { companyCover: req.file.filename },
      { returnDocument: 'after' }
    );
    res.json(user);
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Cover image upload failed" });
  }
});

/* ================= COMPANY LOGO ================= */

app.post("/uploadCompanyLogo/:id", upload.single("logo"), async(req,res)=>{
  try{
    if(!req.file){
    return res.status(400).json({message:"No file"});
  }
  const user = await User.findByIdAndUpdate(
    req.params.id,
    { companyLogo:req.file.filename },
    { returnDocument: 'after' }
  );
  res.json(user);
  }catch(err){
    console.log(err);
    res.status(500).json({ message:"Upload failed" });
  }
});

/* ================= ADD PRODUCT (FINAL FIX) ================= */

app.post("/addProduct/:id", upload.single("image"), async (req, res) => {
  try {
    console.log("BODY:", req.body);
    console.log("FILE:", req.file);
    const { name, price, type, index } = req.body;
    // 🔍 Find user
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    // 🛡 Ensure products array
    if (!Array.isArray(user.products)) {
      user.products = [];
    }
    // 🔥 Parse type safely
    let parsedType = [];
    try {
      const temp = JSON.parse(type);
      if (Array.isArray(temp)) {
        parsedType = temp;
      }
    } catch {
      parsedType = [];
    }
    // 📦 Existing product (if edit)
    let existingProduct = {};
    if (index !== undefined && index !== "") {
      const i = parseInt(index);
      if (!user.products[i]) {
        user.products[i] = {};
      }
      existingProduct = user.products[i];
    }
    // 🔥 FINAL PRODUCT (IMPORTANT FIX)
    const updatedProduct = {
      name: name || existingProduct.name || "",
      price: price || existingProduct.price || "",
      type: parsedType.length ? parsedType : existingProduct.type || [],
      image: existingProduct.image || "" // 👈 keep old image
    };
    // 🖼 Only update image if new file exists
    if (req.file) {
      updatedProduct.image = req.file.filename;
    }
    // 🔄 Save into array
    if (index !== undefined && index !== "") {
      const i = parseInt(index);
      user.products[i] = updatedProduct;
    } else {
      user.products.push(updatedProduct);
    }
    await user.save();
    res.json(user);
  } catch (err) {
    console.log("PRODUCT ERROR:", err);
    res.status(500).json({ message: "Product failed" });
  }
});

/* ================= SEARCH ================= */

app.get("/search", async (req, res) => {
  try {
    const { search, type, userId, category } = req.query;
    let query = {
      _id: { $ne: userId },
      role: "company" // 🔥 only company
    };
    // 🔥 product type filter
    if (type) {
      query["products.type"] = type;
    }
    // 🔥 category filter
    if (category && category !== "All") {
      query.category = category;
    }
    // 🔍 search text
    if (search && search.trim() !== "") {
      query.$or = [
        { companyName: { $regex: search, $options: "i" } },
        { tag: { $regex: search, $options: "i" } },
        { category: { $regex: search, $options: "i" } },
        { "products.name": { $regex: search, $options: "i" } }
      ];
    }
    const data = await User.find(query);
    res.json(data);
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Search failed" });
  }
});

/* ================= SEARCH COMPANY ================= */

app.get("/getUser/:id", async(req,res)=>{
  try{
    const user = await User.findById(req.params.id);
    if(!user){
      return res.status(404).json({ message:"User not found" });
    }
    res.json(user);
  }catch(err){
    console.log(err);
    res.status(500).json({ message:"Error" });
  }
});

/* ================= SEARCH TOOL ================= */

app.get("/labourProducts", async (req,res)=>{
  try{
    const { search } = req.query;
    let query = {
      "products.type": "labour"
    };
    // 🔍 search filter
    if(search){
      query.$or = [
        { "products.name": { $regex: search, $options:"i" }},
        { companyName: { $regex: search, $options:"i" }},
        { tag: { $regex: search, $options:"i" }}
      ];
    }
    // 🔥 only users who have labour products
    const users = await User.find(query);
    // 🔥 flatten products
    let result = [];
    users.forEach(u=>{
      u.products.forEach(p=>{
        if(p.type.includes("labour")){
          result.push({
            productName: p.name,
            price: p.price,
            image: p.image,
            companyName: u.companyName,
            location: u.companyLocation,
            phone: u.companyPhone
          });
        }
      });
    });
    res.json(result);
  }catch(err){
    console.log(err);
    res.status(500).json({ message:"Error" });
  }
});

/* ================= DELETE ACCOUNT ================= */

app.delete("/deleteUser/:id", async(req,res)=>{
  try{
    await User.findByIdAndDelete(req.params.id);
    res.json({ message:"User deleted" });
  }catch(err){
  console.log(err);
  res.status(500).json({ message:"Delete failed" });
  }
});

/* ================= CLEAN ACCOUNT ================= */

app.post("/checkAccounts", async(req,res)=>{
  try{
    const { ids } = req.body;
    // DB USERS RETURN
    const users = await User.find({ _id: { $in: ids } });
    res.json(users);
  }catch(err){
    console.log(err);
    res.status(500).json({ message:"Check failed" });
  }
});

/* ================= SOCKET.IO ================= */

const http = require("http");
const { Server } = require("socket.io");
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
}); 

/* ================= USER SOCKET.IO ================= */

let onlineUsers = {};
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);
  // 🔥 user join
  socket.on("join", (userId) => {
    onlineUsers[userId] = socket.id;
  });
  // 🔥 send message
  socket.on("sendMessage", (data) => {
    const { senderId, receiverId, text } = data;
    const receiverSocket = onlineUsers[receiverId];
    if (receiverSocket) {
      io.to(receiverSocket).emit("receiveMessage", data);
    }
  });
  socket.on("disconnect", () => {
    console.log("User disconnected");
  });
});

/* ================= CHAT COMPANY SEND ================= */

app.post("/sendMessage", async (req, res) => {
  try {
    const { senderId, receiverId, text } = req.body;
    const msg = new Message({
      senderId,
      receiverId,
      text
    });
    await msg.save();
    res.json(msg);
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Send failed" });
  }
});

/* ================= CHAT COMPANY RECEIVE ================= */

app.get("/getMessages", async (req, res) => {
  try {
    const { user1, user2 } = req.query;
    const messages = await Message.find({
      $or: [
        { senderId: user1, receiverId: user2 },
        { senderId: user2, receiverId: user1 }
      ]
    }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Fetch failed" });
  }
});

/* ================= GET ALL MSG ================= */

app.get("/inbox/:userId", async (req, res) => {
  try {
    const userId = req.params.userId;
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid User ID format" });
    }
    // 🔥 get all messages related to user
    const messages = await Message.find({
      $or: [
        { senderId: userId },
        { receiverId: userId }
      ]
    }).sort({ createdAt: -1 });
    // 🔥 group by other user
    const map = {};
    for (let msg of messages) {
      if (!msg.senderId || !msg.receiverId) continue;
      const otherUser =
        msg.senderId === userId ? msg.receiverId : msg.senderId;

      if (!map[otherUser]) {
        map[otherUser] = msg; // latest message
      }
    }
    const userIds = Object.keys(map).filter(id => {
      return mongoose.Types.ObjectId.isValid(id) && id !== "undefined";
    });
    // 🔥 fetch user details
    const users = await User.find({
      _id: { $in: userIds }
    });
    const inbox = users.map(u => ({
      userId: u._id,
      name: u.companyName || u.name,
      profilePic: u.companyLogo || u.profilePic,
      lastMessage: map[u._id.toString()] ? map[u._id.toString()].text : "",
      time: map[u._id.toString()] ? map[u._id.toString()].createdAt : null
    }));
    res.json(inbox);
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Inbox failed" });
  }
});

/* ================= GET USER DATA ================= */

app.get("/getUserData/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Error fetching user data" });
  }
});

/* ================= GROUP CHAT SEND ================= */

app.post("/sendGroupMessage", upload.single("attachment"), async (req, res) => {
  try {
    const { senderId, groupId, message, replyTo } = req.body;
    let attachmentData = { filename: "", attachmentSetPath: "uploads/temp" };
    if (req.file) {
      attachmentData.filename = req.file.filename;
    }
    const msg = new GroupMessage({
      senderId,
      groupId,
      message,
      attachments: attachmentData,
      replyTo: replyTo || null
    });
    await msg.save();
    const populated = await GroupMessage.findById(msg._id)
      .populate("senderId", "name profilePic")
      .populate({
        path: "replyTo",
        populate: {
          path: "senderId",
          select: "name"
        }
      });
    res.json(populated);
  } catch (err) {
    console.log(err);
    res.status(500).json({
      message: "Group send failed"
    });
  }
});

/* ================= REGISTER LOCAL APP SYNC DOWNLOAD STATUS ================= */

app.post("/syncAttachmentDownload", async (req, res) => {
  try {
    const { userId, messageId, downloadPath, filename, groupMemberIds } = req.body;
    const userProfile = await User.findById(userId);
    if (!userProfile) return res.status(404).json({ message: "User index node reference profile error." });
    userProfile.folderCreated.push({
      attachmentId: messageId,
      attachmentStatus: true,
      attachmentSetPath: "uploads/temp",
      attachmentGetPath: downloadPath
    });
    await userProfile.save();
    if (groupMemberIds && groupMemberIds.length > 0 && filename) {
      const totalGroupUsersCount = groupMemberIds.length;
      const downloadedUsersCount = await User.countDocuments({
        _id: { $in: groupMemberIds },
        "folderCreated": {
          $elemMatch: {
            attachmentId: messageId,
            attachmentStatus: true
          }
        }
      });
      console.log(`Sync status log: ${downloadedUsersCount}/${totalGroupUsersCount} users completed downloading.`);
      if (downloadedUsersCount >= totalGroupUsersCount) {
        console.log(`🎯 All active group members downloaded. Triggering 5-minute timer to delete exactly: ${filename}`);
        setTimeout(() => {
          deletePhysicalFile(filename);
        }, 5 * 60 * 1000); 
      }
    }
    res.json({ success: true, trackingRecord: userProfile.folderCreated });
  } catch (err) {
    console.error("Tracking transaction processing errors tracker runtime trace:", err);
    res.status(500).json({ message: "Unable to complete down-stream synchronization updates traces." });
  }
});

/* ================= UPDATE USER PERMISSION ================= */

app.put("/updateUserPermission/:userId", async (req, res) => {
  try {
    const { attachmentPermission } = req.body;
    const updatedUser = await User.findByIdAndUpdate(
      req.params.userId,
      { attachmentPermission },
      { returnDocument: 'after' }
    );
    if (!updatedUser) {
      return res.status(404).json({ success: false, message: "User profile context matrix tracking error." });
    }
    res.json({ success: true, user: updatedUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Permission updates trace operation script broken." });
  }
});

/* ================= GROUP CHAT RECEIVE ================= */

app.get("/getGroupMessages", async (req, res) => {
  try {
    const { groupId } = req.query;
    const messages = await GroupMessage
      .find({ groupId })
      .populate("senderId", "name profilePic")
      .populate({
          path:"replyTo",
          populate:{
              path:"senderId",
              select:"name"
          }
      })
      .sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    console.log(err);
    res.status(500).json({
      message: "Fetch failed"
    });
  }
});

/* ================= GET GROUP ================= */

app.get("/getGroup/:vendorId", async (req,res)=>{
  try{
    const group=await Group.findOne({
      vendorId:req.params.vendorId
    });
    res.json(group);
  }catch(err){
    res.status(500).json({
      message:"Group fetch failed"
    });
  }
});

/* ================= GROUP INBOX ================= */

app.get("/groupInbox/:userId", async (req,res)=>{
  try{
    const user=await User.findById(req.params.userId);
    let vendorId;
    if(user.role==="company"){
      vendorId=user._id;
    }else{
      vendorId=user.usedBy;
    }
    const group=await Group.findOne({
      vendorId
    });
    if(!group){
      return res.json([]);
    }
    const lastMessage=await GroupMessage
    .findOne({
      groupId:group._id
    })
    .sort({
      createdAt:-1
    });
    res.json({
      groupId:group._id,
      groupName:group.groupName,
      groupImage:group.groupImage,
      lastMessage:lastMessage?.text || "",
      time:lastMessage?.createdAt || group.createdAt
    });
  }catch(err){
    console.log(err);
    res.status(500).json({
      message:"Group Inbox Failed"
    });
  }
});

/* ================= GROUP MEMBERS ================= */

app.get("/groupMembers/:vendorId", async (req, res) => {
  try {
    const vendorId = req.params.vendorId;
    // Company Owner
    const vendor = await User.findById(vendorId);
    // Employees only
    const employees = await User.find({
      role: "customer",
      usedBy: vendorId
    });
    const members = [
      {
        _id: vendor._id,
        name: vendor.companyName,
        profilePic: vendor.companyLogo,
        role: "company",
        subRole: "Owner"
      },
      ...employees.map(emp => ({
        _id: emp._id,
        name: emp.name,
        profilePic: emp.profilePic,
        role: emp.role,
        subRole: emp.subRole
      }))
    ];
    res.json(members);
  } catch (err) {
    console.log(err);
    res.status(500).json({
      message: "Members fetch failed"
    });
  }
});

/* ================= EDIT GROUP MESSAGE ================= */

app.put("/editGroupMessage/:messageId", async (req, res) => {
  try{
    const { senderId, message } = req.body;
    const msg = await GroupMessage.findById(req.params.messageId);
    if(!msg){
      return res.status(404).json({
        message:"Not Found"
      });
    }
    if(String(msg.senderId)!==String(senderId)){
      return res.status(403).json({
        message:"Permission denied"
      });
    }
    msg.message=message;
    msg.isEdited=true;
    await msg.save();
    res.json(msg);
  }catch(err){
    console.log(err);
    res.status(500).json({
      message:"Edit failed"
    });
  }
});

/* ================= DELETE GROUP MESSAGE ================= */

app.put("/deleteGroupMessage/:messageId", async (req, res) => {
  try {
    const { userId } = req.body;
    const msg = await GroupMessage.findById(req.params.messageId);
    if (!msg) {
      return res.status(404).json({
        message: "Message not found"
      });
    }
    if (String(msg.senderId) !== String(userId)) {
      return res.status(403).json({
        message: "You can delete only your own message."
      });
    }
    if (msg.attachments && msg.attachments.filename && msg.attachments.attachmentSetPath !== null) {
      const absoluteTargetPhysicalPath = path.join(__dirname, 'uploads', 'temp', msg.attachments.filename);
      if (fs.existsSync(absoluteTargetPhysicalPath)) {
        fs.unlinkSync(absoluteTargetPhysicalPath);
        console.log(`🗑️ Success Cleanup: File '${msg.attachments.filename}' automatically purged from uploads/temp because sender deleted the message.`);
      }
    }
    await GroupMessage.findByIdAndDelete(req.params.messageId);
    res.json({
      success: true
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      message: "Delete failed"
    });
  }
});

/* ================= DOWNLOAD ATTACHMENT FILE ================= */

app.get('/download-file/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, 'uploads', 'temp', filename);
    if (fs.existsSync(filePath)) {
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/octet-stream');
        return res.download(filePath, filename);
    } else {
        return res.status(404).send('File not found or already purged.');
    }
});

/* ================= PROJECT GROUP CHAT SEND ================= */

app.post("/sendProjectGroupMessage", upload.single("attachment"), async (req, res) => {
  try {
    const { senderId, projectId, message, replyTo } = req.body;
    if (!senderId || !projectId) {
      return res.status(400).json({ message: "senderId and projectId are required!" });
    }
    let attachmentData = { filename: "", attachmentSetPath: "uploads/temp" };
    if (req.file) {
      attachmentData.filename = req.file.filename;
    }
    const msg = new ProjectGroupMessage({
      senderId,
      projectId,
      message: message || "",
      attachments: attachmentData,
      replyTo: replyTo || null
    });
    await msg.save();
    const populated = await ProjectGroupMessage.findById(msg._id)
      .populate("senderId", "name profilePic")
      .populate({
        path: "replyTo",
        populate: {
          path: "senderId",
          select: "name"
        }
      });
    res.json(populated);
  } catch (err) {
    console.error("❌ Project Group send error:", err);
    res.status(500).json({
      message: "Project group message send failed",
      error: err.message
    });
  }
});

/* ================= PROJECT GROUP CHAT RECEIVE ================= */

app.get("/getProjectGroupMessages", async (req, res) => {
  try {
    const { projectId } = req.query;
    if (!projectId) {
      return res.status(400).json({ message: "projectId is required!" });
    }
    const messages = await ProjectGroupMessage
      .find({ projectId })
      .populate("senderId", "name profilePic")
      .populate({
        path: "replyTo",
        populate: {
          path: "senderId",
          select: "name"
        }
      })
      .sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    console.error("❌ Project Group fetch error:", err);
    res.status(500).json({ message: "Project group messages fetch failed" });
  }
});

/* ================= PROJECT GROUP INBOX (LAST MESSAGE) ================= */

app.get("/projectGroupInbox/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params;
    const lastMessage = await ProjectGroupMessage
      .findOne({ projectId })
      .populate("senderId", "name")
      .sort({ createdAt: -1 });
    res.json({
      projectId,
      lastMessage: lastMessage?.message || (lastMessage?.attachments?.filename ? "📎 Attachment" : ""),
      lastSender: lastMessage?.senderId?.name || "",
      time: lastMessage?.createdAt || null
    });
  } catch (err) {
    console.error("❌ Project Inbox Error:", err);
    res.status(500).json({ message: "Project Group Inbox Failed" });
  }
});

/* ================= EDIT PROJECT GROUP MESSAGE ================= */

app.put("/editProjectGroupMessage/:messageId", async (req, res) => {
  try {
    const { senderId, message } = req.body;
    const msg = await ProjectGroupMessage.findById(req.params.messageId);
    if (!msg) {
      return res.status(404).json({ message: "Not Found" });
    }
    if (String(msg.senderId) !== String(senderId)) {
      return res.status(403).json({ message: "Permission denied" });
    }
    msg.message = message;
    msg.isEdited = true;
    await msg.save();
    res.json(msg);
  } catch (err) {
    console.error("❌ Edit Project Message Error:", err);
    res.status(500).json({ message: "Edit failed" });
  }
});

/* ================= DELETE PROJECT GROUP MESSAGE ================= */

app.put("/deleteProjectGroupMessage/:messageId", async (req, res) => {
  try {
    const { userId } = req.body;
    const msg = await ProjectGroupMessage.findById(req.params.messageId);
    if (!msg) {
      return res.status(404).json({ message: "Message not found" });
    }
    if (String(msg.senderId) !== String(userId)) {
      return res.status(403).json({ message: "You can delete only your own message." });
    }
    if (msg.attachments && msg.attachments.filename) {
      const absoluteTargetPhysicalPath = path.join(__dirname, 'uploads', 'temp', msg.attachments.filename);
      if (fs.existsSync(absoluteTargetPhysicalPath)) {
        fs.unlinkSync(absoluteTargetPhysicalPath);
      }
    }
    await ProjectGroupMessage.findByIdAndDelete(req.params.messageId);
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Delete Project Message Error:", err);
    res.status(500).json({ message: "Delete failed" });
  }
});

/* ================= FORGET PASSWORD ================= */

app.post('/api/forget-password/verify', async (req, res) => {
  const { phone } = req.body;
  try {
    const user = await User.findOne({ phone }).populate('createdBy');
    if (!user) {
        return res.status(404).json({ success: false, message: "User with this phone number not found!" });
    }
    let targetEmail = "";
    let targetCompanyName = "";
    let isSelfRegistered = !user.createdBy;
    if (isSelfRegistered) {
      targetEmail = user.email; 
      targetCompanyName = user.companyName || "Hatvisor Enterprise";
    } else {
        targetEmail = user.createdBy.email;
        targetCompanyName = user.createdBy.companyName || "Hatvisor Enterprise";
    }
    if (!targetEmail) {
      return res.status(400).json({ 
          success: false, 
          message: isSelfRegistered ? "User profile email address missing!" : "Vendor email reference missing!" 
      });
    }
    const generatedOTP = Math.floor(100000 + Math.random() * 900000).toString();
    user.resetOTP = generatedOTP;
    user.resetOTPExpires = Date.now() + 5 * 60 * 1000;
    await user.save();
    console.log(`🔑 Generated OTP [${generatedOTP}] for User [${user.name}] sending to [${targetEmail}]`);
    const mailOptions = {
      from: '"Hatvisor Security" <seo@asi.acousticalsurfaces.in>',
      to: targetEmail,
      subject: 'Password Recovery OTP Request',
      html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px; max-width: 500px;">
              <h2 style="color: #075e54; text-align: center;">Hatvisor OTP Service</h2>
              <p>Hello,</p>
              <p>An OTP has been requested to recover the password of account <strong>${user.name}</strong> (Phone: ${user.phone}).</p>
              ${!isSelfRegistered ? `<p style="font-size: 13px; color: #555;">This is an employee account registered under your organization platform metrics.</p>` : ''}
              <div style="background: #f4f4f4; padding: 15px; text-align: center; border-radius: 6px; font-size: 24px; font-weight: bold; letter-spacing: 4px; color: #075e54; margin: 20px 0;">
                  ${generatedOTP}
              </div>
              <p style="font-size: 11px; color: #777;">This code is confidential and will expire in 15 minutes. If you did not initiate this, please ignore this email.</p>
          </div>
      `
    };
    try {
      const info = await transporter.sendMail(mailOptions);
      console.log("📨 Mail dispatch success. MessageId: ", info.messageId);
    } catch (mailError) {
      console.error("❌ Mail Transport Core Scrambled:", mailError);
      return res.status(500).json({ 
        success: false, 
        message: "Mail server failed to send message. Please check server logs.",
        technicalDetails: mailError.message 
      });
    }
    return res.json({
      success: true,
      userName: user.name,
      companyName: targetCompanyName,
      targetEmail: targetEmail,
      message: `OTP successfully dispatched to target email layout.`
    });
  } catch (error) {
    console.error("Verification processing fault:", error);
    return res.status(500).json({ success: false, message: "Server configuration system error." });
  }
});

/* ================= VERIFY OTP ================= */

app.post('/api/forget-password/reset', async (req, res) => {
  const { phone, otp, newPassword } = req.body;
  try {
    const user = await User.findOne({ 
        phone, 
        resetOTP: otp,
        resetOTPExpires: { $gt: Date.now() }
    });
    if (!user) {
        return res.status(400).json({ success: false, message: "Invalid OTP or validation code expired!" });
    }
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.resetOTP = null;
    user.resetOTPExpires = null;
    await user.save();
    return res.json({ success: true, message: "Password updated successfully." });
  } catch (error) {
    console.error("Password reset update error:", error);
    return res.status(500).json({ success: false, message: "Failed to reset password." });
  }
});

/* ================= 1.1. CREATE LABOUR ================= */

app.post("/createLabour", upload.fields([
  { name: 'dp', maxCount: 1 }, 
  { name: 'idCard', maxCount: 1 }
]), async (req, res) => {
  try {
    const { 
      name, jobRole, phone, password, address, role, vendorId,
      assignType, paymentType, amount, overtimeAmount 
    } = req.body;
    
    // Check duplicate
    const existingLabour = await User.findOne({ phone });
    if (existingLabour) {
      return res.status(400).json({ message: "Labour already registered!", isDuplicate: true });
    }

    const profilePicFile = req.files['dp'] ? req.files['dp'][0].filename : "";
    const idProofFile = req.files['idCard'] ? req.files['idCard'][0].filename : "";

    const labour = new User({
      name,
      phone,
      password,
      role: "labour",
      createdBy: vendorId,
      address,
      // 🌟 THE FIX: Inga 'work' nu potturundheenga, adhai 'jobRole' nu mathunga
      jobRole: jobRole, 
      profilePic: profilePicFile,
      idProof: idProofFile,
      assignType: assignType || "",
      paymentType: paymentType || "Day",
      amount: amount || "0",
      overtimeAmount: overtimeAmount || "0",
      attendanceStatus: "OUT",
      overtime: false,
      isActiveForVendor: true
    });

    await labour.save();
    res.json(labour);
  } catch (err) {
    res.status(500).json({ message: "Create failed", error: err.message });
  }
});

/* ================= 1.2. GET MY LABOURS ================= */

app.get("/getMyLabours/:id", async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0]; // Current Date (YYYY-MM-DD)
    const vendorId = req.params.id;
    const vendorObjectId = new mongoose.Types.ObjectId(vendorId);
    // 1. First, ellā labours-ahyum edukkaum
    const labours = await User.find({
      role: "labour",
      isActiveForVendor: true,
      $or: [
        { createdBy: vendorObjectId },
        { usedBy: vendorObjectId },
        { createdBy: vendorId }, // Safety-kaga string-avum check pannuvom
        { usedBy: vendorId }
      ] 
    });
    // 2. Oru oru labour-ahyum check panni, "pazhaya date" attendance-ah irundha reset pannuvom
    const updatedLabours = await Promise.all(labours.map(async (l) => {
      // User model-la 'lastUpdateDate' oru field vechukoanga
      if (l.lastUpdateDate && l.lastUpdateDate !== today) {    
        // --- AUTO RESET LOGIC ---
        l.attendanceStatus = "OUT";
        l.overtime = false;
        l.actualInTime = "--:--";
        l.actualOutTime = "--:--";
        l.otStartTime = "--:--";
        l.otEndTime = "--:--";
        l.lastUpdateDate = today; // Update to today
        await l.save();
      }
      return l;
    }));
    res.json(updatedLabours);
  } catch (err) {
    res.status(500).json({ message: "Fetch failed" });
  }
});

/* ================= 1.3. UPDATE ATTENDANCE (IN/OUT) ================= */

app.put("/attendance/:id", async (req, res) => {
  try {
    const { status } = req.body;
    let update = { attendanceStatus: status }; // ✅ Correct variable name
    if (status === "OUT") {
      update.actualOutTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
      update.overtime = false; 
    } else {
      update.actualInTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    }
    // ✅ findByIdAndUpdate-la "update" variable-ah use pannunga
    const data = await User.findByIdAndUpdate(req.params.id, update, { returnDocument: 'after' } );
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: "Attendance update failed" });
  }
});

/* ================= 1.4. TOGGLE OVERTIME ================= */

app.put("/overtime/:id", async (req, res) => {
  try {
    const data = await User.findById(req.params.id);
    if (!data) return res.status(404).json({ message: "User not found" });
    data.overtime = !data.overtime;
    if (data.overtime) {
      data.otStart = new Date();
    } else {
      data.otEnd = new Date();
    }
    await data.save();
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: "OT toggle failed" });
  }
});

/* ================= 1.5. SAVE DAILY ATTENDANCE ================= */

app.post("/saveDailyAttendance", async (req, res) => {
  try {
    const { labourId, vendorId, date, dailyWage, otPay, totalPay } = req.body;
    const filter = { labourId, vendorId, date };
    // Update panna use panra logic
    const update = {
      dailyWage: Number(dailyWage || 0),
      otPay: Number(otPay || 0),
      totalPay: Number(totalPay || 0)
    };
    // upsert: true panna, record illana pudhusa create aagum, irundha update aagum
    const result = await Attendance.findOneAndUpdate(filter, update, { 
      returnDocument: 'after', 
      upsert: true 
    });
    res.json({ success: true, data: result });
  } catch (err) {
    console.error("Save Error:", err.message);
    res.status(500).json({ message: "Attendance save failed", error: err.message });
  }
});

/* ================= 1.6. EDIT ATTENDANCE AMOUNT ================= */

app.put("/editAttendance/:id", async (req, res) => {
  try {
    const { otPay, totalPay } = req.body;
    // ID-ah vechu attendance record-ah find panni update pandroam
    const updatedRecord = await Attendance.findByIdAndUpdate(
      req.params.id,
      { $set: { otPay: Number(otPay), totalPay: Number(totalPay) } },
      { returnDocument: 'after' }
    );
    if (!updatedRecord) return res.status(404).json({ message: "Record not found" });
    res.json({ success: true, data: updatedRecord });
  } catch (err) {
    res.status(500).json({ message: "Update failed", error: err.message });
  }
});

/* ================= 1.7. BULK UPDATE ATTENDANCE ================= */

app.put("/bulkUpdateAttendance", async (req, res) => {
  try {
    const { updates } = req.body; 
    const today = new Date().toISOString().split('T')[0];
    const bulkOps = updates.map(update => {
      // NaN error varama irukka Number conversion + Fallback to 0
      const wage = Number(update.dailyWage) || 0;
      const ot = Number(update.otPay) || 0;
      const total = wage + ot; // Backend-laye sum pandroam
      return {
        updateOne: {
          filter: { 
            labourId: update.labourId, 
            date: today 
          },
          update: { 
            $set: { 
              dailyWage: wage,
              otPay: ot,
              totalPay: total // Correct-ah sum aagi save aagum
            } 
          },
          upsert: true 
        }
      };
    });
    await Attendance.bulkWrite(bulkOps);
    res.json({ success: true });
  } catch (err) {
    console.error("Bulk Error:", err.message);
    res.status(500).json({ message: "Failed", error: err.message });
  }
});

/* ================= 1.8. UPDATE LABOUR DETAILS ================= */

app.put("/updateLabourUser/:id", upload.fields([
  { name: 'dp', maxCount: 1 }, 
  { name: 'idCard', maxCount: 1 }
]), async (req, res) => {
  try {
    const labourId = req.params.id;
    const labour = await User.findById(req.params.id);
    const { phone, password, usedBy, assignType, ...restData } = req.body;
    let updateFields = { ...restData, usedBy };
    if (assignType) {
      updateFields.assignType = assignType;
    }
    if (assignType === "enterprise") {
      updateFields.currentProjectName = "";
      if (labour.projectData && labour.projectData.length > 0) {
        labour.projectData.forEach(p => {
          if (p.projectLabour) {
            p.projectLabour.forEach(entry => {
              entry.inLabour = false;
            });
          }
        });
        await labour.save();
      }
    }
    if (labour.createdBy && labour.createdBy.toString() === usedBy) {
      if (phone) updateFields.phone = phone;
      if (password && password.trim() !== "") updateFields.password = password;
    } else {
      delete updateFields.phone;
      delete updateFields.password;
    }
    if (req.files) {
      if (req.files.dp) updateFields.profilePic = req.files.dp[0].filename;
      if (req.files.idCard) updateFields.idProof = req.files.idCard[0].filename;
    }
    const updated = await User.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields }, 
      { returnDocument: 'after' }
    );
    const labours = await User.find({
      $or: [
        { createdBy: req.params.vendorId },
        { usedBy: req.params.vendorId }
      ]
    });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Update failed" });
  }
});

/* ================= 1.9. SOFT DELETE (Remove from List) ================= */

app.put("/removeLabourFromVendor/:id", async (req, res) => {
  try {
    const labourId = req.params.id;
    const labour = await User.findById(labourId);
    if (!labour) {
      return res.status(404).json({ message: "Labour not found" });
    }
    labour.isActiveForVendor = false;
    labour.projectData = [];
    labour.supplyData = [];
    labour.importData = [];
    res.json({ message: "Removed from list" });
  } catch (err) {
    res.status(500).json({ message: "Remove failed" });
  }
});

/* ================= 1.10. PHONE NUMBER SEARCH ================= */

app.get("/searchGlobalLabour", async (req, res) => {
  try {
    const { phone } = req.query;
    console.log("Searching for phone:", phone); // Log panni paarunga terminal-la
    // Strict Filter: role 'labour' & phone match
    const labour = await User.findOne({ 
      phone: String(phone), // String-ah convert pannikonga safe-ku
      role: "labour" 
    });
    if (!labour) {
      return res.status(404).json({ message: "Labour not found" });
    }   
    res.json(labour);
  } catch (err) {
    res.status(500).json({ message: "Search failed", error: err.message });
  }
});

/* ================= 1.11. MULTI-ASSIGN API (NEW) ================= */

app.put("/multiAssignLabours", async (req, res) => {
  try {
    const { labourIds, ...updateData } = req.body;
    if (!Array.isArray(labourIds) || labourIds.length === 0) {
      return res.status(400).json({ message: "No labours selected" });
    }
    // updateMany use panni array-la irukura ellarukkum bulk update pandroam
    await User.updateMany(
      { _id: { $in: labourIds } }, 
      { $set: updateData }
    );
    res.json({ success: true, message: "Bulk update success" });
  } catch (err) {
    res.status(500).json({ message: "Multi-assign failed", error: err.message });
  }
});

/* ================= 1.12. GET UNASSIGNED LABOURS (Public Pool) ================= */

app.get("/getPublicLabours", async (req, res) => {
  try {
    const { city, role } = req.query; // Role search-um backend-ke anuppidalaam   
    // 1. Initial Filter: Assigned illadha workers-ah mattum edu
    let filter = {
      role: "labour", 
      "supplyData.dispatchStatus": { $ne: "shipped" },
      $or: [
        { assignType: { $in: ["", null, "removed"] } },
        {
          $and: [
            { attendanceStatus: "OUT" },
            { overtime: { $ne: true } }
          ]
        }  
      ]
    };
    // 2. Job Role search (irundha add pannu)
    if (role) {
      filter.jobRole = { $regex: new RegExp(role, "i") };
    }
    const allLabours = await User.find(filter);
    // 3. 🧠 SMART SORTING Logic:
    // User current city match aagura workers-ah top-la vai, mathavangala aduthu vai.
    const sortedLabours = allLabours.sort((a, b) => {
      const cityA = a.location?.city || a.city || "";
      const cityB = b.location?.city || b.city || "";
      const isAMatch = cityA.toLowerCase() === city.toLowerCase();
      const isBMatch = cityB.toLowerCase() === city.toLowerCase();
      if (isAMatch && !isBMatch) return -1;
      if (!isAMatch && isBMatch) return 1;
      return 0; 
    });
    res.json(sortedLabours);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/* ================= 1.13. GET PAY TOTAL ================= */

app.get("/getPaymentRange", async (req, res) => {
  try {
    const { vendorId, start, end } = req.query;
    if (!vendorId || !start || !end) {
      return res.status(400).json({ message: "Missing params" });
    }

    // ✅ Aggregation logic update
    const summary = await Attendance.aggregate([
      { 
        $match: { 
          vendorId: vendorId,
          date: { $gte: start, $lte: end } 
        } 
      },
      { 
        $group: {
          _id: "$labourId",
          totalWage: { $sum: { $ifNull: ["$dailyWage", 0] } },
          totalOT: { $sum: { $ifNull: ["$otPay", 0] } },
          grandTotal: { $sum: { $ifNull: ["$totalPay", 0] } }
        }
      }
    ]);
    console.log("Summary Result:", summary);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ message: "Payment summary error", error: err.message });
  }
});

/* ================= 2.1. CREATE EMPLOYEE ================= */

app.post("/createEmployee", upload.single("dp"), async(req,res)=>{
  try{
    const { name, designation, phone, password, email, address, subRole, vendorId } = req.body;
    /* PHONE UNIQUE */
    const exist = await User.findOne({ phone });
    if(exist){
      return res.status(400).json({ message:"Phone exists" });
    }
    const companyOwner = await User.findById(vendorId);
    let sharedProjectData = [];
    if (companyOwner && companyOwner.projectData && companyOwner.projectData.length > 0) {
      sharedProjectData = companyOwner.projectData.map(p => ({
        projectId: p.projectId,
        projectName: p.projectName,
        cover: p.cover || "",
        status: p.status || "onprogress",
        inProject: true,
        projectLabour: p.projectLabour || [],
        propertyOwners: p.propertyOwners || [],
        propertyDetails: p.propertyDetails || {},
        supportSources: p.supportSources || [],
        taskMedia: p.taskMedia || {
          frontView: { url: "" }, backView: { url: "" }, leftView: { url: "" },
          rightView: { url: "" }, ceilingView: { url: "" }, floorView: { url: "" }
        },
        likeCount: p.likeCount || 0,
        isPublic: p.isPublic || false,
        postedAt: p.postedAt || null
      }));
    }
    const sharedSupplyData = (companyOwner && companyOwner.supplyData) ? companyOwner.supplyData : [];
    const sharedImportData = (companyOwner && companyOwner.importData) ? companyOwner.importData : [];
    const sharedProductionData = (companyOwner && companyOwner.productionData) ? companyOwner.productionData : [];
    const sharedMaterialData = (companyOwner && companyOwner.materialData) ? companyOwner.materialData : [];
    const emp = new User({
      name,
      phone,
      password,
      email,
      address,
      profilePic: req.file ? req.file.filename : "",
      role: "customer",
      createdBy: vendorId,
      usedBy: vendorId, 
      designation: req.body.designation,
      /* DEFAULT PROJECT ATTACH */
      subRole: req.body.subRole,
      projectData: sharedProjectData,
      supplyData: sharedSupplyData,
      importData: sharedImportData,
      productionData: sharedProductionData,
      materialData: sharedMaterialData
    });
    await emp.save();
    res.json(emp);
  }catch(err){
    console.log(err);
    res.status(500).json({message:"Create employee failed"});
  }
});

/* ================= 2.2. GET EMPLOYEE ================= */

app.get("/getEmployees/:id", async(req,res)=>{
  try{
    const data = await User.find({
      role:"customer",
      createdBy:req.params.id,
      subRole: { $ne: null }
    });
    res.json(data);
  } catch(err) {
    console.log(err);
    res.status(500).json({message:"Fetch failed"});
  }
});

/* ================= 2.3. UPDATE EMPLOYEE ================= */

app.put("/updateOwner/:id", upload.single("dp"), async(req,res)=>{
  try{
    const updateData = {
      name: req.body.name,
      phone: req.body.phone,
      email: req.body.email,
      address: req.body.address,
      designation: req.body.designation,
      subRole: req.body.subRole
    };
    if(req.file){
      updateData.profilePic = req.file.filename;
    }
    const data = await User.findByIdAndUpdate(
      req.params.id,
      updateData,
      { returnDocument: 'after' }
    );
    res.json(data);
  } catch(err) {
    console.log(err);
    res.status(500).json({message:"Owner update failed"});
  }
});

/* ================= 2.4. SOFT DELETE ================= */

app.put("/removeEmployee/:id", async (req, res) => {
  try {
    const empId = req.params.id;
    const emp = await User.findById(empId);
    if (!emp) {
      return res.status(404).json({ msg: "Employee not found" });
    }
    // 🔥 MAIN LOGIC
    const oldCompanyId = emp.usedBy;
    emp.usedBy = null;              // company remove
    emp.createdBy = emp._id;        // self owner
    emp.subRole = "executive";      // default role
    emp.projectData = [];
    emp.supplyData = [];
    emp.importData = [];
    emp.productionData = [];
    emp.materialData = [];
    await emp.save();
    if (oldCompanyId) {
      const company = await User.findById(oldCompanyId);
      if (company) {
        await company.save();
      }
    }
    res.json({ msg: "Employee removed from company" });
  } catch (err) {
    console.log(err);
    res.status(500).json({ msg: "Server error" });
  }
});

/* ================= 2.5. SEARCH EMPLOYEE ================= */

app.get("/searchEmployee/:phone", async (req, res) => {
  try {
    const emp = await User.findOne({
      phone: req.params.phone,
      role: "customer"
    });
    if (!emp) return res.json(null);
    res.json(emp);
  } catch (err) {
    res.status(500).json({ msg: "Error" });
  }
});

/* ================= 2.6. ONBOARD EMPLOYEE ================= */

app.put("/onboardEmployee/:id", async (req, res) => {
  try {
    const empId = req.params.id;
    const {
      vendorId,
      designation,
      subRole,
      casualLeave,
      sickLeave,
      weekOff
    } = req.body;
    const emp = await User.findById(empId);
    if (!emp) return res.status(404).json({ msg: "Not found" });
    const vendor = await User.findById(vendorId);
    if (!vendor) return res.status(404).json({ msg: "Vendor not found" });
    // 🔥 MAIN LOGIC
    emp.usedBy = vendorId;
    emp.createdBy = vendorId;
    emp.designation = designation;
    emp.subRole = subRole;
    emp.casualLeave = casualLeave;
    emp.sickLeave = sickLeave;
    emp.weekOff = weekOff;
    emp.projectData = vendor.projectData || [];
    emp.supplyData = vendor.supplyData || [];
    emp.importData = vendor.importData || [];
    await emp.save();
    res.json({ msg: "Employee onboarded" });
  } catch (err) {
    res.status(500).json({ msg: "Error" });
  }
});

/* ================= 2.7. APPLY SICK LEAVE ================= */

app.post("/applySickLeave", async (req, res) => {
  const { userId, startDate, endDate, reason } = req.body;
  await User.findByIdAndUpdate(userId, {
    $push: {
      sickLeaves: { startDate, endDate, reason }
    }
  });
  res.send("Sick Leave Applied");
});

/* ================= 2.8. APPLY CASUAL LEAVE ================= */

app.post("/applyCasualLeave", async (req, res) => {
  const { userId, startDate, endDate, reason } = req.body;
  await User.findByIdAndUpdate(userId, {
    $push: {
      casualLeaves: { startDate, endDate, reason }
    }
  });
  res.send("Casual Leave Applied");
});

/* ================= 2.9. GENERAL LEAVE ================= */

app.post("/applyGeneralLeave", async (req, res) => {
  try {
    const { userId, startDate, endDate, type, reason } = req.body;
    if (!type) return res.status(400).json({ msg: "Leave type is required buddy!" });
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        $push: {
          generalLeaves: {
          startDate: new Date(startDate),  // ✅ FIX
          endDate: new Date(endDate),      // ✅ FIX
          type: type,
          reason
          }
        }
      },
      { returnDocument: "after" }
    );
    if (!updatedUser) {
      return res.status(404).json({ msg: "User not found" });
    }
    res.status(200).json(updatedUser);
  } catch (err) {
    console.log(err);
    res.status(500).json({ msg: "Server Error" });
  }
});

/* ================= 2.10. DELETE LEAVE ================= */

app.put("/deleteLeave", async (req, res) => {
  try {
    const { userId, index, type } = req.body;
    let field;
    if (type === "sick") field = "sickLeaves";
    else if (type === "casual") field = "casualLeaves";
    else if (type === "general") field = "generalLeaves";
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ msg: "User not found" });
    user[field].splice(index, 1);
    await user.save();
    res.json({ msg: "Deleted" });
  } catch (err) {
    console.log(err);
    res.status(500).json({ msg: "Delete failed" });
  }
});

/* ================= 2.11. EDIT LEAVE ================= */

app.put("/updateLeave", async (req, res) => {
  try {
    const { userId, index, type, startDate, endDate, reason, leaveCategory } = req.body;
    let field;
    if (type === "sick") field = "sickLeaves";
    else if (type === "casual") field = "casualLeaves";
    else if (type === "general") field = "generalLeaves";
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ msg: "User not found" });
    user[field][index] = {
      ...user[field][index],
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      reason,
      type: type === "general" ? leaveCategory : user[field][index].type
    };
    user.markModified(field);
    await user.save();
    res.json({ msg: "Updated" });
  } catch (err) {
    console.log(err);
    res.status(500).json({ msg: "Update failed" });
  }
});

/* ================= 2.12. BULK HOLIDAY ================= */

app.post("/markHolidayBulk", async (req, res) => {
  try {
    const { userIds, date, type, reason } = req.body;
    await User.updateMany(
      { _id: { $in: userIds } },
      {
        $push: {
          generalLeaves: {
            startDate: new Date(date),
            endDate: new Date(date),
            type: type, // "Holiday"
            reason: reason
          }
        }
      }
    );
    res.status(200).json({ msg: "Bulk update success" });
  } catch (err) {
    console.log(err);
    res.status(500).json({ msg: "Bulk update failed" });
  }
});

/* ================= 2.13. RESET STATUS ================= */

app.post("/resetBulkStatus", async (req, res) => {
  try {
    const { employeeIds, date } = req.body;
    const targetDate = new Date(date).toISOString().split('T')[0];
    await User.updateMany(
      { _id: { $in: employeeIds } },
      {
        $pull: {
          generalLeaves: {
            startDate: { 
              $gte: new Date(targetDate + "T00:00:00.000Z"), 
              $lte: new Date(targetDate + "T23:59:59.999Z") 
            }
          }
        }
      }
    );
    res.json({ msg: "Status reset successfully" });
  } catch (err) {
    res.status(500).json({ msg: "Reset failed" });
  }
});

/* ================= 3.1. FETCH LABOURS FOR ENTERPRISE ================= */

app.get("/getEnterpriseLabours/:vendorId", async (req, res) => {
  try {
    const { vendorId } = req.params;
    const vendorObjectId = new mongoose.Types.ObjectId(vendorId);
    const labours = await User.find({
      role: "labour",
      isActiveForVendor: true,
      $or: [
        { createdBy: vendorObjectId },
        { usedBy: vendorObjectId }
      ] 
    });
    res.json(labours);
  } catch (err) {
    res.status(500).json({ message: "Enterprise fetch failed buddy!" });
  }
});

/* ================= 3.2. UPDATE LABOUR RATING ================= */

app.put("/updateLabourEnterprise/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { vendorId, rating } = req.body;
    if (!vendorId) {
      return res.status(400).json({ message: "Vendor ID is completely missing buddy!" });
    }
    const labour = await User.findById(id);
    const vendor = await User.findById(vendorId);
    if (!labour || !vendor) {
      return res.status(404).json({ message: "Labour or Vendor user profile database rows not found buddy!" });
    }
    if (!Array.isArray(labour.ratedBy)) {
      labour.ratedBy = [];
    }
    const existingIndex = labour.ratedBy.findIndex(
      r => String(r.vendorId) === String(vendorId)
    );
    if (existingIndex !== -1) {
      labour.ratedBy[existingIndex].rating = rating;
      labour.ratedBy[existingIndex].companyName = vendor.companyName;
      labour.ratedBy[existingIndex].companyLogo = vendor.companyLogo;
      labour.ratedBy[existingIndex].companyLocation = vendor.companyLocation?.city || "";
      labour.ratedBy[existingIndex].ratedAt = new Date();
    } else {
      labour.ratedBy.push({
        vendorId: vendor._id,
        companyName: vendor.companyName,
        companyLogo: vendor.companyLogo,
        companyLocation: vendor.companyLocation?.city || "",
        rating
      });
    }
    const totalRating = labour.ratedBy.reduce(
      (sum, item) => sum + Number(item.rating || 0),
      0
    );
    labour.rating = labour.ratedBy.length > 0
      ? Number((totalRating / labour.ratedBy.length).toFixed(1))
      : 0;
    await labour.save();
    res.json(labour);
  } catch (err) {
    res.status(500).json({ message: "Rating update failed buddy!" });
  }
});

/* ================= 3.3. CREATE PRODUCTION ================= */

app.post("/createProduction", async (req, res) => {
  try {
    const { vendorId, productName, qty, description } = req.body;
    const creator = await User.findById(vendorId);
    if (!creator) return res.status(404).json({ message: "User not found buddy" });
    const mainOwnerId = creator.usedBy || creator._id;
    const newProductionObj = {
      _id: new mongoose.Types.ObjectId(),
      productName, 
      qty: Number(qty), 
      description, 
      images: ["", ""], 
      likedBy: [], 
      comments: [],
      createdAt: new Date()
    };
    await User.updateMany(
      { 
        $or: [
          { _id: mainOwnerId }, 
          { usedBy: mainOwnerId, subRole: { $exists: true, $ne: "" } }
        ] 
      },
      { 
        $push: { productionData: { $each: [newProductionObj], $position: 0 } } 
      }
    );
    const updatedUser = await User.findById(vendorId);
    res.json(updatedUser);
  } catch (err) {
    res.status(500).json({ message: "Production creation failed" });
  }
});

/* ================= 3.5. HANDLE LIKE/UNLIKE (With Role) ================= */

app.post("/handleProductionLike/:prodId", async (req, res) => {
  try {
    const { prodId } = req.params;
    const { vendorId, userId, subRole } = req.body;
    const user = await User.findById(vendorId);
    const prod = user.productionData.id(prodId);
    const alreadyLikedIndex = prod.likedBy.findIndex(l => l.userId.toString() === userId);
    if (alreadyLikedIndex === -1) {
      prod.likedBy.push({ userId, subRole });
    } else {
      prod.likedBy.splice(alreadyLikedIndex, 1);
    }
    await user.save();
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Like failed" });
  }
});

/* ================= 3.6. ADD COMMENT ================= */

app.post("/addProductionComment/:prodId", async (req, res) => {
  try {
    const { prodId } = req.params;
    const { vendorId, userId, subRole, text, userName, userPic, commentId } = req.body;
    const user = await User.findById(vendorId);
    if (!user) return res.status(404).json({ message: "Vendor not found buddy!" });
    const prod = user.productionData.id(prodId);
    if (!prod) return res.status(404).json({ message: "Product not found buddy!" });
    if (commentId) {
      const existingComment = prod.comments.id(commentId);
      if (existingComment) {
        existingComment.text = text;
        if (subRole) existingComment.subRole = subRole; // role update optional
      } else {
        return res.status(404).json({ message: "Comment array index mismatch!" });
      }
    } else {
      prod.comments.push({
        userId,
        subRole,
        text,
        userName,
        userPic
      });
    }
    await user.save();
    res.json(user);
  } catch (err) {
    console.error("Crash Error details:", err);
    res.status(500).json({ message: "Comment failed", error: err.message });
  }
});

/* ================= 3.7. UPLOAD PRODUCTION IMAGE ================= */

app.post("/uploadProductionImage", upload.single("image"), async (req, res) => {
  try {
    const { prodId, imgIndex, vendorId } = req.body;
    if (!req.file) {
      return res.status(400).json({ msg: "No file uploaded" });
    }
    const creator = await User.findById(vendorId);
    if (!creator) {
      return res.status(404).json({ msg: "User not found buddy" });
    }
    const mainOwnerId = creator.usedBy || creator._id;
    const prodObjectId = new mongoose.Types.ObjectId(prodId);
    const imageKey = `productionData.$[prod].images.${imgIndex}`;
    await User.updateMany(
      {
        $or: [
          { _id: mainOwnerId },
          { usedBy: mainOwnerId, subRole: { $exists: true, $ne: "" } }
        ],
        "productionData._id": prodObjectId
      },
      {
        $set: { [imageKey]: req.file.filename }
      },
      {
        arrayFilters: [{ "prod._id": prodObjectId }]
      }
    );
    const updatedUser = await User.findById(vendorId);
    res.json({ productionData: updatedUser.productionData });
  } catch (err) {
    console.log(err);
    res.status(500).json({ msg: "Upload failed" });
  }
});

/* ================= 3.8. CREATE MATERIAL ================= */

app.post("/createMaterial", upload.array('images', 2), async (req, res) => {
  try {
    const { vendorId, productName, qty, description } = req.body;
    const fileNames = req.files ? req.files.map(f => f.filename) : [];
    const creator = await User.findById(vendorId);
    if (!creator) return res.status(404).json({ message: "User not found buddy!" });
    const mainOwnerId = creator.usedBy || creator._id;
    const newMaterialObj = {
      _id: new mongoose.Types.ObjectId(),
      productName, 
      qty: Number(qty), 
      description, 
      images: fileNames, 
      createdAt: new Date()
    };
    await User.updateMany(
      { 
        $or: [
          { _id: mainOwnerId }, 
          { usedBy: mainOwnerId, subRole: { $exists: true, $ne: "" } }
        ] 
      },
      { 
        $push: { materialData: { $each: [newMaterialObj], $position: 0 } } 
      }
    );
    const updatedUser = await User.findById(vendorId);
    res.json({ materialData: updatedUser.materialData });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Material creation failed buddy!" });
  }
});

/* ================= 3.9. OVERWRITE MATERIAL ================= */

app.put("/updateMaterial/:matId", async (req, res) => {
  try {
    const { vendorId, ...updateFields } = req.body; 
    const creator = await User.findById(vendorId);
    if (!creator) return res.status(404).send("User not found buddy");
    const mainOwnerId = creator.usedBy || creator._id;
    const matObjectId = new mongoose.Types.ObjectId(req.params.matId);
    const setQuery = {};
    for (const key in updateFields) {
      setQuery[`materialData.$[mat].${key}`] = updateFields[key];
    }
    await User.updateMany(
      { 
        $or: [
          { _id: mainOwnerId }, 
          { usedBy: mainOwnerId, subRole: { $exists: true, $ne: "" } }
        ],
        "materialData._id": matObjectId
      },
      { $set: setQuery },
      {
        arrayFilters: [
          { "mat._id": matObjectId }
        ]
      }
    );
    const updatedUser = await User.findById(vendorId);
    res.json({ materialData: updatedUser.materialData });
  } catch (err) {
    res.status(500).send("Update error");
  }
});

/* ================= 3.10.CREATE EMPTY MATERIAL (Direct Card) ================= */

app.post("/createEmptyMaterial", async (req, res) => {
  try {
    const { vendorId } = req.body;
    const creator = await User.findById(vendorId);
    if (!creator) return res.status(404).json({ message: "User not found buddy!" });
    const mainOwnerId = creator.usedBy || creator._id;
    const sharedMatId = new mongoose.Types.ObjectId();
    const newEmptyMaterial = {
      _id: sharedMatId,
      productName: "New Product", 
      qty: 0, 
      description: "", 
      images: ["", ""], 
      createdAt: new Date()
    };
    await User.updateMany(
      { 
        $or: [
          { _id: mainOwnerId }, 
          { usedBy: mainOwnerId, subRole: { $exists: true, $ne: "" } }
        ] 
      },
      { 
        $push: { materialData: { $each: [newEmptyMaterial], $position: 0 } } 
      }
    );
    const updatedUser = await User.findById(vendorId);
    res.json({ materialData: updatedUser.materialData });
  } catch (err) {
    res.status(500).json({ message: "Failed to create card buddy!" });
  }
});

/* ================= 3.11. UPLOAD MATERIAL IMAGE ================= */

app.post("/uploadMaterialImage", upload.single("image"), async (req, res) => {
  try {
    const { matId, imgIndex, vendorId } = req.body;
    if (!req.file) {
      return res.status(400).json({ msg: "No file uploaded" });
    }
    const creator = await User.findById(vendorId);
    if (!creator) {
      return res.status(404).json({ msg: "User not found buddy" });
    }
    const mainOwnerId = creator.usedBy || creator._id;
    const matObjectId = new mongoose.Types.ObjectId(matId);
    const imageKey = `materialData.$[mat].images.${imgIndex}`;
    await User.updateMany(
      {
        $or: [
          { _id: mainOwnerId },
          { usedBy: mainOwnerId, subRole: { $exists: true, $ne: "" } }
        ],
        "materialData._id": matObjectId
      },
      {
        $set: { [imageKey]: req.file.filename }
      },
      {
        arrayFilters: [{ "mat._id": matObjectId }]
      }
    );
    const updatedUser = await User.findById(vendorId);
    res.json({ materialData: updatedUser.materialData });
  } catch (err) {
    console.log(err);
    res.status(500).json({ msg: "Upload failed" });
  }
});

/* ================= 3.12. DELETE MATERIAL ================= */

app.delete("/deleteMaterial/:vendorId/:matId", async (req, res) => {
  try {
    const { vendorId, matId } = req.params;
    const currentUser = await User.findById(vendorId);
    if (!currentUser) return res.status(404).json({ message: "User not found buddy!" });
    const mainOwnerId = currentUser.usedBy || currentUser._id;
    const matObjectId = new mongoose.Types.ObjectId(matId);
    await User.updateMany(
      { 
        $or: [
          { _id: mainOwnerId }, 
          { usedBy: mainOwnerId }
        ] 
      },
      { 
        $pull: { materialData: { _id: matObjectId } } 
      }
    );
    await User.updateMany(
      { "supplyData.materialId": matObjectId },
      { $pull: { supplyData: { materialId: matObjectId } } }
    );
    await User.updateMany(
      { "importData.materialId": matObjectId },
      { $pull: { importData: { materialId: matObjectId } } }
    );
    await User.updateMany(
      { "projectData.materialStock.materialId": matObjectId },
      { $pull: { "projectData.$[].materialStock": { materialId: matObjectId } } }
    );
    const updatedUser = await User.findById(vendorId);
    res.json({ 
      success: true,
      message: "Material deleted everywhere perfectly buddy! 🗑️",
      materialData: updatedUser.materialData || [] 
    });
  } catch (err) {
    res.status(500).json({ message: "Delete failed buddy!" });
  }
});

/* ================= 3.13 DELETE PRODUCTION (GLOBAL SYSTEM SYNC) ================= */

app.delete("/deleteProduction/:vendorId/:prodId", async (req, res) => {
  try {
    const { vendorId, prodId } = req.params;
    const currentUser = await User.findById(vendorId);
    if (!currentUser) return res.status(404).json({ message: "User not found buddy!" });
    const mainOwnerId = currentUser.usedBy || currentUser._id;
    const prodObjectId = new mongoose.Types.ObjectId(prodId);
    await User.updateMany(
      { 
        $or: [
          { _id: mainOwnerId }, 
          { usedBy: mainOwnerId }
        ] 
      },
      { 
        $pull: { productionData: { _id: prodObjectId } } 
      }
    );
    await User.updateMany(
      { "supplyData.materialId": prodObjectId },
      { $pull: { supplyData: { materialId: prodObjectId } } }
    );
    await User.updateMany(
      { "importData.materialId": prodObjectId },
      { $pull: { importData: { materialId: prodObjectId } } }
    );
    await User.updateMany(
      { "projectData.materialStock.materialId": prodObjectId },
      { $pull: { "projectData.$[].materialStock": { materialId: prodObjectId } } }
    );
    const updatedUser = await User.findById(vendorId);
    res.json({ 
      success: true, 
      message: "Production deleted everywhere buddy! 🗑️",
      productionData: updatedUser.productionData || [] 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Delete production failed buddy!" });
  }
});

/* ================= 3.14. PRIVATE / PUBLIC PROJECTS ================= */

app.post("/toggleEnterprisePost/:vendorId/:projectId", async (req, res) => {
  try {
    const { vendorId, projectId } = req.params;
    const { feedDescription } = req.body;
    const user = await User.findById(vendorId);
    if (!user) return res.status(404).json({ msg: "Vendor account not found" });
    const projectIndex = user.projectData.findIndex(p => String(p._id) === String(projectId));
    if (projectIndex === -1) return res.status(404).json({ msg: "Project not found inside this profile" });
    const currentStatus = user.projectData[projectIndex].isPublic || false;
    const nextStatus = !currentStatus;
    user.projectData[projectIndex].isPublic = nextStatus;
    user.projectData[projectIndex].postedAt = nextStatus ? new Date() : null;
    user.projectData[projectIndex].feedDescription = nextStatus ? (feedDescription || "") : "";
    user.markModified("projectData");
    await user.save();
    res.json({ 
      msg: nextStatus ? "Project went public successfully" : "Retracted to private mode",
      projects: user.projectData 
    });
  } catch (err) {
    console.error("TOGGLE POST CONTROLLER ERROR:", err);
    res.status(500).json({ msg: "Failed to toggle feed post status" });
  }
});

/* ================= 4.1. CREATE PROJECT ================= */

app.post("/createProject", upload.single("cover"), async (req, res) => {
  try {
    const { vendorId, projectName, location, about, propertyOwners, supportSources } = req.body;
    const user = await User.findById(vendorId);
    if (!user) return res.status(404).json({ msg: "User not found" });
    const parsedLocation = location ? (typeof location === "string" ? JSON.parse(location) : location) : {};
    const rawOwners = propertyOwners ? JSON.parse(propertyOwners) : [];
    const formattedOwners = rawOwners.map(owner => ({
      _id: owner.id || owner._id,
      name: owner.name,
      phone: owner.phone,
      logo: owner.logo,
      role: owner.role,
      inProject: false, 
      inLabour: false 
    }));
    const rawSupport = supportSources ? JSON.parse(supportSources) : [];
    const formattedSupport = rawSupport.map(sup => ({
      _id: sup.id || sup._id,
      name: sup.name,
      phone: sup.phone,
      logo: sup.logo,
      role: sup.role,
      inProject: false,
      inLabour: false
    }));
    const newProject = {
      projectName,
      cover: req.file ? req.file.filename : "",
      propertyOwners: formattedOwners,
      propertyDetails: {
        location: parsedLocation,
        about: about || ""
      },
      supportSources: formattedSupport,
      projectLabour: [],
      taskMedia: [],
      createdAt: new Date(),
      status: "onprogress" ,
      isPublic: false
    };
    user.projectData.push(newProject);
    await user.save();
    // 🎯 Indha dynamic ID dhaan ippo custom user nodes layout syncing-ku mukkiyam
    const createdProject = user.projectData[user.projectData.length - 1];
    const createdProjectId = createdProject._id;
    createdProject.projectId = createdProjectId;
    await user.save();
    // ==========================================
    // 🏠 1. SYNC TO PROPERTY OWNERS COLLECTION
    // ==========================================
    for (let owner of formattedOwners) {
      const ownerDoc = await User.findById(owner._id);
      if (ownerDoc) {
        if (!ownerDoc.projectData) ownerDoc.projectData = [];
        const exists = ownerDoc.projectData.some(p => String(p.projectId) === String(createdProjectId));
        if (!exists) {
          ownerDoc.projectData.push({
            projectId: createdProjectId,
            projectName: projectName,
            cover: req.file ? req.file.filename : "",
            propertyDetails: {
              location: parsedLocation,
              about: about || ""
            },
            propertyOwners: formattedOwners,
            supportSources: formattedSupport,
            projectLabour: [],
            inProject: true
          });
          await ownerDoc.save();
        }
        const ownerEmployees = await User.find({
          usedBy: owner._id,
          isActiveForVendor: true,
          role: { $ne: "labour" }
        });

        for (let emp of ownerEmployees) {
          const empProjExists = emp.projectData?.some(p => String(p.projectId) === String(createdProjectId));
          if (!empProjExists) {
            emp.projectData.push({
              projectId: createdProjectId,
              projectName: projectName,
              cover: req.file ? req.file.filename : "",
              propertyDetails: {    
                location: parsedLocation,
                about: about || ""
              },
              propertyOwners: formattedOwners, 
              supportSources: formattedSupport,
              projectLabour: [],
              inProject: true 
            });
            await emp.save();
          }
        }
      }
    }
    // ==========================================
    // 🤝 2. SYNC TO SUPPORT SOURCES COLLECTION
    // ==========================================
    for (let support of formattedSupport) {
      const supportDoc = await User.findById(support._id);
      if (supportDoc) {
        if (!supportDoc.projectData) supportDoc.projectData = [];
        const exists = supportDoc.projectData.some(p => String(p.projectId) === String(createdProjectId));
        if (!exists) {
          supportDoc.projectData.push({
            projectId: createdProjectId,
            projectName: projectName,
            cover: req.file ? req.file.filename : "",
            propertyDetails: {
              location: parsedLocation,
              about: about || ""
            },
            propertyOwners: formattedOwners, 
            supportSources: formattedSupport,
            projectLabour: [],
            inProject: false
          });
          await supportDoc.save();
        }
        const supportEmployees = await User.find({
          usedBy: support._id,
          isActiveForVendor: true,
          role: { $ne: "labour" }
        });

        for (let emp of supportEmployees) {
          const empProjExists = emp.projectData?.some(p => String(p.projectId) === String(createdProjectId));
          if (!empProjExists) {
            emp.projectData.push({
              projectId: createdProjectId,
              projectName: projectName,
              cover: req.file ? req.file.filename : "",
              propertyDetails: {    
                location: parsedLocation,
                about: about || ""
              },
              propertyOwners: formattedOwners, 
              supportSources: formattedSupport,
              projectLabour: [],
              inProject: false 
            });
            await emp.save();
          }
        }
      }
    }
    // ==========================================
    // 👷‍♂️ 3. SYNC TO EMPLOYEES (EXISTING NEW CODE)
    // ==========================================
    const employees = await User.find({
      usedBy: vendorId,
      isActiveForVendor: true,
      role: { $ne: "labour" }
    });

    for (let emp of employees) {
      const exists = emp.projectData?.some(
        p => String(p.projectId) === String(createdProject._id)
      );
      if (!exists) {
        emp.projectData.push({
          projectId: createdProject._id,
          projectName: createdProject.projectName,
          cover: req.file ? req.file.filename : "",
          propertyDetails: {    
            location: parsedLocation,
            about: about || ""
          },
          propertyOwners: formattedOwners, 
          supportSources: formattedSupport,
          projectLabour: [],
          inProject: true 
        });
      }
      await emp.save();
    }
    // 🔔 4. DISPATCH NOTIFICATION BULK LOOP FOR FRESH PROJECT
    const projectRecipients = await User.find({ "projectData.projectId": createdProjectId });
    for (let targetUser of projectRecipients) {
      if (String(targetUser._id) !== String(vendorId)) { 
        await triggerNotification({
          recipientId: targetUser._id,
          senderId: vendorId,
          senderName: user.companyName || user.name,
          senderPic: user.companyLogo || user.profilePic || "",
          type: "project_assigned",
          title: "📁 New Project Assigned",
          message: `${user.companyName || user.name} created the new project "${projectName}".`,
          projectId: createdProjectId
        });
      }
    }
    // Frontend component dynamic loading state error prevent panna explicit mapping setup update response tharom
    const updatedUser = await User.findById(vendorId)
      .populate("projectData.propertyOwners._id")
      .populate("projectData.supportSources._id");
    res.json({ projects: updatedUser.projectData });
  } catch (err) {
    console.log("CREATE ERROR:", err);
    res.status(500).json({ msg: "Create project failed" });
  }
});

/* ================= 4.2. GET PROJECTS ================= */

app.get("/getProjects/:vendorId", async (req, res) => {
  try {
    const user = await User.findById(req.params.vendorId);
    if (!user) {
      return res.status(404).json({ msg: "User not found" });
    }
    let projectsUpdated = false;
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (user.projectData && user.projectData.length > 0) {
      user.projectData.forEach(project => {
        if (project.isPublic && project.postedAt && new Date(project.postedAt) < twentyFourHoursAgo) {
          project.isPublic = false;
          project.postedAt = null;
          project.feedDescription = "";
          projectsUpdated = true;
        }
      });
    }
    if (projectsUpdated) {
      user.markModified("projectData");
      await user.save();
      console.log(`⏳ Auto-retracted expired public projects for vendor: ${req.params.vendorId}`);
    }
    res.json({ projects: user.projectData || [] });
  } catch (err) {
    console.log(err);
    res.status(500).json({ msg: "Fetch failed" });
  }
});

/* ================= 4.3. GET SINGLE PROJECTS ================= */

app.get("/getSingleProject/:projectId", async (req, res) => {
  try {
    const user = await User.findOne({ "projectData._id": req.params.projectId });
    if (!user) return res.status(404).json({ msg: "Project not found" });
    const project = user.projectData.id(req.params.projectId);
    res.json(project);
  } catch (err) {
    res.status(500).json({ msg: "Server Error" });
  }
});

/* ================= 4.4. UPDATE PROJECT ================= */

app.put("/updateProject/:projectId", async (req, res) => {
  try {
    const { projectName, propertyDetails, propertyOwners, supportSources, cover } = req.body;
    
    const user = await User.findOneAndUpdate(
      { "projectData._id": req.params.projectId },
      { 
        $set: { 
          "projectData.$.projectName": projectName,
          "projectData.$.cover": cover,
          "projectData.$.propertyDetails.about": propertyDetails?.about,
          "projectData.$.propertyDetails.location": propertyDetails?.location,
          "projectData.$.propertyOwners": propertyOwners,
          "projectData.$.supportSources": supportSources
        }
      },
      { returnDocument: "after" }
    );

    const updatedProject = user.projectData.id(req.params.projectId);
    res.json(updatedProject);
  } catch (err) {
    res.status(500).json({ msg: "Update failed" });
  }
});

/* ================= 4.5. SEARCH USER ================= */

app.get("/searchUser", async (req, res) => {
  const { phone } = req.query;
  try {
    // Phone number partial match panna regex use pannalaam
    const users = await User.find({ 
      phone: { $regex: phone, $options: "i" } 
    }).limit(3);
    res.json(users);
  } catch (err) {
    res.status(500).json({ msg: "Search failed" });
  }
});

/* ================= 4.6. DELETE PROJECT ================= */

app.delete("/deleteProject/:vendorId/:projectId", async (req, res) => {
  try {
    const { vendorId, projectId } = req.params;
    const user = await User.findById(vendorId);
    if (!user) return res.status(404).json({ msg: "User not found" });
    const projectToDelete = user.projectData.find(
      p => String(p._id) === String(projectId)
    );
    user.projectData = user.projectData.filter(
      p => String(p._id) !== String(projectId)
    );
    await user.save();
    /* ================= VENDOR EMPLOYEES ================= */
    const employees = await User.find({
      usedBy: vendorId,
      isActiveForVendor: true
    });
    for (let emp of employees) {
      if (emp.role === 'labour') {
        emp.projectData = emp.projectData.map(p => {
          if (String(p.projectId || p._id) === String(projectId)) {
            p.projectLabour = p.projectLabour?.map(lab => ({ ...lab, inLabour: false })) || [];
          }
          return p;
        });
        await emp.save();
        continue;
      }
      emp.projectData = emp.projectData.filter(
        p => String(p.projectId || p._id) !== String(projectId)
      );
      await emp.save();
    }
    /* ================= PROPERTY OWNERS & THEIR EMPLOYEES ================= */
    if (projectToDelete?.propertyOwners?.length > 0) {
      for (let owner of projectToDelete.propertyOwners) {
        const ownerDoc = await User.findById(owner._id);
        if (ownerDoc) {
          ownerDoc.projectData = ownerDoc.projectData.filter(
            p => String(p.projectId || p._id) !== String(projectId)
          );
          await ownerDoc.save();
          const ownerEmployees = await User.find({
            usedBy: owner._id,
            isActiveForVendor: true
          });
          for (let emp of ownerEmployees) {
            if (emp.role === 'labour') {
              emp.projectData = emp.projectData.map(p => {
                if (String(p.projectId || p._id) === String(projectId)) {
                  p.projectLabour = p.projectLabour?.map(lab => ({ ...lab, inLabour: false })) || [];
                }
                return p;
              });
              await emp.save();
              continue;
            }
            emp.projectData = emp.projectData.filter(
              p => String(p.projectId || p._id) !== String(projectId)
            );
            await emp.save();
          }
        }
      }
    }
    /* ================= SUPPORT SOURCES & THEIR EMPLOYEES ================= */
    if (projectToDelete?.supportSources?.length > 0) {
      for (let sup of projectToDelete.supportSources) {
        const supDoc = await User.findById(sup._id);
        if (supDoc) {
          supDoc.projectData = supDoc.projectData.filter(
            p => String(p.projectId || p._id) !== String(projectId)
          );
          await supDoc.save();
          const supEmployees = await User.find({
            usedBy: sup._id,
            isActiveForVendor: true
          });
          for (let emp of supEmployees) {
            if (emp.role === 'labour') {
              emp.projectData = emp.projectData.map(p => {
                if (String(p.projectId || p._id) === String(projectId)) {
                  p.projectLabour = p.projectLabour?.map(lab => ({ ...lab, inLabour: false })) || [];
                }
                return p;
              });
              await emp.save();
              continue;
            }
            emp.projectData = emp.projectData.filter(
              p => String(p.projectId || p._id) !== String(projectId)
            );
            await emp.save();
          }
        }
      }
    }
    res.json({ projects: user.projectData });
  } catch (err) {
    console.log(err);
    res.status(500).json({ msg: "Delete failed" });
  }
}); 

/* ================= 4.7. MARK PROJECT COMPLETED ================= */

app.put("/updateProjectStatus", async (req, res) => {
  try {
    const { projectIds, status, vendorId } = req.body;
    const user = await User.findById(vendorId);
    user.projectData.forEach(p => {
      if (projectIds.includes(p._id.toString())) {
        p.status = status;
      }
    });
    await user.save();
    if (status === "completed") {
      const labours = await User.find({
        role: "labour",
        "projectData.projectId": { $in: projectIds }
      });
      for (let labour of labours) {
        for (let projectId of projectIds) {
          await User.findByIdAndUpdate(labour._id, {
            $pull: { projectData: { projectId: projectId } },
          });
        }
      }
    }
    const updatedUser = await User.findById(vendorId);
    res.json({ projects: updatedUser.projectData });
  } catch (err) {
    res.status(500).json({ msg: "Error" });
  }
});

/* ================= 4.8. PROJECT EMPLOYEES ================= */

app.get("/getProjectEmployees/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params;
    const projectOwner = await User.findOne({
      projectData: {
        $elemMatch: {
          projectId: projectId,
          inProject: true
        }
      },
      role: "company"
    });
    if (!projectOwner) {
      return res.json([]);
    }
    const vendorId = projectOwner._id;
    const employees = await User.find({
      $or: [
        { _id: vendorId }, 
        { usedBy: vendorId, isActiveForVendor: true } 
      ],
      role: { $ne: "labour" }
    });
    const finalEmployees = employees.filter(emp =>
      emp.projectData?.some(p =>
        String(p.projectId) === String(projectId) &&
        p.inProject === true
      )
    );
    res.json(finalEmployees);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Failed to fetch project employees" });
  }
});

/* ================= 4.9. REMOVE EMPLOYEE FROM PROJECT ================= */

app.put("/removeEmployeeFromProject/:projectId", async (req, res) => {
  const { projectId } = req.params;
  const { empId } = req.body;
  try {
    const project = await Project.findByIdAndUpdate(
      projectId,
      { $pull: { assignedEmployees: empId } }, // Array-la irundhu pull (remove) pannum
      { returnDocument: "after" }
    );
    res.json({ message: "Removed from project", project });
  } catch (err) {
    res.status(500).json(err);
  }
});

/* ================= 4.10. UPDATE EMPLOYEE IN PROJECT ================= */

app.put("/updateEmployeeProjectStatus", async (req, res) => {
  const { empId, projectId, status, projectName } = req.body;
  try {
    const user = await User.findById(empId);
    if (!user) return res.status(404).json({ msg: "User not found" });
    // check project exists
    const projectIndex = user.projectData?.findIndex(
      p => String(p.projectId) === String(projectId)
    );
    // 🔥 CASE 1: PROJECT EXISTS → UPDATE
    if (projectIndex !== -1) {
      user.projectData[projectIndex].inProject = status;
    } 
    // 🔥 CASE 2: PROJECT NOT EXISTS → ADD
    else {
      user.projectData.push({
        projectId,
        projectName,
        inProject: true
      });
    }
    await user.save();
    res.json({ msg: "Updated Successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server error" });
  }
});

/* ================= 4.11. PROJECT LABOURS ================= */

app.get("/getMyLabours/:vendorId/:projectId", async (req, res) => {
  try {
    const { vendorId, projectId } = req.params;
    const labours = await User.find({ 
      role: "labour", 
      isActiveForVendor: true,
      $or: [
        { usedBy: vendorId },
        { "projectData.projectId": projectId }
      ]
    });
    res.json(labours);
  } catch (err) {
    res.status(500).json({ msg: "Failed to fetch labours" });
  }
});

/* ================= 4.12. ASSIGN PROJECT LABOURS ================= */

app.put("/assignLabourToProject/:id", async (req, res) => {
  const { projectId, projectName, pActualInTime, pActualOutTime, potStartTime, potEndTime, inLabour } = req.body;
  try {
    const labourId = req.params.id;
    const user = await User.findById(labourId);
    if (!user) return res.status(404).json({ msg: "Labour not found buddy!" });
    const todayStr = new Date().toISOString().split('T')[0];
    if (user.projectData && user.projectData.length > 0) {
      user.projectData.forEach(p => {
        if (p.projectLabour) {
          p.projectLabour.forEach(entry => {
            if (String(entry.labourId) === String(labourId)) {
              entry.inLabour = false;
            } 
          });
        }
      });
    }
    const newAttendanceEntry = {
      labourId: labourId,       
      labourName: user.name || "Labour",
      inLabour: true,
      pActualInTime: pActualInTime || "--:--",
      pActualOutTime: pActualOutTime || "--:--",
      potStartTime: potStartTime || "--:--",
      potEndTime: potEndTime || "--:--",
      assignedAt: new Date().toISOString(),
      date: todayStr
    };
    const existingProjectIndex = user.projectData.findIndex(
      p => String(p.projectId || p._id) === String(projectId)
    );
    if (existingProjectIndex !== -1) {
      user.projectData[existingProjectIndex].projectName = projectName;
      user.projectData[existingProjectIndex].projectLabour = user.projectData[existingProjectIndex].projectLabour.filter(
        entry => String(entry.labourId) !== String(labourId)
      );
      user.projectData[existingProjectIndex].projectLabour.push(newAttendanceEntry);
    } else {
      user.projectData.push({
        projectId: projectId,
        projectName: projectName,
        projectLabour: [newAttendanceEntry]
      });
    }
    user.currentProjectName = projectName;
    user.assignType = "project";
    user.attendanceStatus = "OUT";
    user.actualInTime = pActualInTime || "--:--";
    user.actualOutTime = pActualOutTime || "--:--";
    user.otStartTime = potStartTime || "--:--";
    user.otEndTime = potEndTime || "--:--";
    user.overtime = false;
    user.lastUpdateDate = todayStr;
    await user.save();
    await User.updateMany(
      { _id: { $ne: labourId } },
      { $set: { "projectData.$[].projectLabour.$[labourElem].inLabour": false } },
      { arrayFilters: [ { "labourElem.labourId": labourId } ] }
    );
    await User.updateMany(
      { _id: { $ne: labourId } },
      { $pull: { "projectData.$[elem].projectLabour": { labourId: labourId } } },      
      { arrayFilters: [ { $or: [{ "elem.projectId": projectId }, { "elem._id": projectId }] } ] }
    );
    await User.updateMany(
      { _id: { $ne: labourId } },
      { $push: { "projectData.$[elem].projectLabour": newAttendanceEntry } },
      { arrayFilters: [ { $or: [{ "elem.projectId": projectId }, { "elem._id": projectId }] } ] }
    );
    res.json({ msg: "Labour assigned successfully buddy!", data: user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Assign failed" });
  }
});

/* ================= 4.13. REMOVE PROJECT LABOUR ================= */

app.put("/removeLabourFromProject/:labourId", async (req, res) => {
  const { projectId } = req.body;
  const labourId = req.params.labourId;
  try {
    await User.findOneAndUpdate(
      {
        _id: labourId,
        "projectData.projectId": projectId
      },
      {
        $set: {
          "projectData.$[].projectLabour.$[].inLabour": false,
          attendanceStatus: "OUT",
          currentProjectName: "",
          pActualInTime: "--:--",
          pActualOutTime: "--:--",
          potStartTime: "--:--",
          potEndTime: "--:--"
        }
      }
    );
    await User.updateMany(
      { "projectData.projectId": projectId },
      {
        $set: {
          "projectData.$[elem].projectLabour.$[labourElem].inLabour": false
        }
      },
      {
        arrayFilters: [
          { "elem.projectId": projectId },
          { "labourElem.labourId": labourId } 
        ]
      }
    );
    res.json({ msg: "Labour removed (soft) from project buddy!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Remove failed" });
  }
});

/* ================= 4.14. PROJECT LABOUR ATTENDANCE ================= */

app.put("/projectLabourAttendance/:id", async (req, res) => {
  const { status, time, projectId, action } = req.body;
  try {
    const labourId = req.params.id;
    const user = await User.findById(labourId);
    if (!user) return res.status(404).json({ msg: "Labour not found buddy!" });
    const currentDailyWage = parseFloat(user.amount || 0);
    const hourlyOTRate = parseFloat(user.overtimeAmount || 0);
    const today = new Date().toISOString().split("T")[0];
    const currentVendorId = user.usedBy ? String(user.usedBy) : String(user._id);
    const project = user.projectData.find(
      p => String(p.projectId || p._id) === String(projectId)
    );
    if (!project) {
      return res.status(404).json({ msg: "Project not found" });
    }
    const projectLabour = project.projectLabour.find(
      pl => String(pl.labourId) === String(labourId) && (pl.inLabour === true || pl.inLabour === "true")
    );
    if (user.lastUpdateDate !== today && projectLabour) {
      user.actualInTime = "--:--";
      user.actualOutTime = "--:--";
      user.otStartTime = "--:--";
      user.otEndTime = "--:--";
      user.overtime = false;
      user.attendanceStatus = "OUT"; 
      projectLabour.pActualInTime = "--:--";
      projectLabour.pActualOutTime = "--:--";
      projectLabour.potStartTime = "--:--";
      projectLabour.potEndTime = "--:--";
    }
    if (status === "IN" && !action) {
      if (projectLabour) projectLabour.pActualInTime = time;
      user.attendanceStatus = "IN";
      user.actualInTime = time;
      await Attendance.findOneAndUpdate(
        { labourId: user._id, date: today },
        {
          $set: {
            labourId: user._id,
            projectId: projectId,
            vendorId: currentVendorId,
            date: today,
            dailyWage: currentDailyWage,
            totalPay: currentDailyWage + (user.otPay || 0),
            actualInTime: time
          }
        },
        { upsert: true, returnDocument: 'after' }
      );
    }
    if (status === "OUT" && !action) {
      if (projectLabour) projectLabour.pActualOutTime = time;
      user.attendanceStatus = "OUT";
      user.actualOutTime = time;
      await Attendance.findOneAndUpdate(
        { labourId: user._id, date: today },
        {
          $set: {
            actualOutTime: time,
            dailyWage: currentDailyWage
          }
        },
        { upsert: true, returnDocument: 'after' }
      );
    }
    if (action === "OT_START") {
      if (projectLabour) {
        projectLabour.potStartTime = time;
        projectLabour.pActualOutTime = time;
      }
      user.overtime = true;
      user.otStartTime = time;
      user.attendanceStatus = "OUT";
      user.actualOutTime = time;
      await Attendance.findOneAndUpdate(
        { labourId: user._id, date: today },
        {
          $set: {
            otStartTime: time,
            actualOutTime: time
          }
        },
        { upsert: true, new: true }
      );
    }
    if (action === "OT_STOP") {
      if (projectLabour) projectLabour.potEndTime = time;
      user.overtime = false;
      user.otEndTime = time;
      user.attendanceStatus = "OUT";
      const existingAttendance = await Attendance.findOne({ labourId: user._id, date: today });
      const otStartStr = existingAttendance?.otStartTime || user.otStartTime || (projectLabour ? projectLabour.potStartTime : "--:--");
      let finalOTPay = 0;
      if (otStartStr && otStartStr !== "--:--") {
        try {
          const [startHours, startMinutes] = otStartStr.split(/[: ]/);
          const [endHours, endMinutes] = time.split(/[: ]/);
          let sH = parseInt(startHours);
          let eH = parseInt(endHours);
          if (otStartStr.toLowerCase().includes("pm") && sH !== 12) sH += 12;
          if (otStartStr.toLowerCase().includes("am") && sH === 12) sH = 0;
          if (time.toLowerCase().includes("pm") && eH !== 12) eH += 12;
          if (time.toLowerCase().includes("am") && eH === 12) eH = 0;
          const startTimeInMinutes = sH * 60 + parseInt(startMinutes);
          const endTimeInMinutes = eH * 60 + parseInt(endMinutes);
          let diffMinutes = endTimeInMinutes - startTimeInMinutes;
          if (diffMinutes < 0) diffMinutes += 24 * 60;
          const totalHours = diffMinutes / 60;
          if (totalHours >= 1) {
            finalOTPay = Math.round(totalHours * hourlyOTRate);
          }
        } catch (calcErr) {
          console.error("Project OT Calculation crash buddy", calcErr);
        }
      }
      await Attendance.findOneAndUpdate(
        {
          labourId: user._id,
          date: today
        },
        {
          $set: {
            labourId: user._id,
            projectId: projectId,
            vendorId: user.usedBy ? String(user.usedBy) : String(user._id),
            date: today,
            dailyWage: currentDailyWage,
            otPay: finalOTPay,
            totalPay: currentDailyWage + finalOTPay,
            actualInTime: user.actualInTime,
            actualOutTime: user.actualOutTime,
            otStartTime: otStartStr,
            otEndTime: time
          }
        },
        { 
          upsert: true, 
          returnDocument: 'after'
        }
      );
    }
    user.lastUpdateDate = today;
    user.markModified("projectData");
    await user.save();
    res.json({ msg: "Project Attendance updated perfectly without duplicate entries buddy!" });
  } catch (err) {
    console.error("Project Attendance Error:", err);
    res.status(500).json({ msg: "Error updating attendance" });
  }
});

/* ================= 4.15. GET PROJECT DETAILS LABOUR ATTENDANCE ================= */

app.get("/getProjectDetails/labour/:id", async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid ID format buddy!" });
    }
    const user = await User.findOne({ "projectData._id": new mongoose.Types.ObjectId(id) });
    if (!user) {
      return res.status(404).json({ message: "Project not found in any user profile buddy!" });
    }
    const project = user.projectData.find(p => p._id && p._id.toString() === id);
    res.json(project);
  } catch (err) {
    console.error("Labour Project Details Error:", err);
    res.status(500).json({ message: "Internal Server Error buddy!", error: err.message });
  }
});

/* ================= 4.16. SAVE OR OVERWRITE DAILY WORK STATUS VIEWS ================= */

app.post("/saveDailyTaskMedia", async (req, res) => {
  try {
    const { vendorId, projectId, viewName, url, fileType } = req.body;
    let user = await User.findOne({ "projectData._id": projectId });
    if (!user) {
      user = await User.findById(vendorId);
    }
    if (!user) return res.status(404).json({ msg: "User not found" });
    const project = user.projectData.find(
      p => p._id.toString() === projectId || (p.projectId && p.projectId.toString() === projectId)
    );
    if (!project) return res.status(404).json({ msg: "Project not found" });
    if (!project.taskMedia) project.taskMedia = {};
    const oldMedia = project.taskMedia[viewName];
    if (oldMedia && oldMedia.url && oldMedia.url !== url) {
      const oldFilePath = path.join(__dirname, 'uploads', oldMedia.url);
      fs.access(oldFilePath, fs.constants.F_OK, (err) => {
        if (!err) {
          fs.unlink(oldFilePath, (unlinkErr) => {
            if (unlinkErr) console.error("Old media delete panna mudiyla buddy:", unlinkErr);
            else console.log(`Deleted old file from server: ${oldMedia.url} 🗑️`);
          });
        } else {
          console.log("Old file directory-le illai or already deleted buddy.");
        }
      });
    }
    project.taskMedia[viewName] = { url, fileType };
    user.markModified('projectData'); 
    await user.save();
    // ================= GLOBAL EMPLOYEES & LINKS SYNC OVERWRITE ================= //
    const updatedTaskMedia = project.taskMedia;
    const connectedUsers = await User.find({
      "projectData": {
        $elemMatch: {
          $or: [
            { _id: projectId },
            { projectId: projectId }
          ]
        }
      }
    });
    for (let currentDoc of connectedUsers) {
      let isModified = false;
      currentDoc.projectData = currentDoc.projectData.map(p => {
        const currentProjId = p.projectId ? p.projectId.toString() : p._id.toString();
        if (currentProjId === projectId.toString()) {
          p.taskMedia = updatedTaskMedia;
          isModified = true;
        }
        return p;
      });
      if (isModified) {
        currentDoc.markModified('projectData');
        await currentDoc.save();
      }
    }
    console.log("Saved to DB:", project.taskMedia); // Debug logic
    res.json({ msg: "Updated", data: project.taskMedia });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Server Error" });
  }
});

/* ================= 4.17. ADD / EDIT TASK COMMENT ================= */

app.post("/addTaskMediaComment", async (req, res) => {
  try {
    const { vendorId, projectId, viewName, userId, text, userName, userPic, commentId } = req.body;
    if (!vendorId || !projectId || !viewName) {
      return res.status(400).json({ message: "Missing required fields buddy!" });
    }
    const user = await User.findById(vendorId);
    if (!user) return res.status(404).json({ message: "Vendor not found buddy!" });
    const project = user.projectData.find(p => p._id && p._id.toString() === projectId);
    if (!project) return res.status(404).json({ message: "Project not found in user database!" });
    if (!project.taskMedia) project.taskMedia = {};
    if (!project.taskMedia[viewName]) {
      project.taskMedia[viewName] = { url: "", fileType: "image", likedBy: [], comments: [] };
    }
    const media = project.taskMedia[viewName];
    if (!media.comments) media.comments = [];
    if (commentId) {
      const comment = media.comments.find(c => c._id && c._id.toString() === commentId);
      if (comment) {
        comment.text = text;
      } else {
        return res.status(404).json({ message: "Comment not found to edit!" });
      }
    } else {
      media.comments.push({ _id: new mongoose.Types.ObjectId(), userId, text, userName, userPic });
    }
    user.markModified('projectData'); 
    await user.save();
    res.json({ taskMedia: project.taskMedia });
  } catch (err) {
    console.error("Comment Error:", err);
    res.status(500).json({ message: "Comment failed buddy!", error: err.message });
  }
});

/* ================= 4.18. HANDLE TASK MEDIA LIKE ================= */

app.post("/handleTaskMediaLike", async (req, res) => {
  try {
    const { vendorId, projectId, viewName, userId } = req.body;
    if (!vendorId || !projectId || !viewName || !userId) {
      return res.status(400).json({ message: "Missing required fields buddy!" });
    }
    const user = await User.findById(vendorId);
    if (!user) return res.status(404).json({ message: "Vendor not found buddy!" });
    const project = user.projectData.find(p => p._id && p._id.toString() === projectId);
    if (!project) return res.status(404).json({ message: "Project not found buddy!" });
    if (!project.taskMedia) project.taskMedia = {};
    if (!project.taskMedia[viewName]) {
      project.taskMedia[viewName] = { url: "", fileType: "image", likedBy: [], comments: [] };
    }
    const media = project.taskMedia[viewName];
    if (!media.likedBy) media.likedBy = [];
    const alreadyLikedIndex = media.likedBy.findIndex(l => l.userId && l.userId.toString() === userId);
    if (alreadyLikedIndex === -1) {
      media.likedBy.push({ userId });
    } else {
      media.likedBy.splice(alreadyLikedIndex, 1);
    }
    user.markModified('projectData');
    await user.save();
    res.json({ taskMedia: project.taskMedia });
  } catch (err) {
    console.error("Like Error:", err);
    res.status(500).json({ message: "Like action failed buddy!", error: err.message });
  }
});

/* ================= 4.19. GET USER PROJECT (FETCH FROM DB) ================= */

app.get("/getUserProject/:vendorId/:projectId", async (req, res) => {
  try {
    const { vendorId, projectId } = req.params;
    const user = await User.findById(vendorId);
    if (!user) return res.status(404).json({ message: "Vendor user not found buddy!" });
    const project = user.projectData.find(p => p._id && p._id.toString() === projectId);
    if (!project) return res.status(404).json({ message: "No matching project found!" });
    res.json(project);
  } catch (err) {
    console.error("getUserProject Route Error:", err);
    res.status(500).json({ message: "Internal Server Error buddy!", error: err.message });
  }
});

/* ================= 4.20. GET PROJECT DETAILS (ALTERNATIVE ROUTE) ================= */

app.get("/getProjectDetails/vendor/:vendorId/:projectId", async (req, res) => {
  try {
    const { vendorId, projectId } = req.params;
    const user = await User.findById(vendorId);
    if (!user) return res.status(404).json({ message: "Vendor not found buddy!" });
    const project = user.projectData.find(p => p._id && p._id.toString() === projectId);
    if (!project) return res.status(404).json({ message: "Project detailed block not found!" });
    res.json(project);
  } catch (err) {
    console.error("getProjectDetails Route Error:", err);
    res.status(500).json({ message: "Failed to fetch project detailed metrics", error: err.message });
  }
});

/* ================= 5.1. HOME FEED ================= */

app.get("/getGlobalHomeFeed", async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ msg: "Missing login tracking userId framework context" });
    }
    const currentUser = await User.findById(userId);
    if (!currentUser) {
      return res.status(404).json({ msg: "Current user account reference breakdown context" });
    }
    const userLat = currentUser.propertyDetails?.location?.lat || 13.0827; 
    const userLng = currentUser.propertyDetails?.location?.lng || 80.2707;
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const publicVendorsList = await User.find({
      "projectData.isPublic": true,
      "projectData.postedAt": { $gte: twentyFourHoursAgo }
    }, {
      name: 1, profilePic: 1, role: 1, city: 1, phone: 1, projectData: 1, companyName: 1, companyLogo: 1, companyPhone: 1
    });
    let globalGeoFeed = [];
    function getDistanceInKm(lat1, lon1, lat2, lon2) {
      const R = 6371;
      const dLat = (lat2 - lat1) * (Math.PI / 180);
      const dLon = (lon2 - lon1) * (Math.PI / 180);
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c; 
    }
    publicVendorsList.forEach(vendor => {
      vendor.projectData.forEach(project => {
        if (project.isPublic && project.postedAt && project.postedAt >= twentyFourHoursAgo) {
          const projLat = project.propertyDetails?.location?.lat || userLat;
          const projLng = project.propertyDetails?.location?.lng || userLng;
          const computedDistance = getDistanceInKm(userLat, userLng, projLat, projLng);
          globalGeoFeed.push({
            projectId: project._id,
            projectName: project.projectName,
            feedDescription: project.feedDescription || "",
            taskMedia: project.taskMedia,
            propertyDetails: project.propertyDetails,
            likedByFeed: project.likedByFeed || [],
            savedByFeed: project.savedByFeed || [],
            likeCount: project.likeCount || 0,
            distanceFromUser: computedDistance,
            companyInfo: {
              _id: vendor._id,
              name: vendor.companyName || vendor.name,
              logo: vendor.companyLogo || vendor.profilePic,
              city: project.propertyDetails?.location?.city || vendor.city || "Chennai",
              phone: vendor.companyPhone || vendor.phone || ""
            }
          });
        }
      });
    });
    globalGeoFeed.sort((a, b) => {
      if (a.distanceFromUser !== b.distanceFromUser) {
        return a.distanceFromUser - b.distanceFromUser; 
      }
      return new Date(b.postedAt) - new Date(a.postedAt);
    });
    res.json(globalGeoFeed);
  } catch (err) {
    console.error("GEOSPATIAL RADIAL HOME FEED ENGINE FAILURE:", err);
    res.status(500).json({ msg: "Could not execute proximity network pipeline data arrays" });
  }
});

/* ================= 5.2. HOME FEED ACTIONS ================= */

app.post("/handleFeedAction/:actionType", async (req, res) => {
  try {
    const { actionType } = req.params; // "like" or "save"
    const { vendorId, projectId, currentUserId, currentUserName, feedDescription } = req.body;
    const vendor = await User.findById(vendorId);
    if (!vendor) return res.status(404).json({ msg: "Root company entry invalid" });
    const proj = vendor.projectData.id(projectId);
    if (!proj) return res.status(404).json({ msg: "Project array element out of range buddy" });
    
    // === 🔴 LIKE PIPELINE HANDLING ===
    if (actionType === "like") {
      if (!proj.likedByFeed) proj.likedByFeed = [];
      const index = proj.likedByFeed.findIndex(u => String(u.userId) === String(currentUserId));
      const isVendorHimself = String(vendorId) === String(currentUserId);
      let likingUser;
      if (isVendorHimself) {
        likingUser = vendor;
        } else {
        likingUser = await User.findById(currentUserId);
        if (!likingUser) return res.status(404).json({ msg: "Liking user profile not found buddy" });
      }
      if (!likingUser.likedProjects) likingUser.likedProjects = [];
      const userProjectIndex = likingUser.likedProjects.findIndex(p => String(p.projectId) === String(projectId));
      if (index === -1) {
        proj.likedByFeed.push({ userId: currentUserId, userName: currentUserName });
        proj.likeCount = (proj.likeCount || 0) + 1;
        if (userProjectIndex === -1) {
          likingUser.likedProjects.push({ projectId: projectId, liked: true });
        } else {
          likingUser.likedProjects[userProjectIndex].liked = true;
        }
        // 🔔 FRESH NOTIFICATION INTEGRATION
        if (!isVendorHimself) {
          const associatedUsers = await User.find({ "projectData.projectId": projectId });
          const excludedSupportIds = (proj.supportSources || []).map(sup => String(sup._id || sup.id));
          for (let userNode of associatedUsers) {
            const userIdStr = String(userNode._id);
            if (userIdStr === String(currentUserId)) continue;
            if (userNode.role === "labour") continue;
            if (excludedSupportIds.includes(userIdStr)) continue;
            const isTargetVendor = userIdStr === String(vendorId);
            const isVendorEmployee = String(userNode.usedBy) === String(vendorId);
            if (isTargetVendor || isVendorEmployee) {
              await triggerNotification({
                recipientId: vendorId,              // Project Owner gets the alert
                senderId: currentUserId,           // User who liked
                senderName: currentUserName,       // Explicitly tracking who liked it buddy!
                senderPic: likingUser.profilePic || "", 
                type: "feed_like",
                title: "🔥 Public Feed Liked",
                message: `${currentUserName} left a reaction badge on your public project feed: "${proj.projectName}"`,
                projectId: projectId
              });
            }
          }
        }
      } else {
        proj.likedByFeed.splice(index, 1);
        proj.likeCount = Math.max(0, (proj.likeCount || 1) - 1);
        if (userProjectIndex !== -1) {
          likingUser.likedProjects[userProjectIndex].liked = false;
        }
      }
      if (isVendorHimself) {
        likingUser.markModified("likedProjects");
        vendor.markModified("projectData");
        await vendor.save();
      } else {
        likingUser.markModified("likedProjects");
        await likingUser.save();
        vendor.markModified("projectData");
        await vendor.save();
      }
      return res.json({ success: true, msg: "Like toggled successfully buddy", likeCount: proj.likeCount, likedByFeed: proj.likedByFeed });
    }
    // === 💾 SAVE SNAPSHOT PIPELINE HANDLING ===
    if (actionType === "save") {
      const existingCache = await SavedCache.findOne({ projectId: projectId, userId: currentUserId });
      if (existingCache) {
        if (existingCache.taskMedia) {
          Object.values(existingCache.taskMedia).forEach(view => {
            if (view && view.url) {
              const physicalCacheFilePath = path.join(__dirname, "uploads", "cache", view.url);
              if (fs.existsSync(physicalCacheFilePath)) {
                try {
                  fs.unlinkSync(physicalCacheFilePath);
                  console.log(`Deleted cache file buddy: ${view.url}`);
                } catch (unlinkErr) {
                  console.error("File unlink error buddy:", unlinkErr);
                }
              }
            }
          });
        }
        if (proj.savedByFeed) {
          const vIdx = proj.savedByFeed.indexOf(currentUserId);
          if (vIdx !== -1) {
            proj.savedByFeed.splice(vIdx, 1);
            vendor.markModified("projectData");
            await vendor.save();
          }
        }
        await SavedCache.deleteOne({ _id: existingCache._id });
        return res.json({ success: true, isSaved: false, msg: "Unsaved and file cache dropped clean buddy!" });
      } else {
        console.log("Save triggered buddy! Freezing files to cache folder...");
        if (!proj.savedByFeed) proj.savedByFeed = [];
        proj.savedByFeed.push(currentUserId);
        vendor.markModified("projectData");
        await vendor.save();
        const snapshotMedia = {};
        const viewsList = ['frontView', 'backView', 'leftView', 'rightView', 'ceilingView', 'floorView'];
        viewsList.forEach(view => {
          const originalFileData = proj.taskMedia?.[view];
          if (originalFileData && originalFileData.url) {
            const originalFileName = originalFileData.url;
            const originalFilePath = path.join(__dirname, "uploads", originalFileName);
            if (fs.existsSync(originalFilePath)) {
              const cachedUniqueName = `${Date.now()}-${currentUserId}-${originalFileName}`;
              const destinationCachePath = path.join(__dirname, "uploads", "cache", cachedUniqueName);
              fs.copyFileSync(originalFilePath, destinationCachePath);
              snapshotMedia[view] = {
                url: cachedUniqueName,
                fileType: originalFileData.fileType || "image"
              };
            } else {
              snapshotMedia[view] = { url: "", fileType: "image" };
            }
          } else {
            snapshotMedia[view] = { url: "", fileType: "image" };
          }
        });
        await SavedCache.create({
          projectId: projectId,
          userId: currentUserId,
          savedByUserId: currentUserId,
          companyInfo: {
            _id: vendor._id,
            name: vendor.companyName || vendor.name,
            logo: vendor.companyLogo || vendor.profilePic,
            phone: vendor.companyPhone || vendor.phone
          },
          projectName: proj.projectName,
          feedDescription: feedDescription || proj.feedDescription || "",
          likeCount: proj.likeCount !== undefined ? proj.likeCount : (proj.likedByFeed?.length || 0),
          propertyDetails: proj.propertyDetails || {},
          taskMedia: snapshotMedia, 
          savedAt: new Date()
        });
        return res.json({ success: true, isSaved: true, msg: "Physical files frozen to cache directory and database locked buddy!" });
      }
    }
    res.status(400).json({ msg: "Invalid parameter action operation flow template routing" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: "Action processing system crash" });
  }
});

/* ================= 5.3. HOME FEED SAVED CACHE EXTRACTOR ================= */

app.get("/getUserSavedCacheFeed/:userId", async (req, res) => {
  try {
    const cachedSavedItems = await SavedCache.find({ 
      $or: [{ userId: req.params.userId }, { savedByUserId: req.params.userId }]
    }).sort({ savedAt: -1 });
    const formattedFeed = await Promise.all(cachedSavedItems.map(async (item) => {
      let liveLikeCount = item.likeCount || 0;
      let liveLikedByFeed = [];
      let liveFeedDescription = item.feedDescription || "";
      try {
        const vendor = await User.findById(item.companyInfo?._id);
        if (vendor && vendor.projectData) {
          const liveProj = vendor.projectData.id(item.projectId);
          if (liveProj) {
            liveLikeCount = liveProj.likeCount !== undefined ? liveProj.likeCount : (liveProj.likedByFeed?.length || 0);
            liveLikedByFeed = liveProj.likedByFeed || [];
            liveFeedDescription = liveProj.feedDescription || item.feedDescription || "";
          }
        }
      } catch (innerErr) {
        console.error("Error fetching live counts for project buddy:", innerErr);
      }
      return {
        projectId: item.projectId,
        projectName: item.projectName,
        feedDescription: liveFeedDescription,
        likeCount: liveLikeCount, 
        likedByFeed: liveLikedByFeed,
        companyInfo: item.companyInfo,
        propertyDetails: item.propertyDetails,
        taskMedia: item.taskMedia,
        savedByFeed: [item.userId || item.savedByUserId],
        isSavedByUser: true,
        isFromCacheFolder: true
      };
    }));
    res.json(formattedFeed);
  } catch (err) {
    res.status(500).json({ msg: "Failed loading cache rows" });
  }
});

/* ================= 🔔 5.4. FETCH INDIVIDUAL HISTORICAL NOTIFICATIONS ROUTE ================= */

app.get("/api/notifications/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const items = await Notification.find({ recipientId: userId })
      .sort({ createdAt: -1 })
      .limit(50); // Kept layout compact
    res.json({ success: true, notifications: items });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed parsing user notification lists" });
  }
});

/* ================= 🔔 5.5. BULK MARK NOTIFICATIONS AS READ ROUTE ================= */

app.post("/api/notifications/markRead", async (req, res) => {
  try {
    const { userId } = req.body;
    await Notification.updateMany({ recipientId: userId, isRead: false }, { $set: { isRead: true } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/* ================= 6.1. SEARCH ENTERPRISE MATERIAL ================= */

app.get("/searchEnterpriseMaterial", async (req, res) => {
  try {
    const { name, userId } = req.query;
    if (!name || !userId) return res.json({ material: null });
    const targetUserDoc = await User.findOne({
      _id: userId,
      $or: [
        { "materialData.productName": { $regex: name, $options: "i" } },
        { "productionData.productName": { $regex: name, $options: "i" } },
        { "productionData.materialData.productName": { $regex: name, $options: "i" } }
      ]
    });
    if (!targetUserDoc) return res.json({ material: null });
    let found = null;
    if (targetUserDoc.materialData) {
      found = targetUserDoc.materialData.find(m =>
        m.productName.toLowerCase().includes(name.toLowerCase())
      );
    }
    if (!found && targetUserDoc.productionData) {
      found = targetUserDoc.productionData.find(p =>
        p.productName?.toLowerCase().includes(name.toLowerCase())
      );
    }
    if (!found && targetUserDoc.productionData) {
      for (let p of targetUserDoc.productionData) {
        if (p.materialData) {
          const mat = p.materialData.find(m =>
            m.productName.toLowerCase().includes(name.toLowerCase())
          );
          if (mat) {
            found = mat;
            break;
          }
        }
      }
    }
    if (!found) return res.json({ material: null });
    res.json({
      material: {
        name: found.productName,
        availableQty: found.qty,
        images: found.images || []
      }
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Material search failed" });
  }
});

/* ================= 6.2. SEARCH COMPANY BY PHONE ================= */

app.get("/searchCompanyByPhone", async (req, res) => {
  try {
    const { phone, currentUserId } = req.query;
    if (!phone) return res.json({ suggestions: [] });
    const cleanPhone = phone.trim();
    const companies = await User.find({
      role: "company",
      _id: { $ne: currentUserId }, 
      $or: [
        { companyPhone: { $regex: cleanPhone, $options: "i" } },
        { phone: { $regex: cleanPhone, $options: "i" } }
      ]
    }).limit(10);
    const suggestions = companies.map(company => ({
      _id: company._id,
      name: company.companyName || company.name,
      phone: company.phone,
      location: company.companyLocation?.city || company.location?.city || company.companyLocation || "No Location",
      logo: company.companyLogo || company.profilePic
    }));
    res.json({ suggestions });
  } catch (err) {
    res.status(500).json({ message: "Company search failed" });
  }
});

/* ================= 6.3. SEARCH PROJECT BY NAME ================= */

app.get("/searchProjectByName", async (req, res) => {
  try {
    const { name, userId } = req.query;
    if (!name || !userId) return res.json({ suggestions: [] });
    const user = await User.findById(userId);
    if (!user || !user.projectData) return res.json({ suggestions: [] });
    const matchedProjects = user.projectData.filter(p =>
      p.projectName.toLowerCase().includes(name.toLowerCase())
    );

    const suggestions = matchedProjects.map(proj => ({
      _id: proj._id,
      userId: user._id,
      projectName: proj.projectName,
      location: proj.propertyDetails?.location?.city || " ",
      coverImage: proj.cover
    }));

    res.json({ suggestions });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Project search failed" });
  }
});

/* ================= 6.4. SEARCH LABOUR BY NAME ================= */

app.get("/searchLabourByPhone", async (req, res) => {
  try {
    const { phone } = req.query;
    if (!phone) return res.json({ suggestions: [] });
    const cleanPhone = phone.trim();
    const labours = await User.find({
      role: "labour",
      jobRole: "driver",
      phone: { $regex: cleanPhone, $options: "i" }
    }).limit(10);
    const suggestions = labours.map(labour => ({
      _id: labour._id,
      name: labour.name,
      phone: labour.phone,
      dp: labour.profilePic || labour.dp,
      jobRole: labour.jobRole,
      location: labour.location?.city || (typeof labour.location === 'string' ? labour.location : "Tracking off")
    }));
    res.json({ suggestions });
  } catch (err) {
    res.status(500).json({ message: "Driver search failed" });
  }
});

/* ================= 6.5. SUPPLY BUTTON SUBMIT ACTION ROUTE ================= */

app.post("/createSupplyItem", async (req, res) => {
  try {
    const { 
      vendorId, materialId, materialName, qty, images, destinationType, 
      destinationDetails, projectId, driverDetails 
    } = req.body;
    const creatorAccount = await User.findById(vendorId);
    if (!creatorAccount) return res.status(404).json({ message: "Sender not found buddy" });
    const supplierMainOwnerId = creatorAccount.usedBy || creatorAccount._id;
    let inputProjectId = destinationDetails?.id || destinationDetails?._id || projectId;
    let finalProjectId = inputProjectId;
    if (inputProjectId && mongoose.Types.ObjectId.isValid(inputProjectId)) {
      const objId = new mongoose.Types.ObjectId(inputProjectId);
      const projectFinder = await User.findOne({
        $or: [
          { "projectData.projectId": objId },
          { "projectData._id": objId }
        ]
      });
      if (projectFinder) {
        const foundProj = projectFinder.projectData.find(p => 
          String(p.projectId) === String(inputProjectId) || String(p._id) === String(inputProjectId)
        );
        if (foundProj && foundProj.projectId) {
          finalProjectId = foundProj.projectId;
          console.log(`🎯 Project ID Overwritten from sub-doc _id: ${inputProjectId} -> Master ProjectId: ${finalProjectId}`);
        }
      }
    }
    const sharedStockId = new mongoose.Types.ObjectId();
    const finalQty = Number(qty) || 0;
    let driverObj = null;
    if (driverDetails) {
      const rawDriverId = driverDetails._id?.$oid || driverDetails._id || driverDetails.id;
      if (rawDriverId && mongoose.Types.ObjectId.isValid(rawDriverId)) {
        const actualDriver = await User.findById(rawDriverId);
        if (actualDriver) {
          driverObj = {
            _id: actualDriver._id,
            name: actualDriver.name || "Unknown Driver",
            phone: actualDriver.phone || "",
            dp: actualDriver.profilePic || actualDriver.dp || "",
            location: actualDriver.location?.city || (typeof actualDriver.location === 'string' ? actualDriver.location : "Tracking off")
          };
        }
      }  
    }
    let cleanMaterialId = null;
    if (materialId) {
      const idString = materialId._id || materialId;
      if (mongoose.Types.ObjectId.isValid(idString)) {
        cleanMaterialId = new mongoose.Types.ObjectId(idString);
      }
    }
    const mainSupplierDocForId = await User.findById(supplierMainOwnerId);
    if (mainSupplierDocForId) {
      let matchedItem = mainSupplierDocForId.materialData?.find(m => 
        (cleanMaterialId && m._id?.toString() === cleanMaterialId.toString()) || 
        (m.productName === materialName)
      );
      if (!matchedItem && mainSupplierDocForId.productionData) {
        matchedItem = mainSupplierDocForId.productionData.find(p => 
          (cleanMaterialId && p._id?.toString() === cleanMaterialId.toString()) || 
          (p.productName === materialName)
        );
      }
      if (matchedItem && matchedItem._id) {
        cleanMaterialId = matchedItem._id;
      }
    }
    const newSupplyObj = {
      _id: sharedStockId,
      materialId: cleanMaterialId,
      materialName,
      qty: finalQty,
      images: images || [],
      toDetails: {
        id: finalProjectId,
        companyName: destinationDetails?.name || destinationDetails?.projectName,
        location: destinationDetails?.location || "Project Site"
      },
      projectId: finalProjectId,
      suppliedDate: new Date(),
      dispatchStatus: "shipped",
      driverDetails: driverObj
    };
    if (cleanMaterialId) {
      await User.updateOne(
        { _id: supplierMainOwnerId, "materialData._id": cleanMaterialId },
        { $inc: { "materialData.$.qty": -finalQty } } 
      );
      const mainSupplierDoc = await User.findById(supplierMainOwnerId);
      if (mainSupplierDoc && mainSupplierDoc.productionData) {
        const foundProd = mainSupplierDoc.productionData.find(p => p._id?.toString() === cleanMaterialId.toString());
        if (foundProd) {
          const updatedProdQty = (Number(foundProd.qty) || 0) - finalQty;
          await User.updateOne(
            { _id: supplierMainOwnerId, "productionData._id": cleanMaterialId },
            { $set: { "productionData.$.qty": String(updatedProdQty) } }
          );
        }
      }
    } else {
      await User.updateOne(
        { _id: supplierMainOwnerId, "materialData.productName": materialName },
        { $inc: { "materialData.$.qty": -finalQty } } 
      );
      const mainSupplierDoc = await User.findById(supplierMainOwnerId);
      if (mainSupplierDoc && mainSupplierDoc.productionData) {
        const foundProd = mainSupplierDoc.productionData.find(p => p.productName === materialName);
        if (foundProd) {
          const updatedProdQty = (Number(foundProd.qty) || 0) - finalQty;
          await User.updateOne(
            { _id: supplierMainOwnerId, "productionData.productName": materialName },
            { $set: { "productionData.$.qty": String(updatedProdQty) } }
          );
        }
      }
    } 
    await User.updateMany(
      { $or: [{ _id: supplierMainOwnerId }, { usedBy: supplierMainOwnerId, subRole: { $exists: true, $ne: "" } }] },
      { $push: { supplyData: { $each: [newSupplyObj], $position: 0 } } }
    );
    if (driverObj && driverObj._id) {
      await User.findByIdAndUpdate(
        driverObj._id,
        { $push: { supplyData: { $each: [newSupplyObj], $position: 0 } } }
      );
    }
    // ==================== DESTINATION: COMPANY ====================
    if (destinationType === "company") {
      const importObj = {
        ...newSupplyObj,
        fromDetails: { 
          id: creatorAccount._id, 
          companyName: creatorAccount.companyName || creatorAccount.name, 
          location: creatorAccount.companyLocation?.city || "No Location" 
        }
      };
      await User.updateMany(
        { $or: [{ _id: finalProjectId }, { usedBy: finalProjectId, subRole: { $exists: true, $ne: "" } }] },
        { $push: { importData: { $each: [importObj], $position: 0 } } }
      );
      // 🔔 TRIGGER: Direct Company/Vendor destination dispatch logs alert
      await triggerNotification({
        recipientId: finalProjectId,
        senderId: vendorId,
        senderName: creatorAccount.companyName || creatorAccount.name,
        senderPic: creatorAccount.companyLogo || creatorAccount.profilePic || "",
        type: "material_shipped",
        title: "🚚 Materials Shipped!",
        message: `${materialName} (${finalQty} nos) has been supplied and shipped to your workspace.`
      });
    }  
    // ==================== DESTINATION: PROJECT ====================
    else if (destinationType === "project" || finalProjectId) {
      if (driverObj && driverObj._id) {
        const driverHasProject = await User.findOne({
          _id: driverObj._id,
          "projectData.projectId": finalProjectId
        });
        if (!driverHasProject) {
          const newProjectCardForDriver = {
            projectId: finalProjectId,
            projectName: destinationDetails?.projectName || destinationDetails?.name || "Assigned Project",
            cover: destinationDetails?.coverImage || destinationDetails?.cover || "",
            status: "onprogress",
            inProject: true,
            materialStock: [], 
            projectLabour: [],
            propertyOwners: [],
            supportSources: []
          };
          await User.findByIdAndUpdate(
            driverObj._id,
            { $push: { projectData: newProjectCardForDriver } }
          );
        } 
      }
      const projectOwner = await User.findOne({
        "projectData.projectId": finalProjectId,
        $or: [
          { "projectData.materialStock.materialId": cleanMaterialId },
          { "projectData.materialStock.materialName": materialName }
        ]
      });
      if (projectOwner) {
        await User.updateMany(
          { "projectData.projectId": finalProjectId, 
            $or: [
              { "projectData.materialStock.materialId": cleanMaterialId },
              { "projectData.materialStock.materialName": materialName }
            ]
          },
          {
            $set: {
              "projectData.$[proj].materialStock.$[stock]._id": sharedStockId,
              "projectData.$[proj].materialStock.$[stock].materialId": cleanMaterialId,
              "projectData.$[proj].materialStock.$[stock].qty": finalQty,
              "projectData.$[proj].materialStock.$[stock].reOrder": false, 
              "projectData.$[proj].materialStock.$[stock].note": "" ,
              "projectData.$[proj].materialStock.$[stock].driverDetails": driverObj,
              "projectData.$[proj].materialStock.$[stock].dispatchStatus": "shipped"
            }
          },
          { arrayFilters: [{ "proj.projectId": finalProjectId }, 
            { $or: [{ "stock.materialId": cleanMaterialId }, { "stock.materialName": materialName }] 
          }] }
        );
      } else {
        await User.updateMany(
          { "projectData.projectId": finalProjectId }, 
          {
            $push: {
              "projectData.$[proj].materialStock": {
                $each: [{
                  _id: sharedStockId,
                  materialId: cleanMaterialId,
                  materialName,
                  qty: finalQty,
                  images: images || [],
                  suppliedDate: new Date(),
                  reOrder: false,
                  note: "",
                  driverDetails: driverObj,
                  dispatchStatus: "shipped"
                }],
                $position: 0
              }
            }
          },
          { arrayFilters: [{ "proj.projectId": finalProjectId }] }
        );
      }
      // 🔔 TRIGGER: Find all users associated to this specific projectId layout and push individual alerts
      if (cleanMaterialId) {
        const materialStakeholders = await User.find({
          "supplyData.materialId": cleanMaterialId
        });
        for (let userNode of materialStakeholders) {
          if (String(userNode._id) !== String(vendorId)) {
            await triggerNotification({
              recipientId: userNode._id,
              senderId: vendorId,
              senderName: creatorAccount.companyName || creatorAccount.name,
              senderPic: creatorAccount.companyLogo || creatorAccount.profilePic || "",
              type: "material_shipped",
              title: "🚚 Materials Shipped!",
              message: `${materialName} (${finalQty} nos) supplied shipped towards project site context.`,
              projectId: finalProjectId
            });
          }
        }
      }
    }
    res.json({ success: true, message: "Supplied successfully to all access holders buddy! 🚚" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Supply processing failed buddy" });
  }
});

/* ================= 6.6.UPDATE DISPATCH STATUS & RESET REORDER ================= */

app.put("/updateInventoryItem/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const { field, value, vendorId } = req.body; 
    if (!mongoose.Types.ObjectId.isValid(itemId)) {
      return res.status(400).json({ message: "Invalid item ID buddy" });
    }
    const supplier = await User.findById(vendorId);
    if (!supplier) return res.status(404).json({ message: "User not found buddy" });
    const supplierMainOwnerId = supplier.usedBy || supplier._id;
    const targetItem = supplier.supplyData.id(itemId);
    if (targetItem) { 
      if (field === "qty") {
        const oldQty = targetItem.qty || 0;
        const newQty = Number(value) || 0;
        const qtyDifference = newQty - oldQty;
        if (targetItem.materialId) {
          await User.updateOne(
            { _id: supplierMainOwnerId, "materialData._id": targetItem.materialId },
            { $inc: { "materialData.$.qty": -qtyDifference } } 
          );
          const mainSupplierDoc = await User.findById(supplierMainOwnerId);
          if (mainSupplierDoc && mainSupplierDoc.productionData) {
            const foundProd = mainSupplierDoc.productionData.find(p => p._id?.toString() === targetItem.materialId.toString());
            if (foundProd) {
              const updatedProdQty = (Number(foundProd.qty) || 0) - qtyDifference;
              await User.updateOne(
                { _id: supplierMainOwnerId, "productionData._id": targetItem.materialId },
                { $set: { "productionData.$.qty": String(updatedProdQty) } }
              );
            }
          }
        } else {
          await User.updateOne(
            { _id: supplierMainOwnerId, "materialData.productName": targetItem.materialName },
            { $inc: { "materialData.$.qty": -qtyDifference } } 
          );
          const mainSupplierDoc = await User.findById(supplierMainOwnerId);
          if (mainSupplierDoc && mainSupplierDoc.productionData) {
            const foundProd = mainSupplierDoc.productionData.find(p => p.productName === targetItem.materialName);
            if (foundProd) {
              const updatedProdQty = (Number(foundProd.qty) || 0) - qtyDifference;
              await User.updateOne(
                { _id: supplierMainOwnerId, "productionData.productName": targetItem.materialName },
                { $set: { "productionData.$.qty": String(updatedProdQty) } }
              );
            }
          }
        }
      }
      let frontendDriverId = null;
      if (field === "driverDetails" && value) {
        frontendDriverId = value._id?.$oid || value._id || value.id;
      }
      if (field === "driverDetails") {
        if (value && frontendDriverId && mongoose.Types.ObjectId.isValid(frontendDriverId)) {
          let driverCity = "Tracking off";
          if (value.location && typeof value.location === "object") {
            driverCity = value.location.city || "Tracking off";
          } else if (typeof value.location === "string") {
            driverCity = value.location;
          }
          targetItem.set('driverDetails', {
            _id: new mongoose.Types.ObjectId(frontendDriverId), 
            name: value.name || "Unknown Driver",
            phone: value.phone || "",
            dp: value.profilePic || value.dp || "",
            location: driverCity 
          });
        } else {
          targetItem.driverDetails = null;
        }
      } else {
        targetItem[field] = value;
      }
      await supplier.save();
      const finalValue = field === "driverDetails" ? targetItem.driverDetails : value;
      const itemObjectId = new mongoose.Types.ObjectId(itemId);
      await User.updateMany(
        { "supplyData._id": itemObjectId },
        { $set: { [`supplyData.$.${field}`]: finalValue } }
      );
      await User.updateMany(
        { "importData._id": itemObjectId },
        { $set: { [`importData.$.${field}`]: finalValue } }
      );
      await User.updateMany(
        { "projectData.materialStock._id": itemObjectId, role: { $ne: "labour" } },
        { $set: { [`projectData.$[proj].materialStock.$[stock].${field}`]: finalValue } },
        {
          arrayFilters: [
            { "proj.materialStock._id": itemObjectId }, 
            { "stock._id": itemObjectId }
          ]
        }
      );
      // 🚚 2. DRIVER POST-CLEANUP & SHIFT LOGIC
      if (field === "driverDetails") {
        const newDriverId = targetItem.driverDetails?._id; 
        const rawProjectId = targetItem.projectId || targetItem.toDetails?.id;
        let validProjectId = null;
        if (rawProjectId) {
          const checkProjId = rawProjectId._id || rawProjectId;
          if (mongoose.Types.ObjectId.isValid(checkProjId)) {
            validProjectId = new mongoose.Types.ObjectId(checkProjId);
          }
        }
        await User.updateMany(
          { 
            role: "labour", 
            "supplyData._id": itemObjectId,
            _id: { $ne: newDriverId } 
          },
          { $pull: { supplyData: { _id: itemObjectId } } }
        );
        if (validProjectId) {
          await User.updateMany(
            { 
              role: "labour", 
              "projectData.projectId": validProjectId,
              _id: { $ne: newDriverId }
            },
            { $pull: { "projectData.$[proj].materialStock": { _id: itemObjectId } } },
            { arrayFilters: [{ "proj.projectId": validProjectId }] }
          );
        }
        if (newDriverId) {
          const freshSupplyCard = targetItem.toObject(); 
          await User.updateOne(
            { _id: newDriverId, "supplyData._id": { $ne: itemObjectId } },
            { $push: { supplyData: freshSupplyCard } }
          );
          if (validProjectId) {
            const driverHasProject = await User.findOne({
              _id: newDriverId,
              "projectData.projectId": validProjectId
            });
            if (!driverHasProject) {
              const newProjectCardForDriver = {
                projectId: validProjectId,
                projectName: targetItem.toDetails?.companyName || targetItem.toDetails?.projectName || "Assigned Project",
                cover: "",
                status: "onprogress",
                inProject: true,
                materialStock: [freshSupplyCard],
                projectLabour: [],
                propertyOwners: [],
                supportSources: []
              };
              await User.findByIdAndUpdate(newDriverId, { $push: { projectData: newProjectCardForDriver } });
            } else {
              await User.updateOne(
                { 
                  _id: newDriverId, 
                  "projectData.projectId": validProjectId,
                  "projectData.materialStock._id": { $ne: itemObjectId }
                },
                { $push: { "projectData.$[proj].materialStock": freshSupplyCard } },
                { arrayFilters: [{ "proj.projectId": validProjectId }] }
              );
            }
          }
        }
      }
      // 📋 3. DISPATCH STATUS & REORDER LOGIC
      if (field === "dispatchStatus") {
        let updateFields = { "supplyData.$.dispatchStatus": value };
        let importUpdateFields = { "importData.$.dispatchStatus": value };
        let projectUpdateFields = { "projectData.$[proj].materialStock.$[stock].dispatchStatus": value };
        if (value === "delivered") {
          const currentDeliveryDate = new Date();
          targetItem.importDate = currentDeliveryDate;
          updateFields["supplyData.$.importDate"] = currentDeliveryDate;
          importUpdateFields["importData.$.importDate"] = currentDeliveryDate;
          projectUpdateFields["projectData.$[proj].materialStock.$[stock].importDate"] = currentDeliveryDate;
        }

        await User.updateMany(
          { "supplyData._id": itemObjectId },
          { $set: updateFields }
        );
        await User.updateMany(
          { "importData._id": itemObjectId },
          { $set: importUpdateFields }
        );
        await User.updateMany(
          { "projectData.materialStock._id": itemObjectId, role: { $ne: "labour" } },
          { $set: projectUpdateFields },
          {
            arrayFilters: [
              { "proj.materialStock._id": itemObjectId }, 
              { "stock._id": itemObjectId }
            ]
          }
        );
        if (value === "delivered") {
          const activeDriverId = targetItem.driverDetails?._id;
          await User.updateMany(
            { role: "labour", "supplyData._id": itemObjectId },
            { $pull: { supplyData: { _id: itemObjectId } } }
          );
          await User.updateMany(
            { role: "labour", "projectData.materialStock._id": itemObjectId },
            { $pull: { "projectData.$[].materialStock": { _id: itemObjectId } } }
          );
          if (activeDriverId) {
            await User.findByIdAndUpdate(activeDriverId, {
              $pull: { 
                supplyData: { _id: itemObjectId },
                "projectData.$[].materialStock": { _id: itemObjectId }
              }
            });
          }
          await User.updateMany(
            { role: "labour", "projectData.materialStock": { $size: 0 } },
            { $pull: { projectData: { materialStock: { $size: 0 } } } }
          );
        }
      }
      if (field === "dispatchStatus" && value === "delivered") {
        const rawProjId = targetItem.projectId || targetItem.toDetails?.id;
        let targetProjectId = null;
        if (rawProjId) {
          const checkProjId = rawProjId._id || rawProjId;
          if (mongoose.Types.ObjectId.isValid(checkProjId)) {
            targetProjectId = new mongoose.Types.ObjectId(checkProjId);
          }
        }
        const matName = targetItem.materialName;
        const matId = targetItem.materialId;
        if (targetProjectId) {
          await User.updateMany(
            {
              "projectData.projectId": targetProjectId,
              "projectData.materialStock.materialName": matName,
              role: { $ne: "labour" }
            },
            {
              $set: {
                "projectData.$[proj].materialStock.$[stock].materialId": matId,
                "projectData.$[proj].materialStock.$[stock].reOrder": false,
                "projectData.$[proj].materialStock.$[stock].note": "",
                "projectData.$[proj].materialStock.$[stock]._id": itemObjectId
              }
            },
            {
              arrayFilters: [
                { "proj.projectId": targetProjectId },
                { "stock.materialName": matName }
              ]
            }
          );
        }
      }
    }
    res.json({ success: true, message: "Inventory updated and shifted perfectly buddy! ✅🎉" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Update failed buddy" });
  }
});

/* ================= 6.7. GET INVENTORY DATA ================= */

app.get("/getInventoryData/:vendorId", async (req, res) => {
  try {
    const user = await User.findById(req.params.vendorId);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({
      importData: user.importData || [],
      supplyData: user.supplyData || []
    });
  } catch (err) {
    res.status(500).json({ message: "Fetch failed" });
  }
});

/* ================= 6.8. CREATE REORDER REQUEST ================= */

app.post("/createReorderRequest", async (req, res) => {
  try {
    const { projectId, materialName, note, stockItemId, materialId } = req.body;
    if (!projectId || !stockItemId) {
      return res.status(400).json({ success: false, message: "Missing fields buddy!" });
    }
    const result = await User.updateMany(
      { 
        "projectData.projectId": projectId,
        "projectData.materialStock._id": stockItemId
      },
      {
        $set: {
          "projectData.$[proj].materialStock.$[stock].reOrder": true,
          "projectData.$[proj].materialStock.$[stock].note": note,
          "projectData.$[proj].materialStock.$[stock].materialId": materialId ? new mongoose.Types.ObjectId(materialId) : null
        }
      },
      {
        arrayFilters: [
          { "proj.projectId": projectId },
          { "stock._id": stockItemId }
        ]
      }
    );
    res.json({ success: true, message: "Reorder requested perfectly for everyone buddy! 🔄" });
  } catch (err) {
    console.error("Backend Reorder Error:", err);
    res.status(500).json({ success: false, message: "Reorder request failed buddy" });
  }
});

/* ================= 6.9. UPDATE DISPATCH TO DELIVERED API ================= */

app.put("/updateSupplyStatus/:userId/:projectId/:stockItemId", async (req, res) => {
  try {
    const { userId, projectId, stockItemId } = req.params;
    const { status } = req.body;
    if (status === "delivered") {
      await User.updateOne(
        { _id: userId, "projectData._id": projectId, "projectData.materialStock._id": stockItemId },
        {
          $set: {
            "projectData.$[proj].materialStock.$[stock].reOrder": false,
            "projectData.$[proj].materialStock.$[stock].note": ""
          }
        },
        {
          arrayFilters: [
            { "proj._id": projectId },
            { "stock._id": stockItemId }
          ]
        }
      );
    }
    res.json({ success: true, message: "Status updated and stock reset buddy!" });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/* ================= 6.10. DELETE SUPPLY ITEM ================= */

app.delete("/deleteSupplyItem/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const { vendorId } = req.query;
    if (!vendorId) {
      return res.status(400).json({ success: false, message: "Vendor ID is required buddy!" });
    }
    const checkUser = await User.findOne({ "supplyData._id": itemId }, { "supplyData.$": 1 });
    if (checkUser && checkUser.supplyData?.[0]?.dispatchStatus === "delivered") {
      return res.status(400).json({ success: false, message: "Delivered items cannot be deleted buddy!" });
    }
    await User.updateMany(
      { "supplyData._id": itemId },
      { $pull: { supplyData: { _id: itemId } } }
    );
    await User.updateMany(
      { "importData._id": itemId },
      { $pull: { importData: { _id: itemId } } }
    );
    await User.updateMany(
      { "projectData.materialStock._id": itemId },
      { $pull: { "projectData.$[].materialStock": { _id: itemId } } }
    );
    res.json({ success: true, message: "Deleted successfully from everywhere buddy! 🗑️" });
  } catch (err) {
    console.error("Backend Delete Error buddy:", err);
    res.status(500).json({ success: false, message: "Internal server error buddy", error: err.message });
  }
});

/* ================= 6.11. GET ALL GLOBAL REORDER REQUESTS ================= */

app.get("/getAllReorderRequests", async (req, res) => {
  try {
    const reorderItems = await User.aggregate([
      { 
        $match: { 
          "projectData.materialStock.reOrder": true,
          "projectData.materialStock.note": { $exists: true, $ne: "" } 
        } 
      },
      { $unwind: "$projectData" },
      { $unwind: "$projectData.materialStock" },
      { 
        $match: { 
          "projectData.materialStock.reOrder": true,
          "projectData.materialStock.note": { $exists: true, $ne: "" }
        } 
      },
      {
        $project: {
          _id: "$projectData.materialStock._id",
          materialId: "$projectData.materialStock.materialId",
          materialName: "$projectData.materialStock.materialName",
          qty: "$projectData.materialStock.qty",
          images: { $ifNull: ["$projectData.materialStock.images", []] },
          note: { $ifNull: ["$projectData.materialStock.note", ""] },
          projectId: "$projectData.projectId",
          projectName: "$projectData.projectName",
          location: { $ifNull: ["$projectData.location", "Project Site"] },
          projectUserId: "$_id"
        }
      }
    ]);
    let allReorders = [];
    let uniqueKeys = new Set();
    reorderItems.forEach(item => {
      const uniqueIdentifier = `${item.projectId}_${item.materialName}`;
      if (!uniqueKeys.has(uniqueIdentifier)) {
        uniqueKeys.add(uniqueIdentifier);
        allReorders.push(item);
      }
    });
    res.json({ success: true, reorders: allReorders });
  } catch (err) {
    console.error("Aggregation Reorder Error buddy:", err);
    res.status(500).json({ success: false, message: "Failed to fetch reorders buddy" });
  }
});

/* ================= 6.12.GET LATEST SUPPLY STATUS FOR A PROJECT ================= */

app.get("/getProjectSupplies/:projectId", async (req, res) => {
  try {
    const { projectId } = req.params;
    const userDoc = await User.findOne({ "projectData.projectId": projectId }, { supplyData: 1 });
    if (!userDoc || !userDoc.supplyData) {
      return res.json({ success: true, supplies: [] });
    }
    const cleanSupplies = userDoc.supplyData.map(item => {
      const plain = item.toObject ? item.toObject() : { ...item };
      plain._id = item._id ? item._id.toString() : "";
      if (plain.projectId) plain.projectId = plain.projectId.toString();
      return plain;
    });
    res.json({ success: true, supplies: cleanSupplies });
  } catch (err) {
    console.error("Error fetching project supplies buddy:", err);
    res.status(500).json({ success: false, message: "Internal server error buddy" });
  }
});

/* ================= 7.1.CHECK SUBSCRIPTION ================= */

app.get("/checkSubscription/:userId", async (req, res) => {
  try {
    let user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }
    if (user.role === "customer" && user.usedBy) {
      user = await User.findById(user.usedBy);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: "Company not found"
        });
      }
    }
    const today = new Date();
    let locked = false;
    let remainingDays = 0;
    if (!user.subscription.payment) {
      remainingDays = Math.ceil(
        (new Date(user.subscription.trialEnd) - today) /
        (1000 * 60 * 60 * 24)
      );
      if (remainingDays < 0) remainingDays = 0;
      if (today > new Date(user.subscription.trialEnd)) {
        locked = true;
      }
    }
    else {
      remainingDays = Math.ceil(
        (new Date(user.subscription.subscriptionEnd) - today) /
        (1000 * 60 * 60 * 24)
      );
      if (remainingDays < 0) remainingDays = 0;
      if (today > new Date(user.subscription.subscriptionEnd)) {
        user.subscription.plan = "trial";
        user.subscription.payment = false;
        user.subscription.trialStart = new Date();
        user.subscription.trialEnd = new Date(
          Date.now() + 14 * 24 * 60 * 60 * 1000
        );
        user.subscription.subscriptionStart = null;
        user.subscription.subscriptionEnd = null;
        user.day = 1;
        await user.save();
        locked = false;
        remainingDays = 14;
      }
    }
    res.json({
      success: true,
      locked,
      payment: user.subscription.payment,
      plan: user.subscription.plan,
      remainingDays,
      subscription: user.subscription,
      day: user.day || 1,
      companyId: user._id
    });
  }
  catch (err) {
    console.log(err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/* ================= 7.2 CREATE RAZORPAY ORDER ================= */

app.post("/createOrder", async (req, res) => {
  console.log("===== CREATE ORDER API HIT =====");
  console.log(req.body);
  try {
    const { userId, plan } = req.body;
    let amount = 0;
    switch (plan) {
      case "6months":
        amount = 399;
        break;
      case "yearly":
        amount = 899;
        break;
      default:
        return res.status(400).json({
          success: false,
          message: "Invalid plan"
        });
    }
    const options = {
      amount: amount * 100,
      currency: "INR",
      receipt: `receipt_${Date.now()}`,
      notes: {
        userId,
        plan
      }
    };
    const order = await razorpay.orders.create(options);
    res.json({
      success: true,
      order,
      key: process.env.RAZORPAY_KEY_ID
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      success: false,
      message: "Unable to create order"
    });
  }
});

/* ================= 8.1.UPDATE DASHBOARD SETTINGS ================= */

app.put("/updateDashboardSettings/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }
    if (user.role !== "company") {
      return res.status(403).json({
        success: false,
        message: "Only Company Owner can update dashboard settings."
      });
    }
    user.dashboardSettings = req.body;
    await user.save();
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      message: "Dashboard settings update failed."
    });
  }
});

/* ================= SERVER ================= */

const PORT = 5000;
server.listen(PORT, () => console.log(`🚀 Server running safely on port ${PORT}`));