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
const message = document.getElementById("message");
const hiddenVideo = document.getElementById("hiddenVideo");
const exportCanvas = document.getElementById("exportCanvas");

const normalizeFile = document.getElementById("normalizeFile");
const normalizeName = document.getElementById("normalizeName");
const normalizeVideo = document.getElementById("normalizeVideo");
const normalizeCanvas = document.getElementById("normalizeCanvas");
const normalizeBtn = document.getElementById("normalizeBtn");
const normalizeProgressBox = document.getElementById("normalizeProgressBox");
const normalizeProgressText = document.getElementById("normalizeProgressText");
const normalizeProgressPercent = document.getElementById("normalizeProgressPercent");
const normalizeProgressBar = document.getElementById("normalizeProgressBar");
const downloadNormalizedBtn = document.getElementById("downloadNormalizedBtn");
const normalizeStatus = document.getElementById("normalizeStatus");

const API_MAX_SIZE = 25 * 1024 * 1024;
const EXPORT_FPS = 30;

let selectedVideo = null;
let selectedApiAudio = null;
let videoObjectUrl = null;
let finalUrl = null;
let finalBlob = null;
let subtitleCues = [];
let exportRunning = false;
let drawFrameId = null;

let selectedNormalizeFile = null;
let normalizeObjectUrl = null;
let normalizedUrl = null;
let normalizeRunning = false;
let normalizeFrameId = null;

hiddenVideo.muted = true;
hiddenVideo.playsInline = true;
hiddenVideo.preload = "metadata";
normalizeVideo.muted = true;
normalizeVideo.playsInline = true;
normalizeVideo.preload = "metadata";

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
  showMessage("Vidéo prête. Elle reste visible pendant l’export.", "success");
});

normalizeFile.addEventListener("change", () => {
  selectedNormalizeFile = normalizeFile.files && normalizeFile.files[0] ? normalizeFile.files[0] : null;
  if (!selectedNormalizeFile) {
    normalizeName.textContent = "Aucune vidéo à normaliser";
    showNormalizeStatus("Aucune vidéo sélectionnée.", "");
    return;
  }

  normalizeName.textContent = `${selectedNormalizeFile.name} - ${formatMo(selectedNormalizeFile.size)}`;
  if (normalizeObjectUrl) URL.revokeObjectURL(normalizeObjectUrl);
  normalizeObjectUrl = URL.createObjectURL(selectedNormalizeFile);
  normalizeVideo.src = normalizeObjectUrl;
  normalizeVideo.muted = true;
  normalizeVideo.classList.remove("hidden");
  normalizeVideo.load();
  showNormalizeStatus("Vidéo chargée pour normalisation.", "success");
});

normalizeBtn.addEventListener("click", normalizeExistingVideo);

srtInput.addEventListener("input", validateSrt);
fontSize.addEventListener("input", () => fontSizeValue.textContent = fontSize.value);

