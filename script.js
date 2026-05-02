const workerUrl = document.getElementById("workerUrl");
const apiAudioFile = document.getElementById("apiAudioFile");
const apiAudioName = document.getElementById("apiAudioName");
const saveWorkerBtn = document.getElementById("saveWorkerBtn");
const generateSrtBtn = document.getElementById("generateSrtBtn");
const apiStatus = document.getElementById("apiStatus");

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
const splitExportBtn = document.getElementById("splitExportBtn");
const progressBox = document.getElementById("progressBox");
const progressText = document.getElementById("progressText");
const progressPercent = document.getElementById("progressPercent");
const progressBar = document.getElementById("progressBar");
const downloadVideoBtn = document.getElementById("downloadVideoBtn");
const downloadsBox = document.getElementById("downloadsBox");
const message = document.getElementById("message");
const hiddenVideo = document.getElementById("hiddenVideo");
const exportCanvas = document.getElementById("exportCanvas");

const API_MAX_SIZE = 25 * 1024 * 1024;
const EXPORT_FPS = 30;
const SPLIT_COUNT = 3;

let selectedVideo = null;
let selectedApiAudio = null;
let videoObjectUrl = null;
let localUrl = null;
let subtitleCues = [];
let exportRunning = false;
let drawFrameId = null;
let partUrls = [];

hiddenVideo.muted = true;
hiddenVideo.playsInline = true;
hiddenVideo.preload = "metadata";

const savedWorker = localStorage.getItem("srt_app_worker_url");
if (savedWorker) workerUrl.value = savedWorker;

saveWorkerBtn.addEventListener("click", () => {
  const url = normalizeUrl(workerUrl.value);
  if (!url) return showApiStatus("Lien Worker invalide. Il doit commencer par https://", "error");
  localStorage.setItem("srt_app_worker_url", url);
  workerUrl.value = url;
  showApiStatus("Worker sauvegardé sur ce téléphone.", "success");
});

apiAudioFile.addEventListener("change", () => {
  const file = apiAudioFile.files && apiAudioFile.files[0] ? apiAudioFile.files[0] : null;
  if (!file) return;
  selectedApiAudio = file;
  apiAudioName.textContent = `${file.name} - ${formatMo(file.size)}`;
  if (file.size > API_MAX_SIZE) {
    showApiStatus("Audio trop lourd pour l’API. Utilise un audio plus court ou compressé, moins de 25 Mo.", "error");
  } else {
    showApiStatus("Audio prêt pour génération SRT.", "success");
  }
});

generateSrtBtn.addEventListener("click", generateSrtWithApi);

videoFile.addEventListener("change", () => {
  selectedVideo = videoFile.files && videoFile.files[0] ? videoFile.files[0] : null;
  if (!selectedVideo) {
    videoName.textContent = "Aucune vidéo sélectionnée";
    showMessage("Aucune vidéo sélectionnée.", "");
    return;
  }

  videoName.textContent = `${selectedVideo.name} - ${formatMo(selectedVideo.size)}`;

  if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
  videoObjectUrl = URL.createObjectURL(selectedVideo);
  hiddenVideo.src = videoObjectUrl;
  hiddenVideo.muted = true;
  hiddenVideo.load();

  showMessage("Vidéo prête. Tu peux coller le SRT puis exporter en local.", "success");
});

srtInput.addEventListener("input", validateSrt);
fontSize.addEventListener("input", () => fontSizeValue.textContent = fontSize.value);
startBtn.addEventListener("click", () => exportOneLocalVideo());
splitExportBtn.addEventListener("click", () => exportSplitLocalVideos());

pasteBtn.addEventListener("click", async () => {
  try {
    srtInput.value = cleanSrt(await navigator.clipboard.readText());
    validateSrt();
    showMessage("SRT collé. Tu peux lancer l’export local.", "success");
  } catch (error) {
    showMessage("Collage automatique bloqué. Colle le SRT manuellement dans la zone.", "error");
  }
});

copyBtn.addEventListener("click", async () => {
  const srt = cleanSrt(srtInput.value);
  if (!srt) return showMessage("Aucun SRT à copier.", "error");
  try {
    await navigator.clipboard.writeText(srt);
  } catch (e) {
    srtInput.select();
    document.execCommand("copy");
  }
  showMessage("SRT copié.", "success");
});

downloadSrtBtn.addEventListener("click", () => {
  const srt = cleanSrt(srtInput.value);
  if (!srt) return showMessage("Aucun SRT à télécharger.", "error");
  downloadBlob(new Blob([srt], { type: "text/plain;charset=utf-8" }), "sous-titres.srt");
  showMessage("SRT téléchargé.", "success");
});

