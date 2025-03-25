import dotenv from "dotenv";
dotenv.config();

import express, { json, urlencoded } from "express";
import multer from "multer";
import { createTransport } from "nodemailer";
import cors from "cors";
import { readFileSync, unlinkSync } from "fs";
import xlsx from "xlsx";

const { readFile, utils } = xlsx;
const app = express();
const upload = multer({ dest: "uploads/" });

// ✅ Fix CORS Issues
app.use(cors({
    origin: ["http://127.0.0.1:5500", "http://localhost:3000"],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    credentials: true
}));
app.use(json());
app.use(urlencoded({ extended: true }));

// ✅ Validate .env Variables
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.error("❌ Missing EMAIL_USER or EMAIL_PASS in .env file");
    process.exit(1);
}

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

        console.log(`✅ Email sent to ${to}: ${info.response}`);
        return { success: true, message: `Email sent to ${to}` };
    } catch (error) {
        console.error(`❌ Failed to send email to ${to}:`, error);
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

        unlinkSync(file.path); // Delete file after processing
        return res.json({ success: true, emails });

    } catch (error) {
        console.error("❌ Error processing file:", error);
        return res.status(500).json({ message: "Error processing file", error: error.message });
    }
});

// ✅ Send Bulk Emails
app.post("/send-emails", async (req, res) => {
    try {
        const { emails, subject, message } = req.body;
        if (!emails || emails.length === 0) {
            return res.status(400).json({ success: false, message: "No valid emails provided" });
        }

        const results = await Promise.allSettled(emails.map(email => sendEmail(email, subject, message)));

        const failedEmails = results.filter(r => r.status === "rejected").map((_, i) => emails[i]);
        const successCount = results.filter(r => r.status === "fulfilled").length;

        console.log(`✅ Emails sent: ${successCount}, ❌ Failed: ${failedEmails.length}`);
        return res.json({ 
            success: true, 
            message: `Emails sent: ${successCount}, Failed: ${failedEmails.length}`,
            failedEmails
        });

    } catch (error) {
        console.error("❌ Error sending emails:", error);
        return res.status(500).json({ success: false, message: "Error sending emails", error: error.message });
    }
});

// ✅ Test Email Endpoint
app.get("/test-email", async (req, res) => {
    try {
        const result = await sendEmail("your-email@gmail.com", "Test Email", "This is a test email!");
        return res.json(result);
    } catch (error) {
        return res.status(500).json({ success: false, message: "Test email failed", error: error.message });
    }
});

// ✅ Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
