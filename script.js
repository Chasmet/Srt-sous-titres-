const workerUrlInput = document.getElementById("workerUrl");
const audioFileInput = document.getElementById("audioFile");
const videoFileInput = document.getElementById("videoFile");
const videoPreview = document.getElementById("videoPreview");
const srtOutput = document.getElementById("srtOutput");
const statusBox = document.getElementById("status");
const subtitleOverlay = document.getElementById("subtitleOverlay");
const fontSizeSelect = document.getElementById("fontSize");
const subtitlePositionSelect = document.getElementById("subtitlePosition");
const exportProgress = document.getElementById("exportProgress");
const downloadVideoLink = document.getElementById("downloadVideoLink");

const saveWorkerBtn = document.getElementById("saveWorkerBtn");
const loadVideoBtn = document.getElementById("loadVideoBtn");
const generateBtn = document.getElementById("generateBtn");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");
const burnBtn = document.getElementById("burnBtn");

let currentSrtText = "";
let currentTrackUrl = null;
let subtitleCues = [];
let videoObjectUrl = null;
let finalVideoUrl = null;
let overlayTimer = null;

window.addEventListener("load", () => {
  const savedWorkerUrl = localStorage.getItem("srt_app_worker_url");
  if (savedWorkerUrl) workerUrlInput.value = savedWorkerUrl;
});

saveWorkerBtn.addEventListener("click", () => {
  const url = normalizeWorkerUrl(workerUrlInput.value.trim());
  if (!url) return showStatus("Ajoute l’URL de ton Worker Cloudflare.", "error");
  localStorage.setItem("srt_app_worker_url", url);
  workerUrlInput.value = url;
  showStatus("Lien Worker sauvegardé sur ce téléphone.", "success");
});

loadVideoBtn.addEventListener("click", () => {
  const videoFile = videoFileInput.files[0];
  if (!videoFile) return showStatus("Ajoute une vidéo avant de charger la prévisualisation.", "error");

  if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
  videoObjectUrl = URL.createObjectURL(videoFile);
  videoPreview.src = videoObjectUrl;
  videoPreview.load();

  startOverlayLoop();
  showStatus("Vidéo chargée. Tu peux maintenant générer les sous-titres.", "success");
});

generateBtn.addEventListener("click", async () => {
  const workerUrl = normalizeWorkerUrl(workerUrlInput.value.trim() || localStorage.getItem("srt_app_worker_url") || "");
  const audioFile = audioFileInput.files[0];

  if (!workerUrl) return showStatus("Ajoute le lien Cloudflare Worker.", "error");
  if (!audioFile) return showStatus("Ajoute un fichier audio.", "error");
  if (audioFile.size > 25 * 1024 * 1024) return showStatus("Ton audio dépasse 25 Mo. Coupe-le ou compresse-le avant.", "error");

  try {
    localStorage.setItem("srt_app_worker_url", workerUrl);
    workerUrlInput.value = workerUrl;

    showStatus("Envoi de l’audio au Worker Cloudflare...", "loading");
    generateBtn.disabled = true;
    generateBtn.textContent = "Génération en cours...";

    const formData = new FormData();
    formData.append("file", audioFile);
    formData.append("language", "fr");

    const response = await fetch(workerUrl, {
      method: "POST",
      body: formData
    });

    const text = await response.text();
    if (!response.ok) {
      console.error(text);
      return showStatus("Erreur Worker/OpenAI. Vérifie ton Worker et ta clé OpenAI dans Cloudflare.", "error");
    }

    currentSrtText = text;
    srtOutput.value = text;
    subtitleCues = parseSrt(text);
    createVideoSubtitles(text);
    startOverlayLoop();

    showStatus("Sous-titres générés avec succès.", "success");
  } catch (error) {
    console.error(error);
    showStatus("Erreur : impossible de contacter le Worker Cloudflare.", "error");
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = "Générer les sous-titres SRT";
  }
});

copyBtn.addEventListener("click", async () => {
  const text = srtOutput.value.trim();
  if (!text) return showStatus("Aucun SRT à copier.", "error");

  try {
    await navigator.clipboard.writeText(text);
    showStatus("SRT copié.", "success");
  } catch (error) {
    srtOutput.select();
    document.execCommand("copy");
    showStatus("SRT copié.", "success");
  }
});

downloadBtn.addEventListener("click", () => {
  const text = srtOutput.value.trim();
  if (!text) return showStatus("Aucun SRT à télécharger.", "error");
  downloadTextFile(text, "sous-titres.srt", "text/plain;charset=utf-8");
  showStatus("Fichier SRT téléchargé.", "success");
});

