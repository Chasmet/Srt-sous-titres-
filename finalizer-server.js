import express from "express";
import cors from "cors";
import multer from "multer";
import ffmpegPath from "ffmpeg-static";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const app = express();
const PORT = process.env.PORT || 3000;
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 700);
const TMP_ROOT = path.join(os.tmpdir(), "srt-mp4-finalizer");

await fs.mkdir(TMP_ROOT, { recursive: true });

app.use(cors({ origin: "*" }));
app.options("*", cors({ origin: "*" }));

app.get("/", (req, res) => {
  res.status(200).json({
    ok: true,
    name: "SRT Studio MP4 Finalizer",
    route: "POST /api/finalize-mp4",
    maxUploadMb: MAX_UPLOAD_MB
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, ffmpeg: Boolean(ffmpegPath) });
});

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const jobId = crypto.randomBytes(8).toString("hex");
      req.jobId = jobId;
      req.jobDir = path.join(TMP_ROOT, `job-${jobId}`);
      await fs.mkdir(req.jobDir, { recursive: true });
      cb(null, req.jobDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    cb(null, "input-video");
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_UPLOAD_MB * 1024 * 1024,
    files: 1
  }
});

app.post("/api/finalize-mp4", (req, res) => {
  upload.single("video")(req, res, async error => {
    const jobId = req.jobId || crypto.randomBytes(8).toString("hex");
    const jobDir = req.jobDir || path.join(TMP_ROOT, `job-${jobId}`);

    if (error) {
      console.error(`[${jobId}] Upload error`, error);
      await cleanup(jobDir);
      if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(413).send(`Fichier trop lourd. Limite Render actuelle : ${MAX_UPLOAD_MB} Mo.`);
      }
      return res.status(400).send(`Erreur upload : ${error.message}`);
    }

    try {
      if (!req.file) return res.status(400).send("Vidéo manquante");
      if (!ffmpegPath) return res.status(500).send("FFmpeg introuvable sur Render");

      const inputPath = req.file.path;
      const outputPath = path.join(jobDir, "video-final-capcut-tiktok.mp4");
      const inputStat = await fs.stat(inputPath);
      console.log(`[${jobId}] Conversion MP4 start - input=${formatMo(inputStat.size)}`);

      await execFileAsync(
        ffmpegPath,
        [
          "-hide_banner",
          "-y",
          "-fflags", "+genpts",
          "-i", inputPath,
          "-map", "0:v:0",
          "-map", "0:a?",
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-crf", "22",
          "-pix_fmt", "yuv420p",
          "-profile:v", "main",
          "-level", "4.0",
          "-c:a", "aac",
          "-b:a", "160k",
          "-ar", "44100",
          "-ac", "2",
          "-movflags", "+faststart",
          outputPath
        ],
        { timeout: 45 * 60 * 1000, maxBuffer: 1024 * 1024 * 30 }
      );

      const outputStat = await fs.stat(outputPath);
      console.log(`[${jobId}] Conversion MP4 OK - output=${formatMo(outputStat.size)}`);

      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", "attachment; filename=video-final-capcut-tiktok.mp4");
      res.setHeader("Content-Length", outputStat.size);
      res.download(outputPath, "video-final-capcut-tiktok.mp4", async downloadError => {
        if (downloadError) console.error(`[${jobId}] Download error`, downloadError);
        await cleanup(jobDir);
      });
    } catch (processError) {
      console.error(`[${jobId}] FFmpeg error`, processError);
      if (!res.headersSent) {
        res.status(500).send(`Erreur conversion MP4 : ${processError.message}`);
      }
      await cleanup(jobDir);
    }
  });
});

async function cleanup(jobDir) {
  try {
    await fs.rm(jobDir, { recursive: true, force: true });
  } catch (error) {
    console.error("Cleanup error", error);
  }
}

function formatMo(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SRT Studio MP4 Finalizer démarré sur le port ${PORT}`);
});
