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

let selectedVideo = null;
let selectedApiAudio = null;
let videoObjectUrl = null;
let localUrl = null;
let subtitleCues = [];
let exportRunning = false;
let drawFrameId = null;
let lastProgressUpdate = 0;

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
  if (file.size > API_MAX_SIZE) showApiStatus("Audio trop lourd pour l’API. Utilise moins de 25 Mo.", "error");
  else showApiStatus("Audio prêt pour génération SRT.", "success");
});

generateSrtBtn.addEventListener("click", generateSrtWithApi);

videoFile.addEventListener("change", () => {
  selectedVideo = videoFile.files && videoFile.files[0] ? videoFile.files[0] : null;
  if (!selectedVideo) {
    videoName.textContent = "Aucune vidéo sélectionnée";
    return showMessage("Aucune vidéo sélectionnée.", "");
  }

  videoName.textContent = `${selectedVideo.name} - ${formatMo(selectedVideo.size)}`;
  if (videoObjectUrl) URL.revokeObjectURL(videoObjectUrl);
  videoObjectUrl = URL.createObjectURL(selectedVideo);
  hiddenVideo.src = videoObjectUrl;
  hiddenVideo.muted = true;
  hiddenVideo.load();
  showMessage("Vidéo prête. Colle ton SRT puis crée la vidéo ultra fluide.", "success");
});

srtInput.addEventListener("input", validateSrt);
fontSize.addEventListener("input", () => fontSizeValue.textContent = fontSize.value);
startBtn.addEventListener("click", exportOneLocalVideo);

pasteBtn.addEventListener("click", async () => {
  try {
    srtInput.value = cleanSrt(await navigator.clipboard.readText());
    validateSrt();
    showMessage("SRT collé. Tu peux lancer l’export.", "success");
  } catch (error) {
    showMessage("Collage automatique bloqué. Colle manuellement dans la zone.", "error");
  }
});

copyBtn.addEventListener("click", async () => {
  const srt = cleanSrt(srtInput.value);
  if (!srt) return showMessage("Aucun SRT à copier.", "error");
  try { await navigator.clipboard.writeText(srt); }
  catch (e) { srtInput.select(); document.execCommand("copy"); }
  showMessage("SRT copié.", "success");
});

downloadSrtBtn.addEventListener("click", () => {
  const srt = cleanSrt(srtInput.value);
  if (!srt) return showMessage("Aucun SRT à télécharger.", "error");
  const blob = new Blob([srt], { type: "text/plain;charset=utf-8" });
  triggerDownload(blob, "sous-titres.srt");
  showMessage("SRT téléchargé.", "success");
});

async function generateSrtWithApi() {
  const url = normalizeUrl(workerUrl.value || localStorage.getItem("srt_app_worker_url") || "");
  if (!url) return showApiStatus("Ajoute ton lien Worker Cloudflare.", "error");
  if (!selectedApiAudio) return showApiStatus("Choisis un fichier audio.", "error");
  if (selectedApiAudio.size > API_MAX_SIZE) return showApiStatus(`Audio trop lourd : ${formatMo(selectedApiAudio.size)}.`, "error");

  try {
    localStorage.setItem("srt_app_worker_url", url);
    workerUrl.value = url;
    generateSrtBtn.disabled = true;
    generateSrtBtn.textContent = "Génération...";
    showApiStatus("Génération SRT audio en cours...", "loading");

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
    showApiStatus("Impossible de contacter le Worker.", "error");
  } finally {
    generateSrtBtn.disabled = false;
    generateSrtBtn.textContent = "Générer SRT via API";
  }
}

async function exportOneLocalVideo() {
  if (!prepareExport()) return;

  try {
    resetDownload();
    exportRunning = true;
    lockUi(true);
    progressBox.classList.remove("hidden");
    showMessage("Création d’un seul fichier ultra fluide. Garde l’écran allumé.", "loading");

    await prepareVideo(hiddenVideo);
    const duration = hiddenVideo.duration;
    if (!duration || !Number.isFinite(duration)) throw new Error("Durée vidéo introuvable.");

    const blob = await recordFullVideo(duration);
    const fixedBlob = await fixDurationIfNeeded(blob, duration * 1000);
    localBlobReady(fixedBlob, "video-sous-titree-ultra-fluide.webm");
    setProgress(100, "Vidéo terminée.");
    showMessage(`Vidéo prête. Appuie sur “Télécharger la vidéo” : ${formatMo(fixedBlob.size)}.`, "success");
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
  if (!selectedVideo || !videoObjectUrl) return showMessage("Ajoute d’abord une vidéo.", "error"), false;
  if (!validateSrt()) return showMessage("Colle ou génère un SRT valide avant l’export.", "error"), false;
  if (!window.MediaRecorder) return showMessage("Ton navigateur ne supporte pas l’export local vidéo.", "error"), false;

  subtitleCues = parseSrt(cleanSrt(srtInput.value));
  if (!subtitleCues.length) return showMessage("SRT illisible. Vérifie les timecodes.", "error"), false;
  return true;
}

async function recordFullVideo(duration) {
  setupCanvasSize(hiddenVideo);
  await seekVideo(hiddenVideo, 0);
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
  const recorder = new MediaRecorder(mixedStream, {
    mimeType,
    videoBitsPerSecond: getVideoBitrate(),
    audioBitsPerSecond: 128000
  });
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
      const now = performance.now();
      if (now - lastProgressUpdate > 500) {
        const progress = Math.min(100, Math.round((hiddenVideo.currentTime / duration) * 100));
        setProgress(progress, "Création de la vidéo ultra fluide...");
        lastProgressUpdate = now;
      }
      if (hiddenVideo.ended || hiddenVideo.currentTime >= duration) return resolve();
      drawFrameId = requestAnimationFrame(draw);
    };
    draw();
  });

  if (recorder.state !== "inactive") recorder.stop();
  const blob = await done;
  stopTracks(mixedStream);
  return blob;
}