pasteBtn.addEventListener("click", async () => {
  try {
    srtInput.value = cleanSrt(await navigator.clipboard.readText());
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

startBtn.addEventListener("click", exportByRecordingPreview);

async function generateSrtWithApi() {
  const url = normalizeUrl(workerUrl.value || localStorage.getItem("srt_app_worker_url") || "");

  if (!url) return showApiStatus("Ajoute ton lien Worker Cloudflare.", "error");
  if (!selectedApiAudio) return showApiStatus("Choisis un fichier audio pour générer le SRT.", "error");
  if (selectedApiAudio.size > API_MAX_SIZE) return showApiStatus(`Audio trop lourd : ${formatMo(selectedApiAudio.size)}. Prends un audio de moins de 25 Mo pour retrouver la génération rapide.`, "error");

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

    if (!response.ok) {
      console.error(text);
      return showApiStatus(`Erreur API ${response.status}. Le Worker répond mais refuse le fichier ou la requête.`, "error");
    }

    const srt = cleanSrt(text);
    srtInput.value = srt;
    validateSrt();
    showApiStatus("SRT généré depuis l’audio et placé dans la zone SRT.", "success");
    showMessage("Tu peux maintenant exporter la vidéo avec sous-titres.", "success");
  } catch (error) {
    console.error(error);
    showApiStatus("Impossible de contacter le Worker Cloudflare. Vérifie le lien ou la connexion.", "error");
  } finally {
    generateSrtBtn.disabled = false;
    generateSrtBtn.textContent = "Générer SRT via API";
  }
}

async function exportByRecordingPreview() {
  resetDownload();
  if (exportRunning) return;
  if (!selectedVideo || !videoObjectUrl) return showMessage("Ajoute d’abord une vidéo.", "error");
  if (!validateSrt()) return showMessage("Colle ou génère un SRT valide avant de lancer.", "error");
  if (!window.MediaRecorder) return showMessage("Ton navigateur ne supporte pas l’export local vidéo.", "error");

  subtitleCues = parseSrt(cleanSrt(srtInput.value));
  if (!subtitleCues.length) return showMessage("SRT illisible. Vérifie les timecodes.", "error");

  try {
    exportRunning = true;
    lockUi(true);
    progressBox.classList.remove("hidden");
    setProgress(1, "Retour de la vidéo au début...");
    showMessage("Export en préparation. La vidéo va repartir depuis 00:00.", "loading");

    await prepareVideo(hiddenVideo);
    setupCanvasSize(hiddenVideo);
    await forceVideoToStart(hiddenVideo);

    if (hiddenVideo.currentTime > 0.5) {
      throw new Error("Impossible de remettre la vidéo au début. Remets la prévisualisation à 00:00 puis relance.");
    }

    drawOneFrame();

    const canvasStream = exportCanvas.captureStream(EXPORT_FPS);
    let mixedStream = canvasStream;

    try {
      const audioStream = hiddenVideo.captureStream ? hiddenVideo.captureStream() : hiddenVideo.mozCaptureStream?.();
      const audioTracks = audioStream ? audioStream.getAudioTracks() : [];
      if (audioTracks.length) mixedStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
    } catch (error) {
      console.warn("Audio non capturé, export vidéo seul possible", error);
    }

    const mimeType = getRecorderMimeType();
    const bitrate = getVideoBitrate();
    const recorder = new MediaRecorder(mixedStream, { mimeType, videoBitsPerSecond: bitrate });
    const chunks = [];

    recorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };

    const done = new Promise((resolve, reject) => {
      recorder.onstop = resolve;
      recorder.onerror = event => reject(event.error || new Error("Erreur MediaRecorder"));
    });

    hiddenVideo.onended = null;
    recorder.start(1000);
    setProgress(1, "Enregistrement local en cours...");

    await hiddenVideo.play();
    drawLoop();

    await new Promise(resolve => {
      hiddenVideo.onended = resolve;
    });

    if (recorder.state !== "inactive") recorder.stop();
    await done;

    finalBlob = new Blob(chunks, { type: mimeType || "video/webm" });
    finalUrl = URL.createObjectURL(finalBlob);
    downloadVideoBtn.href = finalUrl;
    downloadVideoBtn.download = mimeType.includes("mp4") ? "video-sous-titree.mp4" : "video-sous-titree.webm";
    downloadVideoBtn.classList.remove("hidden");

    setProgress(100, "Terminé.");
    showMessage(mimeType.includes("mp4") ? `MP4 prêt : ${formatMo(finalBlob.size)}.` : `Export WebM prêt : ${formatMo(finalBlob.size)}. Ton téléphone ne permet pas l’enregistrement MP4 direct.`, "success");
  } catch (error) {
    console.error(error);
    showMessage(`Export bloqué : ${error.message || "Android n’a pas lancé la lecture."}`, "error");
    setProgress(0, "Échec.");
  } finally {
    if (drawFrameId) cancelAnimationFrame(drawFrameId);
    hiddenVideo.pause();
    exportRunning = false;
    lockUi(false);
  }
}

async function normalizeExistingVideo() {
  resetNormalizedDownload();
  if (normalizeRunning) return;
  if (!selectedNormalizeFile || !normalizeObjectUrl) return showNormalizeStatus("Choisis d’abord une vidéo à normaliser.", "error");
  if (!window.MediaRecorder) return showNormalizeStatus("Ton navigateur ne supporte pas la normalisation locale.", "error");

  try {
    normalizeRunning = true;
    lockNormalizeUi(true);
    normalizeProgressBox.classList.remove("hidden");
    setNormalizeProgress(1, "Retour de la vidéo au début...");
    showNormalizeStatus("Normalisation en cours. La vidéo va être relue et réenregistrée.", "loading");

    await prepareVideo(normalizeVideo);
    setupNormalizeCanvasSize(normalizeVideo);
    await forceVideoToStart(normalizeVideo);

    if (normalizeVideo.currentTime > 0.5) {
      throw new Error("Impossible de remettre la vidéo au début. Remets la prévisualisation à 00:00 puis relance.");
    }

    drawNormalizeFrame();

    const canvasStream = normalizeCanvas.captureStream(EXPORT_FPS);
    let mixedStream = canvasStream;

    try {
      const audioStream = normalizeVideo.captureStream ? normalizeVideo.captureStream() : normalizeVideo.mozCaptureStream?.();
      const audioTracks = audioStream ? audioStream.getAudioTracks() : [];
      if (audioTracks.length) mixedStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
    } catch (error) {
      console.warn("Audio non capturé pendant normalisation", error);
    }

    const mimeType = getRecorderMimeType();
    const bitrate = getVideoBitrate();
    const recorder = new MediaRecorder(mixedStream, { mimeType, videoBitsPerSecond: bitrate });
    const chunks = [];

    recorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };

    const done = new Promise((resolve, reject) => {
      recorder.onstop = resolve;
      recorder.onerror = event => reject(event.error || new Error("Erreur MediaRecorder"));
    });

    normalizeVideo.onended = null;
    recorder.start(1000);
    setNormalizeProgress(1, "Normalisation en cours...");

    await normalizeVideo.play();
    normalizeLoop();

    await new Promise(resolve => {
      normalizeVideo.onended = resolve;
    });

    if (recorder.state !== "inactive") recorder.stop();
    await done;

    const normalizedBlob = new Blob(chunks, { type: mimeType || "video/webm" });
    normalizedUrl = URL.createObjectURL(normalizedBlob);
    downloadNormalizedBtn.href = normalizedUrl;
    downloadNormalizedBtn.download = mimeType.includes("mp4") ? "video-normalisee.mp4" : "video-normalisee.webm";
    downloadNormalizedBtn.textContent = mimeType.includes("mp4") ? "Télécharger la vidéo normalisée MP4" : "Télécharger la vidéo normalisée WebM";
    downloadNormalizedBtn.classList.remove("hidden");

    setNormalizeProgress(100, "Normalisation terminée.");
    showNormalizeStatus(mimeType.includes("mp4") ? `MP4 normalisé prêt : ${formatMo(normalizedBlob.size)}.` : `WebM normalisé prêt : ${formatMo(normalizedBlob.size)}.`, "success");
  } catch (error) {
    console.error(error);
    showNormalizeStatus(`Normalisation bloquée : ${error.message || "lecture impossible."}`, "error");
    setNormalizeProgress(0, "Échec.");
  } finally {
    if (normalizeFrameId) cancelAnimationFrame(normalizeFrameId);
    normalizeVideo.pause();
    normalizeRunning = false;
    lockNormalizeUi(false);
  }
}

