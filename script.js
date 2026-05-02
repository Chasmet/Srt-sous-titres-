import { FFmpeg } from "https://esm.sh/@ffmpeg/ffmpeg@0.12.15";
import { fetchFile, toBlobURL } from "https://esm.sh/@ffmpeg/util@0.12.2";

const videoFile = document.getElementById("videoFile");
const videoName = document.getElementById("videoName");
const srtInput = document.getElementById("srtInput");
const pasteBtn = document.getElementById("pasteBtn");
const copyBtn = document.getElementById("copyBtn");
const downloadSrtBtn = document.getElementById("downloadSrtBtn");
const srtStatus = document.getElementById("srtStatus");
const fontSize = document.getElementById("fontSize");
const fontSizeValue = document.getElementById("fontSizeValue");
const qualitySelect = document.getElementById("qualitySelect");
const formatSelect = document.getElementById("formatSelect");
const startBtn = document.getElementById("startBtn");
const progressBox = document.getElementById("progressBox");
const progressText = document.getElementById("progressText");
const progressPercent = document.getElementById("progressPercent");
const progressBar = document.getElementById("progressBar");
const downloadVideoBtn = document.getElementById("downloadVideoBtn");
const message = document.getElementById("message");

let ffmpeg = null;
let ffmpegLoaded = false;
let selectedVideo = null;
let finalUrl = null;

videoFile.addEventListener("change", () => {
  selectedVideo = videoFile.files && videoFile.files[0] ? videoFile.files[0] : null;

  if (!selectedVideo) {
    videoName.textContent = "Aucune vidéo sélectionnée";
    showMessage("Aucune vidéo sélectionnée.", "");
    return;
  }

  const sizeMo = selectedVideo.size / 1024 / 1024;
  videoName.textContent = `${selectedVideo.name} - ${sizeMo.toFixed(1)} Mo`;

  if (sizeMo > 250) {
    showMessage("Vidéo lourde : sur téléphone, ça peut être lent. Fais un test court d’abord.", "warning");
  } else {
    showMessage("Vidéo prête.", "success");
  }
});

srtInput.addEventListener("input", validateSrt);

fontSize.addEventListener("input", () => {
  fontSizeValue.textContent = fontSize.value;
});

pasteBtn.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    srtInput.value = cleanSrt(text);
    validateSrt();
    showMessage("SRT collé.", "success");
  } catch (error) {
    showMessage("Collage automatique bloqué. Colle le SRT manuellement dans la zone.", "error");
  }
});

copyBtn.addEventListener("click", async () => {
  const srt = cleanSrt(srtInput.value);
  if (!srt) return showMessage("Aucun SRT à copier.", "error");

  try {
    await navigator.clipboard.writeText(srt);
    showMessage("SRT copié.", "success");
  } catch (error) {
    srtInput.select();
    document.execCommand("copy");
    showMessage("SRT copié.", "success");
  }
});

downloadSrtBtn.addEventListener("click", () => {
  const srt = cleanSrt(srtInput.value);
  if (!srt) return showMessage("Aucun SRT à télécharger.", "error");
  downloadBlob(new Blob([srt], { type: "text/plain;charset=utf-8" }), "sous-titres.srt");
  showMessage("SRT téléchargé.", "success");
});

startBtn.addEventListener("click", processVideo);

function cleanSrt(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

function validateSrt() {
  const srt = cleanSrt(srtInput.value);

  if (!srt) {
    srtStatus.textContent = "SRT en attente.";
    srtStatus.className = "status";
    return false;
  }

  const valid = /\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/.test(srt);

  if (!valid) {
    srtStatus.textContent = "SRT mal formaté : vérifie les timecodes.";
    srtStatus.className = "status warning";
    return false;
  }

  const cueCount = (srt.match(/-->/g) || []).length;
  srtStatus.textContent = `SRT valide : ${cueCount} ligne${cueCount > 1 ? "s" : ""} détectée${cueCount > 1 ? "s" : ""}.`;
  srtStatus.className = "status success";
  return true;
}

async function loadFFmpeg() {
  if (ffmpegLoaded) return;

  ffmpeg = new FFmpeg();

  ffmpeg.on("progress", ({ progress }) => {
    const value = Math.min(98, Math.max(5, Math.round(progress * 100)));
    setProgress(value, "Traitement vidéo en cours...");
  });

  ffmpeg.on("log", ({ message: log }) => {
    if (log && log.toLowerCase().includes("error")) console.warn(log);
  });

  setProgress(2, "Chargement du moteur vidéo...");

  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";

  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm")
  });

  ffmpegLoaded = true;
}

