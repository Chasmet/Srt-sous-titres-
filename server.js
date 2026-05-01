import express from "express";
import cors from "cors";
import multer from "multer";
import ffmpegPath from "ffmpeg-static";
import { promises as fs } from "fs";
import { createReadStream, createWriteStream } from "fs";
import path from "path";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import { pipeline } from "stream/promises";
import crypto from "crypto";

const execFileAsync = promisify(execFile);
const app = express();
const PORT = process.env.PORT || 3000;
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 900);
const CHUNK_SIZE_MB = Number(process.env.CHUNK_SIZE_MB || 250);
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

const chunkStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const jobId = safeId(req.query.jobId);
      if (!jobId) return cb(new Error("jobId manquant"));
      const chunkDir = path.join(TMP_ROOT, `job-${jobId}`, "chunks");
      await fs.mkdir(chunkDir, { recursive: true });
      cb(null, chunkDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const index = Number(req.query.index);
    if (!Number.isInteger(index) || index < 0) return cb(new Error("index invalide"));
    cb(null, `${String(index).padStart(6, "0")}.part`);
  }
});

const uploadChunk = multer({
  storage: chunkStorage,
  limits: {
    fileSize: (CHUNK_SIZE_MB + 30) * 1024 * 1024,
    files: 1
  }
});

app.use(cors({ origin: "*" }));
app.options("*", cors({ origin: "*" }));
app.use(express.json({ limit: "20mb" }));

app.use((req, res, next) => {
  const size = req.headers["content-length"] ? formatSize(Number(req.headers["content-length"])) : "inconnu";
  console.log(`[REQ] ${req.method} ${req.url} taille=${size}`);
  req.on("aborted", () => {
    console.error(`[REQ] Upload interrompu par le client : ${req.method} ${req.url}`);
  });
  next();
});

app.get("/", (req, res) => {
  res.status(200).json({
    ok: true,
    name: "Sous-titres IA Render FFmpeg",
    memoryMode: "disk-streaming + chunk-upload",
    maxUploadMb: MAX_UPLOAD_MB,
    chunkSizeMb: CHUNK_SIZE_MB,
    routes: [
      "POST /api/burn-subtitles",
      "POST /api/chunk/init",
      "POST /api/chunk/upload",
      "POST /api/chunk/finish",
      "GET /health"
    ]
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

app.post("/api/burn-subtitles", (req, res) => {
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "srt", maxCount: 1 }
  ])(req, res, async error => {
    const jobId = req.jobId || crypto.randomBytes(8).toString("hex");
    const jobDir = req.jobDir || path.join(TMP_ROOT, `job-${jobId}`);

    if (error) {
      console.error(`[${jobId}] Erreur upload multer`, error);
      await cleanupJob(jobId, jobDir);
      if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(413).send(`Fichier trop lourd pour l’envoi simple. Utilise l’envoi fragmenté. Limite simple : ${MAX_UPLOAD_MB} Mo.`);
      }
      return res.status(400).send("Erreur upload : " + error.message);
    }

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

      await burnSubtitlesAndSend({ req, res, jobId, jobDir, inputVideoPath, inputSrtPath, outputPath, fontSize, position });
    } catch (processError) {
      console.error(`[${jobId}] Erreur FFmpeg`, processError);
      if (!res.headersSent) {
        res.status(500).send("Erreur Render FFmpeg : " + processError.message);
      }
      await cleanupJob(jobId, jobDir);
    }
  });
});

app.post("/api/chunk/init", async (req, res) => {
  const jobId = crypto.randomBytes(8).toString("hex");
  const jobDir = path.join(TMP_ROOT, `job-${jobId}`);

  try {
    const { fileName, fileSize, totalChunks, srtText, fontSize, position } = req.body || {};
    if (!fileName) return res.status(400).send("Nom de fichier manquant");
    if (!srtText) return res.status(400).send("SRT manquant");
    if (!Number.isFinite(Number(fileSize))) return res.status(400).send("Taille vidéo invalide");

    await fs.mkdir(path.join(jobDir, "chunks"), { recursive: true });
    await fs.writeFile(path.join(jobDir, "subtitles.srt"), normalizeSrtText(String(srtText)), "utf8");
    await fs.writeFile(path.join(jobDir, "meta.json"), JSON.stringify({
      jobId,
      fileName,
      fileSize: Number(fileSize),
      totalChunks: Number(totalChunks),
      fontSize: Number(fontSize || 42),
      position: String(position || "bottom"),
      createdAt: new Date().toISOString()
    }, null, 2), "utf8");

    console.log(`[${jobId}] Init upload fragmenté - fichier=${fileName} taille=${formatSize(Number(fileSize))} chunks=${totalChunks}`);
    res.status(200).json({ ok: true, jobId, chunkSizeMb: CHUNK_SIZE_MB });
  } catch (error) {
    console.error(`[${jobId}] Erreur init chunk`, error);
    await cleanupJob(jobId, jobDir);
    res.status(500).send("Erreur init chunk : " + error.message);
  }
});