function drawLoop() {
  if (!exportRunning || hiddenVideo.ended) return;
  drawOneFrame();
  const percent = hiddenVideo.duration ? Math.min(99, Math.max(1, Math.round((hiddenVideo.currentTime / hiddenVideo.duration) * 100))) : 1;
  setProgress(percent, "Enregistrement local en cours...");
  drawFrameId = requestAnimationFrame(drawLoop);
}

function normalizeLoop() {
  if (!normalizeRunning || normalizeVideo.ended) return;
  drawNormalizeFrame();
  const percent = normalizeVideo.duration ? Math.min(99, Math.max(1, Math.round((normalizeVideo.currentTime / normalizeVideo.duration) * 100))) : 1;
  setNormalizeProgress(percent, "Normalisation en cours...");
  normalizeFrameId = requestAnimationFrame(normalizeLoop);
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

function drawNormalizeFrame() {
  const ctx = normalizeCanvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, normalizeCanvas.width, normalizeCanvas.height);
  drawVideoContain(ctx, normalizeVideo, normalizeCanvas.width, normalizeCanvas.height);
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
  const padding = Math.round(fontPx * 0.55);
  const maxWidth = Math.round(exportCanvas.width * 0.86);
  const lines = wrapText(ctx, text, maxWidth, fontPx);
  const lineHeight = Math.round(fontPx * 1.25);
  const boxHeight = lines.length * lineHeight + padding * 2;
  const boxWidth = Math.min(maxWidth + padding * 2, exportCanvas.width * 0.92);
  const x = (exportCanvas.width - boxWidth) / 2;
  const y = exportCanvas.height - boxHeight - Math.round(exportCanvas.height * 0.07);

  ctx.font = `900 ${fontPx}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(0,0,0,0.58)";
  roundRect(ctx, x, y, boxWidth, boxHeight, Math.round(fontPx * 0.45));
  ctx.fill();
  ctx.lineWidth = Math.max(4, Math.round(fontPx / 6));
  ctx.strokeStyle = "#000";
  ctx.fillStyle = "#fff";
  lines.forEach((line, index) => {
    const textY = y + padding + lineHeight * index + lineHeight / 2;
    ctx.strokeText(line, exportCanvas.width / 2, textY);
    ctx.fillText(line, exportCanvas.width / 2, textY);
  });
}

function setupCanvasSize(video) {
  const format = formatSelect.value;
  const vw = video.videoWidth || 720;
  const vh = video.videoHeight || 1280;

  if (format === "vertical") return setCanvas(exportCanvas, 1080, 1920);
  if (format === "square") return setCanvas(exportCanvas, 1080, 1080);
  if (format === "horizontal") return setCanvas(exportCanvas, 1920, 1080);
  if (format === "mobile720") {
    if (vh >= vw) return setCanvas(exportCanvas, 720, 1280);
    return setCanvas(exportCanvas, 1280, 720);
  }

  const maxSide = getMaxSideForQuality();
  const ratio = vw / vh;
  if (vw >= vh) return setCanvas(exportCanvas, maxSide, Math.round(maxSide / ratio));
  return setCanvas(exportCanvas, Math.round(maxSide * ratio), maxSide);
}

function setupNormalizeCanvasSize(video) {
  const vw = video.videoWidth || 720;
  const vh = video.videoHeight || 1280;
  const maxSide = getMaxSideForQuality();
  const ratio = vw / vh;
  if (vw >= vh) return setCanvas(normalizeCanvas, maxSide, Math.round(maxSide / ratio));
  return setCanvas(normalizeCanvas, Math.round(maxSide * ratio), maxSide);
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
  const types = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm"];
  return types.find(type => MediaRecorder.isTypeSupported(type)) || "video/webm";
}

function prepareVideo(video) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1 && video.videoWidth) return resolve();
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Impossible de lire la vidéo"));
  });
}

async function forceVideoToStart(video) {
  video.pause();
  video.muted = true;

  await new Promise(resolve => setTimeout(resolve, 120));

  try {
    video.currentTime = 0;
  } catch (error) {
    console.warn("currentTime reset impossible", error);
  }

  await new Promise(resolve => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      video.removeEventListener("seeked", finish);
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(finish, 900);
    video.addEventListener("seeked", finish, { once: true });
  });

  if (video.currentTime > 0.3) {
    try {
      video.currentTime = 0;
    } catch (error) {
      console.warn("second reset impossible", error);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
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
  return lines.slice(0, 3);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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
  if (!clean.startsWith("https://")) return "";
  return clean;
}

function setProgress(value, text) {
  progressBar.value = value;
  progressPercent.textContent = `${value}%`;
  progressText.textContent = text;
}

function setNormalizeProgress(value, text) {
  normalizeProgressBar.value = value;
  normalizeProgressPercent.textContent = `${value}%`;
  normalizeProgressText.textContent = text;
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

function showNormalizeStatus(text, type) {
  normalizeStatus.textContent = text;
  normalizeStatus.className = "status";
  if (type) normalizeStatus.classList.add(type);
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
  startBtn.textContent = locked ? "Traitement en cours..." : "Exporter avec sous-titres";
}

function lockNormalizeUi(locked) {
  normalizeBtn.disabled = locked;
  normalizeFile.disabled = locked;
  normalizeBtn.textContent = locked ? "Normalisation en cours..." : "Normaliser le fichier";
}

function resetDownload() {
  if (drawFrameId) cancelAnimationFrame(drawFrameId);
  if (finalUrl) URL.revokeObjectURL(finalUrl);
  finalUrl = null;
  finalBlob = null;
  downloadVideoBtn.href = "#";
  downloadVideoBtn.classList.add("hidden");
  setProgress(0, "Préparation...");
}

function resetNormalizedDownload() {
  if (normalizeFrameId) cancelAnimationFrame(normalizeFrameId);
  if (normalizedUrl) URL.revokeObjectURL(normalizedUrl);
  normalizedUrl = null;
  downloadNormalizedBtn.href = "#";
  downloadNormalizedBtn.classList.add("hidden");
  setNormalizeProgress(0, "Préparation...");
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

function formatMo(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

validateSrt();