async function generateSrtWithApi() {
  const url = normalizeUrl(workerUrl.value || localStorage.getItem("srt_app_worker_url") || "");
  if (!url) return showApiStatus("Ajoute ton lien Worker Cloudflare.", "error");
  if (!selectedApiAudio) return showApiStatus("Choisis un fichier audio pour générer le SRT.", "error");
  if (selectedApiAudio.size > API_MAX_SIZE) return showApiStatus(`Audio trop lourd : ${formatMo(selectedApiAudio.size)}. Prends un audio de moins de 25 Mo.`, "error");

  try {
    localStorage.setItem("srt_app_worker_url", url);
    workerUrl.value = url;
    generateSrtBtn.disabled = true;
    generateSrtBtn.textContent = "Génération en cours...";
    showApiStatus("Appel au générateur SRT audio en cours...", "loading");

    const formData = new FormData();
    formData.append("file", selectedApiAudio, selectedApiAudio.name || "audio.mp3");
    formData.append("language", "fr");

    const response = await fetch(url, { method: "POST", body: formData });
    const text = await response.text();

    if (!response.ok) return showApiStatus(`Erreur API ${response.status}.`, "error");

    srtInput.value = cleanSrt(text);
    validateSrt();
    showApiStatus("SRT généré depuis l’audio.", "success");
  } catch (error) {
    showApiStatus("Impossible de contacter le Worker Cloudflare.", "error");
  } finally {
    generateSrtBtn.disabled = false;
    generateSrtBtn.textContent = "Générer SRT via API";
  }
}

async function exportOneLocalVideo() {
  await exportLocalPart({ partIndex: 0, totalParts: 1, startRatio: 0, endRatio: 1, resetBefore: true });
}

async function exportSplitLocalVideos() {
  if (!prepareExport()) return;

  try {
    resetDownloads();
    exportRunning = true;
    lockUi(true);
    progressBox.classList.remove("hidden");
    showMessage("Export local en 3 parties. Garde l’écran allumé.", "loading");

    await prepareVideo(hiddenVideo);
    const duration = hiddenVideo.duration;
    if (!duration || !Number.isFinite(duration)) throw new Error("Durée vidéo introuvable.");

    for (let i = 0; i < SPLIT_COUNT; i++) {
      const startRatio = i / SPLIT_COUNT;
      const endRatio = (i + 1) / SPLIT_COUNT;
      const blob = await recordPart(startRatio * duration, endRatio * duration, i, SPLIT_COUNT);
      const url = URL.createObjectURL(blob);
      partUrls.push(url);
      addDownloadLink(url, `video-sous-titree-partie-${i + 1}.webm`, `Télécharger partie ${i + 1}/3 - ${formatMo(blob.size)}`);
      setProgress(Math.round(((i + 1) / SPLIT_COUNT) * 100), `Partie ${i + 1}/3 terminée.`);
      await sleep(700);
    }

    showMessage("Les 3 parties sont prêtes. Télécharge-les puis colle-les dans CapCut.", "success");
  } catch (error) {
    console.error(error);
    showMessage(`Erreur export : ${error.message || "capture impossible."}`, "error");
  } finally {
    stopExportLoop();
    hiddenVideo.pause();
    exportRunning = false;
    lockUi(false);
  }
}

async function exportLocalPart({ partIndex, totalParts, startRatio, endRatio, resetBefore }) {
  if (!prepareExport()) return;

  try {
    if (resetBefore) resetDownloads();
    exportRunning = true;
    lockUi(true);
    progressBox.classList.remove("hidden");
    showMessage("Export local en cours. Garde l’écran allumé.", "loading");

    await prepareVideo(hiddenVideo);
    const duration = hiddenVideo.duration;
    if (!duration || !Number.isFinite(duration)) throw new Error("Durée vidéo introuvable.");

    const blob = await recordPart(startRatio * duration, endRatio * duration, partIndex, totalParts);
    localBlobReady(blob, totalParts === 1 ? "video-sous-titree.webm" : `video-sous-titree-partie-${partIndex + 1}.webm`);
    setProgress(100, "Export local terminé.");
    showMessage(`Vidéo locale prête : ${formatMo(blob.size)}.`, "success");
  } catch (error) {
    console.error(error);
    showMessage(`Erreur export : ${error.message || "capture impossible."}`, "error");
  } finally {
    stopExportLoop();
    hiddenVideo.pause();
    exportRunning = false;
    lockUi(false);
  }
}