app.post("/api/chunk/upload", (req, res) => {
  const jobId = safeId(req.query.jobId);
  const index = Number(req.query.index);

  if (!jobId) return res.status(400).send("jobId manquant");
  if (!Number.isInteger(index) || index < 0) return res.status(400).send("index invalide");

  uploadChunk.single("chunk")(req, res, async error => {
    if (error) {
      console.error(`[${jobId}] Erreur upload chunk ${index}`, error);
      if (error.code === "LIMIT_FILE_SIZE") return res.status(413).send(`Fragment trop lourd. Taille max : ${CHUNK_SIZE_MB} Mo.`);
      return res.status(400).send("Erreur upload chunk : " + error.message);
    }

    if (!req.file) return res.status(400).send("Fragment manquant");

    console.log(`[${jobId}] Chunk ${index} reçu - ${formatSize(req.file.size)}`);
    res.status(200).json({ ok: true, jobId, index, size: req.file.size });
  });
});

app.post("/api/chunk/finish", async (req, res) => {
  const jobId = safeId(req.body?.jobId);
  if (!jobId) return res.status(400).send("jobId manquant");

  const jobDir = path.join(TMP_ROOT, `job-${jobId}`);
  const chunkDir = path.join(jobDir, "chunks");
  const inputVideoPath = path.join(jobDir, "input.mp4");
  const inputSrtPath = path.join(jobDir, "subtitles.srt");
  const outputPath = path.join(jobDir, "output.mp4");

  try {
    const meta = JSON.parse(await fs.readFile(path.join(jobDir, "meta.json"), "utf8"));
    const totalChunks = Number(req.body?.totalChunks || meta.totalChunks);
    if (!Number.isInteger(totalChunks) || totalChunks <= 0) return res.status(400).send("Nombre de fragments invalide");

    console.log(`[${jobId}] Assemblage ${totalChunks} fragments START`);
    await assembleChunks(chunkDir, inputVideoPath, totalChunks);

    const videoStat = await fs.stat(inputVideoPath);
    console.log(`[${jobId}] Assemblage OK - vidéo=${formatSize(videoStat.size)}`);

    await burnSubtitlesAndSend({
      req,
      res,
      jobId,
      jobDir,
      inputVideoPath,
      inputSrtPath,
      outputPath,
      fontSize: Number(meta.fontSize || 42),
      position: String(meta.position || "bottom")
    });
  } catch (error) {
    console.error(`[${jobId}] Erreur finish chunk`, error);
    if (!res.headersSent) res.status(500).send("Erreur finish chunk : " + error.message);
    await cleanupJob(jobId, jobDir);
  }
});

async function burnSubtitlesAndSend({ req, res, jobId, jobDir, inputVideoPath, inputSrtPath, outputPath, fontSize, position }) {
  const videoStat = await fs.stat(inputVideoPath);
  console.log(`[${jobId}] FFmpeg START - vidéo=${formatSize(videoStat.size)}`);

  const subtitleFilter = buildSubtitleFilter(inputSrtPath, fontSize, position);

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
    { timeout: 45 * 60 * 1000, maxBuffer: 1024 * 1024 * 30 }
  );

  const outputStat = await fs.stat(outputPath);
  console.log(`[${jobId}] FFmpeg OK - sortie=${formatSize(outputStat.size)}`);

  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", "attachment; filename=video-sous-titree-render.mp4");
  res.setHeader("Content-Length", outputStat.size);

  res.download(outputPath, "video-sous-titree-render.mp4", async downloadError => {
    if (downloadError) console.error(`[${jobId}] Erreur téléchargement`, downloadError);
    await cleanupJob(jobId, jobDir);
  });
}

async function assembleChunks(chunkDir, outputPath, totalChunks) {
  const output = createWriteStream(outputPath);

  try {
    for (let index = 0; index < totalChunks; index++) {
      const chunkPath = path.join(chunkDir, `${String(index).padStart(6, "0")}.part`);
      await fs.access(chunkPath);
      await pipeline(createReadStream(chunkPath), output, { end: false });
    }
  } finally {
    output.end();
  }
}

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

function safeId(value) {
  const id = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{6,64}$/.test(id) ? id : "";
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
  if (!Number.isFinite(bytes)) return "inconnu";
  return `${(bytes / 1024 / 1024).toFixed(2)} Mo`;
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Serveur Render FFmpeg démarré sur le port ${PORT}`);
});