burnBtn.addEventListener("click", async () => {
  const videoFile = videoFileInput.files[0];
  const srtText = srtOutput.value.trim();

  if (!videoFile) return showStatus("Ajoute une vidéo avant l’export.", "error");
  if (!srtText) return showStatus("Génère les sous-titres avant l’export.", "error");
  if (!window.MediaRecorder) return showStatus("Ton navigateur ne permet pas l’export vidéo ici.", "error");

  subtitleCues = parseSrt(srtText);
  if (!subtitleCues.length) return showStatus("Le SRT est vide ou mal formaté.", "error");

  try {
    burnBtn.disabled = true;
    burnBtn.textContent = "Export en cours...";
    exportProgress.value = 0;
    downloadVideoLink.classList.remove("show");
    showStatus("Préparation de l’export vidéo...", "loading");

    const resultBlob = await renderSubtitledVideo(videoFile, subtitleCues);

    if (finalVideoUrl) URL.revokeObjectURL(finalVideoUrl);
    finalVideoUrl = URL.createObjectURL(resultBlob);
    downloadVideoLink.href = finalVideoUrl;
    downloadVideoLink.classList.add("show");

    showStatus("Vidéo sous-titrée créée. Appuie sur Télécharger.", "success");
  } catch (error) {
    console.error(error);
    showStatus("Erreur pendant l’export vidéo. Essaie une vidéo plus courte.", "error");
  } finally {
    burnBtn.disabled = false;
    burnBtn.textContent = "Créer la vidéo sous-titrée";
  }
});

fontSizeSelect.addEventListener("change", updateOverlayPositionAndSize);
subtitlePositionSelect.addEventListener("change", updateOverlayPositionAndSize);
videoPreview.addEventListener("play", startOverlayLoop);
videoPreview.addEventListener("pause", updateSubtitleOverlay);
videoPreview.addEventListener("seeked", updateSubtitleOverlay);
videoPreview.addEventListener("timeupdate", updateSubtitleOverlay);

function normalizeWorkerUrl(url) {
  if (!url) return "";
  const clean = url.trim().replace(/\/+$/, "");
  if (!clean.startsWith("https://")) return "";
  return clean;
}

function createVideoSubtitles(srtText) {
  if (!videoPreview.src) return;

  const oldTracks = videoPreview.querySelectorAll("track");
  oldTracks.forEach(track => track.remove());
  if (currentTrackUrl) URL.revokeObjectURL(currentTrackUrl);

  const vttText = convertSrtToVtt(srtText);
  const blob = new Blob([vttText], { type: "text/vtt;charset=utf-8" });
  currentTrackUrl = URL.createObjectURL(blob);

  const track = document.createElement("track");
  track.kind = "subtitles";
  track.label = "Français";
  track.srclang = "fr";
  track.src = currentTrackUrl;
  track.default = true;
  videoPreview.appendChild(track);

  setTimeout(() => {
    if (videoPreview.textTracks && videoPreview.textTracks[0]) {
      videoPreview.textTracks[0].mode = "hidden";
    }
  }, 300);
}

function convertSrtToVtt(srtText) {
  let cleanText = srtText.replace(/\r+/g, "").trim();
  cleanText = cleanText.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return "WEBVTT\n\n" + cleanText + "\n";
}