function prepareExport() {
  if (exportRunning) return false;
  if (!selectedVideo || !videoObjectUrl) {
    showMessage("Ajoute d’abord une vidéo.", "error");
    return false;
  }
  if (!validateSrt()) {
    showMessage("Colle ou génère un SRT valide avant de lancer.", "error");
    return false;
  }
  if (!window.MediaRecorder) {
    showMessage("Ton navigateur ne supporte pas l’export local vidéo.", "error");
    return false;
  }

  subtitleCues = parseSrt(cleanSrt(srtInput.value));
  if (!subtitleCues.length) {
    showMessage("SRT illisible. Vérifie les timecodes.", "error");
    return false;
  }

  return true;
}

async function recordPart(startSecond, endSecond, partIndex, totalParts) {
  setupCanvasSize(hiddenVideo);
  await seekVideo(hiddenVideo, startSecond);
  drawOneFrame();

  const canvasStream = exportCanvas.captureStream(EXPORT_FPS);
  let mixedStream = canvasStream;

  try {
    const audioStream = hiddenVideo.captureStream ? hiddenVideo.captureStream() : hiddenVideo.mozCaptureStream?.();
    const audioTracks = audioStream ? audioStream.getAudioTracks() : [];
    if (audioTracks.length) mixedStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
  } catch (error) {
    console.warn("Audio non capturé", error);
  }

  const mimeType = getRecorderMimeType();
  const recorder = new MediaRecorder(mixedStream, { mimeType, videoBitsPerSecond: getVideoBitrate(), audioBitsPerSecond: 192000 });
  const chunks = [];

  recorder.ondataavailable = event => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };

  const done = new Promise((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType || "video/webm" }));
    recorder.onerror = event => reject(event.error || new Error("Erreur MediaRecorder"));
  });

  recorder.start(1000);
  await hiddenVideo.play();

  await new Promise(resolve => {
    const draw = () => {
      drawOneFrame();
      const partProgress = Math.min(1, Math.max(0, (hiddenVideo.currentTime - startSecond) / Math.max(1, endSecond - startSecond)));
      const totalProgress = ((partIndex + partProgress) / totalParts) * 100;
      setProgress(Math.round(totalProgress), totalParts === 1 ? "Création de la vidéo locale..." : `Création partie ${partIndex + 1}/${totalParts}...`);

      if (hiddenVideo.ended || hiddenVideo.currentTime >= endSecond) {
        resolve();
        return;
      }
      drawFrameId = requestAnimationFrame(draw);
    };
    draw();
  });

  if (recorder.state !== "inactive") recorder.stop();
  const blob = await done;
  stopTracks(mixedStream);
  return blob;
}

function drawOneFrame() {
  const ctx = exportCanvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  drawVideoContain(ctx, hiddenVideo, exportCanvas.width, exportCanvas.height);
  drawSubtitle(ctx, getSubtitleAt(hiddenVideo.currentTime));
}

function drawVideoContain(ctx, video, canvasW, canvasH) {
  const vw = video.videoWidth || canvasW;
  const vh = video.videoHeight || canvasH;
  const scale = Math.min(canvasW / vw, canvasH / vh);
  const drawW = Math.round(vw * scale);
  const drawH = Math.round(vh * scale);
  const x = Math.round((canvasW - drawW) / 2);
  const y = Math.round((canvasH - drawH) / 2);
  ctx.drawImage(video, x, y, drawW, drawH);
}

