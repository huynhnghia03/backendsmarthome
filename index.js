import dotenv from "dotenv";
dotenv.config();
import nodemailer from "nodemailer";
import rateLimit from "express-rate-limit";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import multer from "multer";
import fs from "fs";
import path from "path";
import cron from "node-cron";

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: "*",
    methods: "GET,POST",
  })
);
app.set('trust proxy', 1); // Cấu hình Express tin tưởng proxy
app.use(express.static(path.join(__dirname, 'static')));

// Kết nối MongoDB
const dbUri = process.env.MONGO_URI;
mongoose
  .connect(dbUri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Kết nối MongoDB thành công"))
  .catch((err) => console.error("Lỗi kết nối MongoDB:", err));

// Định nghĩa schema cho ảnh
const ImageSchema = new mongoose.Schema({
  filename: String,
  originalname: String,
  path: String,
  createdAt: { type: Date, default: Date.now },
});

const Image = mongoose.model("Image", ImageSchema);

// Cấu hình lưu trữ với multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // const dir = "uploads";
    // if (!fs.existsSync(dir)) {
    //   fs.mkdirSync(dir);
    // }
    // cb(null, dir);
    const tmpDir = '/tmp'; // Sử dụng thư mục tạm thời của Vercel
    cb(null, tmpDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    cb(null, `${timestamp}-${file.originalname}`);
  },
});

const upload = multer({ storage });

// Email Config từ .env
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

// Kiểm soát lưu lượng (rate limit)
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 phút
  max: 5, // Tối đa 5 yêu cầu trong 1 phút
  message: "Quá nhiều yêu cầu, vui lòng thử lại sau.",
});
app.use(limiter);

// Gửi thông báo (email và lưu ảnh)
app.post("/notify", upload.single("image"), async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    // Lưu ảnh vào MongoDB
    if (req.file) {
      const newImage = new Image({
        filename: req.file.filename,
        originalname: req.file.originalname,
        path: req.file.path,
      });
      await newImage.save();
    }

    // Gửi email
    const mailOptions = {
      from: `"Camera chống trộm"`, // Tên hệ thống
      to: process.env.EMAIL_TO,
      subject: "🚨 Cảnh báo: Có người đột nhập 🚨",
      html: `
        <div style="font-family: Arial, sans-serif; color: #333;">
          <div style="text-align: center; padding: 20px; background-color: #ff4d4d; color: white; border-radius: 8px;">
            <h1 style="margin: 0;">🚨 Cảnh Báo An Ninh 🚨</h1>
          </div>
          <div style="padding: 20px; border: 1px solid #ddd; border-radius: 8px; background: #f9f9f9;">
            <p><strong>Thông báo:</strong> Phát hiện có người đột nhập!</p>
            <p><strong>Thời gian:</strong> ${new Date().toLocaleString()}</p>
            <p><strong>Khoảng cách phát hiện:</strong> ${req.body?.distance || "Không xác định"} cm</p>
            <hr>
            <p style="margin: 0; text-align: center;">
              <img src="cid:alert-logo" alt="Alert Logo" style="width: 150px; margin: 20px 0;">
            </p>
            ${
              req.file
                ? `<p style="text-align: center; margin: 20px 0;">
                    <img src="cid:capture-image" alt="Capture Image" style="width: 100%; max-width: 500px; border-radius: 8px;">
                  </p>`
                : "<p style='text-align: center; color: #999;'>Không có ảnh chụp kèm theo</p>"
            }
            <div style="text-align: center; margin-top: 20px;">
              <p style="background-color: #ff4d4d; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Xem Chi Tiết</p>
            </div>
          </div>
          <footer style="margin-top: 20px; text-align: center; color: #aaa; font-size: 12px;">
            <p>Hệ thống an ninh thông minh - Camera Security System</p>
            <p>© 2025 - Tất cả các quyền được bảo lưu.</p>
          </footer>
        </div>
      `,
      attachments: [
        {
          filename: "alert-logo.png",
          path: "logo.png", // Đường dẫn tới ảnh logo trên server
          cid: "alert-logo", // ID của ảnh trong HTML
        },
        ...(req.file
          ? [
              {
                filename: req.file.originalname,
                path: req.file.path,
                cid: "capture-image", // ID của ảnh chụp trong HTML
              },
            ]
          : []),
      ],
    };
    

    await transporter.sendMail(mailOptions);
    console.log("Email và ảnh đã được gửi!");
    res.json({ success: true, message: "Notification sent and image uploaded" });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ success: false, error: "Failed to send notification" });
  }
});

// API lấy toàn bộ ảnh
app.get("/images", async (req, res) => {
  try {
    const images = await Image.find({});
    res.json(images);
  } catch (error) {
    console.error("Error fetching images:", error);
    res.status(500).json({ success: false, error: "Failed to fetch images" });
  }
});

// Tự động xóa ảnh cũ hơn 2 ngày
cron.schedule("0 0 * * *", async () => {
  try {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const oldImages = await Image.find({ createdAt: { $lt: twoDaysAgo } });

    for (const image of oldImages) {
      if (fs.existsSync(image.path)) {
        fs.unlinkSync(image.path); // Xóa file trên máy
      }
      await Image.deleteOne({ _id: image._id }); // Xóa trong database
    }

    console.log(`Đã xóa ${oldImages.length} ảnh cũ.`);
  } catch (error) {
    console.error("Lỗi xóa ảnh cũ:", error);
  }
});

// Trang chính
app.get("/", (req, res) => {
  res.send("Server is running");
});

// Lắng nghe server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}`);
});
