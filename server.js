import dotenv from "dotenv";
dotenv.config();

import express, { json, urlencoded } from "express";
import multer from "multer";
import { createTransport } from "nodemailer";
import cors from "cors";
import { readFileSync, unlinkSync } from "fs";
import xlsx from "xlsx";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const { readFile, utils } = xlsx;
const app = express();
const upload = multer({ dest: "uploads/" });

// ✅ CORS Configuration
app.use(cors({
    origin: ["http://127.0.0.1:5500", "http://localhost:3000"],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
}));
app.use(json());
app.use(urlencoded({ extended: true }));

// ✅ Validate .env Variables
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS || !process.env.JWT_SECRET || !process.env.MONGO_URI) {
    console.error("❌ Missing required environment variables in .env file");
    process.exit(1);
}

// ✅ Connect to MongoDB
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log("✅ Connected to MongoDB"))
  .catch(err => console.error("❌ MongoDB Connection Error:", err));

// ✅ User Schema & Model
const UserSchema = new mongoose.Schema({
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    isAdmin: { type: Boolean, default: false }
});
const User = mongoose.model("User", UserSchema);

// ✅ Signup API
app.post("/signup", async (req, res) => {
    try {
        const { email, password } = req.body;

        // ✅ Check if the user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ message: "User already exists" });

        // ✅ Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // ✅ Create a new user (Public users are not admins)
        const user = await User.create({ email, password: hashedPassword, isAdmin: false });

        res.json({ success: true, message: "User registered successfully!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error signing up", error: error.message });
    }
});


// ✅ Login API
app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        // Check if user exists
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ success: false, message: "User not found" });

        // Validate password
        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) return res.status(400).json({ success: false, message: "Invalid credentials" });

        // Generate JWT Token
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: "1h" });

        // ✅ Always return JSON response
        return res.json({ success: true, token, message: "Login successful!" });

    } catch (error) {
        console.error("❌ Login Error:", error.message);
        return res.status(500).json({ success: false, message: "Internal Server Error", error: error.message });
    }
});


// ✅ Middleware to Protect Routes
const authenticate = (req, res, next) => {
    const token = req.headers["authorization"];
    if (!token) return res.status(401).json({ message: "Unauthorized: No Token Provided" });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.userId = decoded.userId;
        next();
    } catch (error) {
        res.status(401).json({ message: "Unauthorized: Invalid or Expired Token", error: error.message });
    }
};

// ✅ Function to Send Emails
async function sendEmail(to, subject, text) {
    const transporter = createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true,
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });

    try {
        let info = await transporter.sendMail({
            from: `"Phoenix Support" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            text: text || "This is a test email.",
            html: `<p>${text}</p>`
        });
        return { success: true, message: `Email sent to ${to}` };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ✅ File Upload Endpoint
app.post("/upload", upload.single("file"), async (req, res) => {
    try {
        const file = req.file;
        if (!file) return res.status(400).json({ message: "No file uploaded" });

        let emails = [];
        const ext = file.originalname.split('.').pop().toLowerCase();

        if (["csv", "txt"].includes(ext)) {
            const data = readFileSync(file.path, "utf-8");
            emails = data.split(/\r?\n/).map(email => email.trim()).filter(email => email.includes("@"));
        } else if (["xls", "xlsx"].includes(ext)) {
            const workbook = readFile(file.path);
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            emails = utils.sheet_to_json(sheet, { header: 1 }).flat().filter(email => email.includes("@"));
        }

        try {
            unlinkSync(file.path); // Delete file after processing
        } catch (err) {
            console.error("⚠️ Error deleting file:", err);
        }

        return res.json({ success: true, emails });

    } catch (error) {
        return res.status(500).json({ message: "Error processing file", error: error.message });
    }
});

// ✅ Send Bulk Emails
app.post("/send-emails", authenticate, async (req, res) => {
    try {
        const { emails, subject, message } = req.body;
        if (!emails || emails.length === 0) {
            return res.status(400).json({ success: false, message: "No valid emails provided" });
        }

        const results = await Promise.allSettled(emails.map(email => sendEmail(email, subject, message)));

        const failedEmails = results
            .map((r, i) => (r.status === "rejected" ? emails[i] : null))
            .filter(Boolean);
        const successCount = results.filter(r => r.status === "fulfilled").length;

        return res.json({ 
            success: true, 
            message: `Emails sent: ${successCount}, Failed: ${failedEmails.length}`,
            failedEmails
        });

    } catch (error) {
        return res.status(500).json({ success: false, message: "Error sending emails", error: error.message });
    }
});

// ✅ Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
