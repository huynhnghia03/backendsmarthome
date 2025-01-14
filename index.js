import dotenv from 'dotenv';
dotenv.config();
import nodemailer from "nodemailer";
import rateLimit from "express-rate-limit";
import express from "express";
import cors from 'cors'
const app = express();
app.use(express.json());
app.use(cors({
    methods: "GET,POST,PUT,DELETE",
    credentials: true,
    optionsSuccessStatus: 200
  }))
const PORT = process.env.PORT
// Email Config từ .env
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

// Kiểm soát lưu lượng (rate limit) để tránh quá tải
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 phút
  max: 3, // Tối đa 3 yêu cầu trong 1 phút
  message: "Quá nhiều yêu cầu, vui lòng thử lại sau.",
});
app.use(limiter);

app.get('/notify', async (req, res)=> {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { message, distance } = req.body;

  if (!message || !distance) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_TO,
      subject: "Cảnh báo từ camera",
      text: `${message} Khoảng cách: ${distance} cm.`,
    };

    await transporter.sendMail(mailOptions);
    console.log("Email sent!");
    res.json({ success: true, message: "Notification sent" });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ success: false, error: "Failed to send notification" });
  }
})

app.get('/', (req, res) => {
    res.send('Socket.IO server is running');
});

app.listen(PORT, () => {
    console.log(`http://localhost:${PORT}`)
  })