function parseSrt(srtText) {
  const blocks = srtText.replace(/\r/g, "").trim().split(/\n\s*\n/);
  const cues = [];

  for (const block of blocks) {
    const lines = block.split("\n").map(line => line.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    let timeLineIndex = lines.findIndex(line => line.includes("-->"));
    if (timeLineIndex === -1) continue;

    const timeLine = lines[timeLineIndex];
    const parts = timeLine.split("-->");
    if (parts.length !== 2) continue;

    const start = timeToSeconds(parts[0].trim());
    const end = timeToSeconds(parts[1].trim());
    const text = lines.slice(timeLineIndex + 1).join(" ").trim();

    if (!Number.isNaN(start) && !Number.isNaN(end) && text) {
      cues.push({ start, end, text });
    }
  }

  return cues;
}

function timeToSeconds(time) {
  const clean = time.replace(",", ".");
  const parts = clean.split(":");
  if (parts.length !== 3) return NaN;
  return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
}

function getSubtitleAt(time) {
  const cue = subtitleCues.find(item => time >= item.start && time <= item.end);
  return cue ? cue.text : "";
}

function startOverlayLoop() {
  if (overlayTimer) cancelAnimationFrame(overlayTimer);

  const loop = () => {
    updateSubtitleOverlay();
    overlayTimer = requestAnimationFrame(loop);
  };

  overlayTimer = requestAnimationFrame(loop);
}

function updateSubtitleOverlay() {
  updateOverlayPositionAndSize();
  if (!subtitleCues.length) {
    subtitleOverlay.textContent = "";
    return;
  }
  subtitleOverlay.textContent = getSubtitleAt(videoPreview.currentTime);
}

function updateOverlayPositionAndSize() {
  const size = Math.max(18, Number(fontSizeSelect.value) / 2);
  subtitleOverlay.style.fontSize = `${size}px`;

  const position = subtitlePositionSelect.value;
  subtitleOverlay.style.top = "auto";
  subtitleOverlay.style.bottom = "auto";

  if (position === "top") subtitleOverlay.style.top = "8%";
  if (position === "middle") subtitleOverlay.style.top = "45%";
  if (position === "bottom") subtitleOverlay.style.bottom = "8%";
}

async function renderSubtitledVideo(videoFile, cues) {
  const video = document.createElement("video");
  video.src = URL.createObjectURL(videoFile);
  video.muted = false;
  video.playsInline = true;
  video.crossOrigin = "anonymous";

  await waitForVideoMetadata(video);

  const width = video.videoWidth || 720;
  const height = video.videoHeight || 1280;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  const canvasStream = canvas.captureStream(30);
  const audioStream = video.captureStream ? video.captureStream() : null;

  if (audioStream) {
    const audioTracks = audioStream.getAudioTracks();
    audioTracks.forEach(track => canvasStream.addTrack(track));
  }

  const mimeType = getSupportedMimeType();
  const recorder = new MediaRecorder(canvasStream, { mimeType });
  const chunks = [];

  recorder.ondataavailable = event => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };

  const done = new Promise((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.onerror = event => reject(event.error || new Error("Erreur MediaRecorder"));
  });

  recorder.start(1000);
  video.currentTime = 0;
  await video.play();

  const fontSize = Number(fontSizeSelect.value);
  const position = subtitlePositionSelect.value;
  const duration = video.duration || 1;

  await new Promise(resolve => {
    function drawFrame() {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(video, 0, 0, width, height);

      const text = getCueTextAt(cues, video.currentTime);
      if (text) drawSubtitle(ctx, text, width, height, fontSize, position);

      exportProgress.value = Math.min(100, Math.round((video.currentTime / duration) * 100));

      if (video.ended || video.currentTime >= duration) {
        resolve();
        return;
      }

      requestAnimationFrame(drawFrame);
    }

    drawFrame();
  });

  recorder.stop();
  video.pause();
  URL.revokeObjectURL(video.src);
  exportProgress.value = 100;
  return await done;
}

function waitForVideoMetadata(video) {
  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Impossible de lire la vidéo"));
  });
}

function getCueTextAt(cues, time) {
  const cue = cues.find(item => time >= item.start && time <= item.end);
  return cue ? cue.text : "";
}

function drawSubtitle(ctx, text, width, height, fontSize, position) {
  const paddingX = Math.round(width * 0.06);
  const maxWidth = width - paddingX * 2;
  const lineHeight = Math.round(fontSize * 1.25);
  const lines = wrapText(ctx, text, maxWidth, fontSize);
  const blockHeight = lines.length * lineHeight + 24;

  let y;
  if (position === "top") y = Math.round(height * 0.12);
  else if (position === "middle") y = Math.round(height * 0.5 - blockHeight / 2);
  else y = Math.round(height - blockHeight - height * 0.08);

  const boxX = paddingX;
  const boxY = y - 12;
  const boxW = maxWidth;
  const boxH = blockHeight;

  ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
  roundRect(ctx, boxX, boxY, boxW, boxH, 20);
  ctx.fill();

  ctx.font = `900 ${fontSize}px Arial`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = Math.max(5, fontSize * 0.12);
  ctx.fillStyle = "#ffffff";

  lines.forEach((line, index) => {
    const lineY = y + index * lineHeight;
    ctx.strokeText(line, width / 2, lineY);
    ctx.fillText(line, width / 2, lineY);
  });
}

function wrapText(ctx, text, maxWidth, fontSize) {
  ctx.font = `900 ${fontSize}px Arial`;
  const words = text.split(" ");
  const lines = [];
  let line = "";

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  }

  if (line) lines.push(line);
  return lines.slice(0, 3);
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function getSupportedMimeType() {
  const types = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];

  return types.find(type => MediaRecorder.isTypeSupported(type)) || "video/webm";
}

function downloadTextFile(text, filename, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function showStatus(message, type) {
  statusBox.textContent = message;
  statusBox.className = "status";
  if (type) statusBox.classList.add(type);
}
