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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 600 * 1024 * 1024
  }
});

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "2mb" }));

app.get("/", (req, res) => {
  res.status(200).json({
    ok: true,
    name: "Sous-titres IA Render FFmpeg",
    routes: ["POST /api/burn-subtitles"]
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
    const jobId = crypto.randomBytes(8).toString("hex");
    const jobDir = path.join(os.tmpdir(), `srt-job-${jobId}`);

    try {
      const videoFile = req.files?.video?.[0];
      const srtFile = req.files?.srt?.[0];
      const fontSize = Number(req.body.fontSize || 42);
      const position = String(req.body.position || "bottom");

      if (!videoFile) return res.status(400).send("Vidéo manquante");
      if (!srtFile) return res.status(400).send("SRT manquant");

      await fs.mkdir(jobDir, { recursive: true });

      const inputVideoPath = path.join(jobDir, "input.mp4");
      const inputSrtPath = path.join(jobDir, "subtitles.srt");
      const outputPath = path.join(jobDir, "output.mp4");

      await fs.writeFile(inputVideoPath, videoFile.buffer);
      await fs.writeFile(inputSrtPath, normalizeSrtText(srtFile.buffer.toString("utf8")), "utf8");

      const subtitleFilter = buildSubtitleFilter(inputSrtPath, fontSize, position);

      await execFileAsync(
        ffmpegPath,
        [
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

      const outputBuffer = await fs.readFile(outputPath);

      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", "attachment; filename=video-sous-titree-render.mp4");
      res.setHeader("Content-Length", outputBuffer.length);
      res.status(200).send(outputBuffer);
    } catch (error) {
      console.error(`[${jobId}] Erreur FFmpeg`, error);
      res.status(500).send("Erreur Render FFmpeg : " + error.message);
    } finally {
      try {
        await fs.rm(jobDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error(`[${jobId}] Nettoyage impossible`, cleanupError);
      }
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

app.listen(PORT, () => {
  console.log(`Serveur Render FFmpeg démarré sur le port ${PORT}`);
});
