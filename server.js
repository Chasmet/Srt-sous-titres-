import express from "express";
import cors from "cors";
import multer from "multer";
import ffmpegPath from "ffmpeg-static";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import crypto from "crypto";

const execFileAsync = promisify(execFile);
const app = express();
const PORT = process.env.PORT || 3000;
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 900);
const TMP_ROOT = path.join(os.tmpdir(), "srt-render-jobs");

await fs.mkdir(TMP_ROOT, { recursive: true });

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      if (!req.jobId) req.jobId = crypto.randomBytes(8).toString("hex");
      req.jobDir = path.join(TMP_ROOT, `job-${req.jobId}`);
      await fs.mkdir(req.jobDir, { recursive: true });
      cb(null, req.jobDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    if (file.fieldname === "video") return cb(null, "input.mp4");
    if (file.fieldname === "srt") return cb(null, "subtitles.srt");
    cb(null, `${file.fieldname}-${Date.now()}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_UPLOAD_MB * 1024 * 1024,
    files: 2
  }
});

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "2mb" }));

app.get("/", (req, res) => {
  res.status(200).json({
    ok: true,
    name: "Sous-titres IA Render FFmpeg",
    memoryMode: "disk-streaming",
    maxUploadMb: MAX_UPLOAD_MB,
    routes: ["POST /api/burn-subtitles", "GET /health"]
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

app.post(
  "/api/burn-subtitles",
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "srt", maxCount: 1 }
  ]),
  async (req, res) => {
    const jobId = req.jobId || crypto.randomBytes(8).toString("hex");
    const jobDir = req.jobDir || path.join(TMP_ROOT, `job-${jobId}`);

    try {
      const videoFile = req.files?.video?.[0];
      const srtFile = req.files?.srt?.[0];
      const fontSize = Number(req.body.fontSize || 42);
      const position = String(req.body.position || "bottom");

      if (!videoFile) return res.status(400).send("Vidéo manquante");
      if (!srtFile) return res.status(400).send("SRT manquant");

      const inputVideoPath = videoFile.path;
      const inputSrtPath = srtFile.path;
      const outputPath = path.join(jobDir, "output.mp4");

      const rawSrt = await fs.readFile(inputSrtPath, "utf8");
      await fs.writeFile(inputSrtPath, normalizeSrtText(rawSrt), "utf8");

      const videoStat = await fs.stat(inputVideoPath);
      console.log(`[${jobId}] Upload reçu - vidéo=${formatSize(videoStat.size)} srt=${srtFile.size}o`);

      const subtitleFilter = buildSubtitleFilter(inputSrtPath, fontSize, position);
      console.log(`[${jobId}] FFmpeg START`);

      await execFileAsync(
        ffmpegPath,
        [
          "-hide_banner",
          "-y",
          "-i", inputVideoPath,
          "-vf", subtitleFilter,
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-crf", "18",
          "-c:a", "copy",
          "-movflags", "+faststart",
          outputPath
        ],
        { timeout: 25 * 60 * 1000, maxBuffer: 1024 * 1024 * 20 }
      );

      const outputStat = await fs.stat(outputPath);
      console.log(`[${jobId}] FFmpeg OK - sortie=${formatSize(outputStat.size)}`);

      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", "attachment; filename=video-sous-titree-render.mp4");
      res.setHeader("Content-Length", outputStat.size);

      res.download(outputPath, "video-sous-titree-render.mp4", async error => {
        if (error) console.error(`[${jobId}] Erreur téléchargement`, error);
        await cleanupJob(jobId, jobDir);
      });
    } catch (error) {
      console.error(`[${jobId}] Erreur FFmpeg`, error);
      if (!res.headersSent) {
        res.status(500).send("Erreur Render FFmpeg : " + error.message);
      }
      await cleanupJob(jobId, jobDir);
    }
  }
);

function normalizeSrtText(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .concat("\n");
}

function buildSubtitleFilter(srtPath, fontSize, position) {
  const safePath = escapeSubtitlePath(srtPath);
  const size = Math.max(18, Math.min(fontSize, 72));

  let alignment = 2;
  let marginV = 42;

  if (position === "top") {
    alignment = 8;
    marginV = 42;
  }

  if (position === "middle") {
    alignment = 5;
    marginV = 20;
  }

  const forceStyle = [
    "FontName=Arial",
    `FontSize=${size}`,
    "Bold=1",
    "PrimaryColour=&H00FFFFFF",
    "OutlineColour=&H00000000",
    "BackColour=&H99000000",
    "BorderStyle=3",
    "Outline=2",
    "Shadow=0",
    `Alignment=${alignment}`,
    `MarginV=${marginV}`
  ].join(",");

  return `subtitles='${safePath}':force_style='${forceStyle}'`;
}

function escapeSubtitlePath(filePath) {
  return filePath
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

async function cleanupJob(jobId, jobDir) {
  try {
    await fs.rm(jobDir, { recursive: true, force: true });
    console.log(`[${jobId}] Nettoyage OK`);
  } catch (cleanupError) {
    console.error(`[${jobId}] Nettoyage impossible`, cleanupError);
  }
}

function formatSize(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} Mo`;
}

app.listen(PORT, () => {
  console.log(`Serveur Render FFmpeg démarré sur le port ${PORT}`);
});