async function fixDurationIfNeeded(blob, durationMs) {
  if (typeof fixWebmDuration === "function" && blob.type.includes("webm")) {
    try {
      setProgress(99, "Correction durée WebM...");
      return await fixWebmDuration(blob, durationMs, { logger: false });
    } catch (error) {
      console.warn("Correction durée impossible", error);
    }
  }
  return blob;
}

function drawOneFrame() {
  const ctx = exportCanvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "medium";
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
  const lines = wrapText(ctx, text, maxWidth, fontPx).slice(0, 2);
  const lineHeight = Math.round(fontPx * 1.22);
  const y = exportCanvas.height - (lines.length * lineHeight) - Math.round(exportCanvas.height * 0.08);

  ctx.font = `900 ${fontPx}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineWidth = Math.max(4, Math.round(fontPx / 6));
  ctx.strokeStyle = "#000";
  ctx.fillStyle = "#fff";

  lines.forEach((line, index) => {
    const textY = y + index * lineHeight;
    ctx.strokeText(line, exportCanvas.width / 2, textY);
    ctx.fillText(line, exportCanvas.width / 2, textY);
  });
}

function setupCanvasSize(video) {
  const format = formatSelect.value;
  const vw = video.videoWidth || 720;
  const vh = video.videoHeight || 1280;

  if (format === "vertical") return setCanvas(exportCanvas, 720, 1280);
  if (format === "square") return setCanvas(exportCanvas, 720, 720);
  if (format === "horizontal") return setCanvas(exportCanvas, 1280, 720);
  if (format === "mobile720") return vh >= vw ? setCanvas(exportCanvas, 720, 1280) : setCanvas(exportCanvas, 1280, 720);

  const maxSide = getMaxSideForQuality();
  const ratio = vw / vh;
  if (vw >= vh) return setCanvas(exportCanvas, maxSide, Math.round(maxSide / ratio));
  return setCanvas(exportCanvas, Math.round(maxSide * ratio), maxSide);
}

function getMaxSideForQuality() {
  if (qualitySelect.value === "high") return 1280;
  if (qualitySelect.value === "smooth134") return 960;
  if (qualitySelect.value === "medium") return 1080;
  return 720;
}

function getVideoBitrate() {
  if (qualitySelect.value === "high") return 7500000;
  if (qualitySelect.value === "smooth134") return 4200000;
  if (qualitySelect.value === "medium") return 5000000;
  return 2200000;
}

function getRecorderMimeType() {
  const types = ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm"];
  return types.find(type => MediaRecorder.isTypeSupported(type)) || "video/webm";
}

function setCanvas(canvas, w, h) {
  canvas.width = Math.max(2, Math.round(w));
  canvas.height = Math.max(2, Math.round(h));
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
    } else line = test;
  });
  if (line) lines.push(line);
  return lines;
}

function cleanSrt(text) {
  return String(text || "").replace(/\r/g, "").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
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
  return clean.startsWith("https://") ? clean : "";
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
  videoFile.disabled = locked;
  srtInput.disabled = locked;
  pasteBtn.disabled = locked;
  copyBtn.disabled = locked;
  downloadSrtBtn.disabled = locked;
  fontSize.disabled = locked;
  qualitySelect.disabled = locked;
  formatSelect.disabled = locked;
  startBtn.textContent = locked ? "Traitement..." : "Créer 1 vidéo ultra fluide";
}

function resetDownload() {
  stopExportLoop();
  if (localUrl) URL.revokeObjectURL(localUrl);
  localUrl = null;
  downloadsBox.innerHTML = "";
  downloadVideoBtn.href = "#";
  downloadVideoBtn.classList.add("hidden");
  setProgress(0, "Préparation...");
}

function localBlobReady(blob, filename) {
  localUrl = URL.createObjectURL(blob);
  downloadVideoBtn.href = localUrl;
  downloadVideoBtn.download = filename;
  downloadVideoBtn.textContent = `Télécharger la vidéo - ${formatMo(blob.size)}`;
  downloadVideoBtn.classList.remove("hidden");
}

function triggerDownload(blob, filename) {
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

function formatMo(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

validateSrt();