async function processVideo() {
  resetDownload();

  if (!selectedVideo) return showMessage("Ajoute d’abord une vidéo.", "error");
  if (!validateSrt()) return showMessage("Colle un SRT valide avant de lancer.", "error");

  const srt = cleanSrt(srtInput.value);

  try {
    lockUi(true);
    progressBox.classList.remove("hidden");
    showMessage("Préparation du traitement local.", "loading");

    await loadFFmpeg();

    const inputName = getInputName(selectedVideo.name);
    const srtName = "subtitles.srt";
    const outputName = "video-sous-titree.mp4";

    setProgress(8, "Chargement vidéo + SRT...");
    await ffmpeg.writeFile(inputName, await fetchFile(selectedVideo));
    await ffmpeg.writeFile(srtName, new TextEncoder().encode(srt));

    const args = [
      "-i", inputName,
      "-vf", buildFilter(srtName),
      ...qualityArgs(),
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      outputName
    ];

    setProgress(12, "Incrustation des sous-titres...");
    await ffmpeg.exec(args);

    setProgress(98, "Préparation du téléchargement...");
    const data = await ffmpeg.readFile(outputName);
    const blob = new Blob([data.buffer], { type: "video/mp4" });

    finalUrl = URL.createObjectURL(blob);
    downloadVideoBtn.href = finalUrl;
    downloadVideoBtn.classList.remove("hidden");

    setProgress(100, "Terminé.");
    showMessage(`Vidéo finale prête : ${(blob.size / 1024 / 1024).toFixed(1)} Mo.`, "success");

    await safeDelete(inputName);
    await safeDelete(srtName);
    await safeDelete(outputName);
  } catch (error) {
    console.error(error);
    showMessage("Erreur pendant l’export. Essaie une vidéo plus courte ou plus légère.", "error");
    setProgress(0, "Échec.");
  } finally {
    lockUi(false);
  }
}

function buildFilter(srtName) {
  const size = Number(fontSize.value) || 30;
  const subtitle = `subtitles=${srtName}:force_style='FontName=Arial,FontSize=${size},PrimaryColour=&H00FFFFFF&,OutlineColour=&H00000000&,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=70'`;
  const format = formatSelect.value;

  if (format === "vertical") {
    return `scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,${subtitle}`;
  }

  if (format === "square") {
    return `scale=1080:1080:force_original_aspect_ratio=decrease,pad=1080:1080:(ow-iw)/2:(oh-ih)/2,${subtitle}`;
  }

  if (format === "horizontal") {
    return `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,${subtitle}`;
  }

  return subtitle;
}

function qualityArgs() {
  const quality = qualitySelect.value;

  if (quality === "fast") return ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "30"];
  if (quality === "small") return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "34"];
  return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "28"];
}

function getInputName(name) {
  const ext = String(name || "video.mp4").split(".").pop().toLowerCase() || "mp4";
  return `source.${ext}`;
}

async function safeDelete(name) {
  try {
    await ffmpeg.deleteFile(name);
  } catch (error) {
    console.warn(`Suppression impossible : ${name}`);
  }
}

function setProgress(value, text) {
  progressBar.value = value;
  progressPercent.textContent = `${value}%`;
  progressText.textContent = text;
}

function showMessage(text, type) {
  message.textContent = text;
  message.className = "status";
  if (type) message.classList.add(type);
}

function lockUi(locked) {
  startBtn.disabled = locked;
  videoFile.disabled = locked;
  srtInput.disabled = locked;
  pasteBtn.disabled = locked;
  copyBtn.disabled = locked;
  downloadSrtBtn.disabled = locked;
  fontSize.disabled = locked;
  qualitySelect.disabled = locked;
  formatSelect.disabled = locked;
  startBtn.textContent = locked ? "Traitement en cours..." : "Incruster et compresser";
}

function resetDownload() {
  if (finalUrl) URL.revokeObjectURL(finalUrl);
  finalUrl = null;
  downloadVideoBtn.href = "#";
  downloadVideoBtn.classList.add("hidden");
  setProgress(0, "Préparation...");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

validateSrt();