function drawSubtitle(ctx, text) {
  if (!text) return;

  const fontPx = Math.max(18, Math.round((Number(fontSize.value) || 30) * (exportCanvas.width / 720)));
  const maxWidth = Math.round(exportCanvas.width * 0.86);
  const lines = wrapText(ctx, text, maxWidth, fontPx).slice(0, 3);
  const lineHeight = Math.round(fontPx * 1.25);
  const y = exportCanvas.height - (lines.length * lineHeight) - Math.round(exportCanvas.height * 0.08);

  ctx.font = `900 ${fontPx}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineWidth = Math.max(5, Math.round(fontPx / 5));
  ctx.strokeStyle = "#000";
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = Math.round(fontPx * 0.15);
  ctx.shadowOffsetY = Math.round(fontPx * 0.06);

  lines.forEach((line, index) => {
    const textY = y + index * lineHeight;
    ctx.strokeText(line, exportCanvas.width / 2, textY);
    ctx.fillText(line, exportCanvas.width / 2, textY);
  });

  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function setupCanvasSize(video) {
  const format = formatSelect.value;
  const vw = video.videoWidth || 720;
  const vh = video.videoHeight || 1280;

  if (format === "vertical") return setCanvas(exportCanvas, 1080, 1920);
  if (format === "square") return setCanvas(exportCanvas, 1080, 1080);
  if (format === "horizontal") return setCanvas(exportCanvas, 1920, 1080);
  if (format === "mobile720") return vh >= vw ? setCanvas(exportCanvas, 720, 1280) : setCanvas(exportCanvas, 1280, 720);

  const maxSide = getMaxSideForQuality();
  const ratio = vw / vh;
  if (vw >= vh) return setCanvas(exportCanvas, maxSide, Math.round(maxSide / ratio));
  return setCanvas(exportCanvas, Math.round(maxSide * ratio), maxSide);
}

function getMaxSideForQuality() {
  if (qualitySelect.value === "high") return 1920;
  if (qualitySelect.value === "medium") return 1280;
  return 720;
}

function setCanvas(canvas, w, h) {
  canvas.width = Math.max(2, Math.round(w));
  canvas.height = Math.max(2, Math.round(h));
}

function getVideoBitrate() {
  if (qualitySelect.value === "high") return 14000000;
  if (qualitySelect.value === "medium") return 8500000;
  return 3500000;
}

function getRecorderMimeType() {
  const types = ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm"];
  return types.find(type => MediaRecorder.isTypeSupported(type)) || "video/webm";
}

function prepareVideo(video) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1 && video.videoWidth) return resolve();
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Impossible de lire la vidéo"));
  });
}

function seekVideo(video, time) {
  return new Promise(resolve => {
    video.pause();
    const done = () => {
      video.removeEventListener("seeked", done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 1000);
    video.addEventListener("seeked", done, { once: true });
    try { video.currentTime = Math.max(0, time); } catch (error) { done(); }
  });
}

function parseSrt(srtText) {
  const blocks = srtText.replace(/\r/g, "").trim().split(/\n\s*\n/);
  return blocks.map(block => {
    const lines = block.split("\n").map(line => line.trim()).filter(Boolean);
    const timeIndex = lines.findIndex(line => line.includes("-->"));
    if (timeIndex === -1) return null;
    const [startRaw, endRaw] = lines[timeIndex].split("-->");
    const text = lines.slice(timeIndex + 1).join(" ").trim();
    return { start: timeToSeconds(startRaw), end: timeToSeconds(endRaw), text };
  }).filter(cue => cue && !Number.isNaN(cue.start) && !Number.isNaN(cue.end) && cue.text);
}

function timeToSeconds(time) {
  const parts = String(time).trim().replace(",", ".").split(":");
  if (parts.length !== 3) return NaN;
  return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
}

function getSubtitleAt(time) {
  const cue = subtitleCues.find(item => time >= item.start && time <= item.end);
  return cue ? cue.text : "";
}

function wrapText(ctx, text, maxWidth, fontPx) {
  ctx.font = `900 ${fontPx}px Arial, sans-serif`;
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";

  words.forEach(word => {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  });

  if (line) lines.push(line);
  return lines;
}

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

function normalizeUrl(url) {
  const clean = String(url || "").trim().replace(/\/+$/, "");
  if (!clean.startsWith("https://")) return "";
  return clean;
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

function showApiStatus(text, type) {
  apiStatus.textContent = text;
  apiStatus.className = "status";
  if (type) apiStatus.classList.add(type);
}

function lockUi(locked) {
  startBtn.disabled = locked;
  splitExportBtn.disabled = locked;
  videoFile.disabled = locked;
  srtInput.disabled = locked;
  pasteBtn.disabled = locked;
  copyBtn.disabled = locked;
  downloadSrtBtn.disabled = locked;
  fontSize.disabled = locked;
  qualitySelect.disabled = locked;
  formatSelect.disabled = locked;
  startBtn.textContent = locked ? "Traitement..." : "Exporter local en 1 vidéo";
  splitExportBtn.textContent = locked ? "Traitement..." : "Exporter local en 3 parties";
}

function resetDownloads() {
  stopExportLoop();
  if (localUrl) URL.revokeObjectURL(localUrl);
  partUrls.forEach(url => URL.revokeObjectURL(url));
  localUrl = null;
  partUrls = [];
  downloadsBox.innerHTML = "";
  downloadVideoBtn.href = "#";
  downloadVideoBtn.classList.add("hidden");
  setProgress(0, "Préparation...");
}

function localBlobReady(blob, filename) {
  localUrl = URL.createObjectURL(blob);
  downloadVideoBtn.href = localUrl;
  downloadVideoBtn.download = filename;
  downloadVideoBtn.textContent = `Télécharger ${filename} - ${formatMo(blob.size)}`;
  downloadVideoBtn.classList.remove("hidden");
  downloadBlob(blob, filename);
}

function addDownloadLink(url, filename, label) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.className = "downloadLink";
  link.textContent = label;
  downloadsBox.appendChild(link);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function stopTracks(stream) {
  try { stream.getTracks().forEach(track => track.stop()); } catch (e) {}
}

function stopExportLoop() {
  if (drawFrameId) cancelAnimationFrame(drawFrameId);
  drawFrameId = null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatMo(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

validateSrt();
