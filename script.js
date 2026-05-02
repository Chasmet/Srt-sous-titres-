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
const convertMp4Btn = document.getElementById("convertMp4Btn");
const downloadMp4Btn = document.getElementById("downloadMp4Btn");
const message = document.getElementById("message");
const hiddenVideo = document.getElementById("hiddenVideo");
const exportCanvas = document.getElementById("exportCanvas");

const API_MAX_SIZE = 25 * 1024 * 1024;
const EXPORT_FPS = 30;

let selectedVideo = null;
let selectedApiAudio = null;
let videoObjectUrl = null;
let finalUrl = null;
let finalBlob = null;
let mp4Url = null;
let subtitleCues = [];
let exportRunning = false;
let ffmpeg = null;
let ffmpegLoaded = false;

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
  hiddenVideo.load();
  showMessage("Vidéo prête. Elle reste en local pour l’export sous-titré.", "success");
});

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
convertMp4Btn.addEventListener("click", convertWebmToMp4);

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
    showMessage("Export local en cours. La vidéo est lue puis enregistrée avec les sous-titres.", "loading");
    setProgress(0, "Préparation de la lecture...");

    await prepareVideo(hiddenVideo);
    setupCanvasSize(hiddenVideo);

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

    hiddenVideo.currentTime = 0;
    hiddenVideo.muted = false;
    await hiddenVideo.play();

    recorder.start(1000);
    drawLoop();

    await new Promise(resolve => hiddenVideo.onended = resolve);
    recorder.stop();
    await done;

    finalBlob = new Blob(chunks, { type: mimeType || "video/webm" });
    finalUrl = URL.createObjectURL(finalBlob);
    downloadVideoBtn.href = finalUrl;
    downloadVideoBtn.download = mimeType.includes("mp4") ? "video-sous-titree.mp4" : "video-sous-titree.webm";
    downloadVideoBtn.classList.remove("hidden");

    if (!mimeType.includes("mp4")) {
      convertMp4Btn.classList.remove("hidden");
    }

    setProgress(100, "Terminé.");
    showMessage(`Export prêt : ${formatMo(finalBlob.size)}. Si CapCut ne lit pas ce fichier, convertis-le en MP4.`, "success");
  } catch (error) {
    console.error(error);
    showMessage("Erreur pendant l’export local. Essaie Mobile léger ou une vidéo moins longue.", "error");
    setProgress(0, "Échec.");
  } finally {
    hiddenVideo.pause();
    exportRunning = false;
    lockUi(false);
  }
}

async function convertWebmToMp4() {
  if (!finalBlob) return showMessage("Fais d’abord un export vidéo.", "error");

  try {
    lockUi(true);
    convertMp4Btn.disabled = true;
    convertMp4Btn.textContent = "Conversion MP4 en cours...";
    progressBox.classList.remove("hidden");
    setProgress(0, "Chargement du convertisseur MP4...");
    showMessage("Conversion locale en MP4 pour CapCut. Ça peut prendre du temps sur téléphone.", "loading");

    const { FFmpeg } = await import("https://esm.sh/@ffmpeg/ffmpeg@0.12.15");
    const { fetchFile, toBlobURL } = await import("https://esm.sh/@ffmpeg/util@0.12.2");

    if (!ffmpegLoaded) {
      ffmpeg = new FFmpeg();
      ffmpeg.on("progress", ({ progress }) => {
        const value = Math.min(99, Math.max(1, Math.round(progress * 100)));
        setProgress(value, "Conversion MP4 en cours...");
      });

      const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm")
      });
      ffmpegLoaded = true;
    }

    await ffmpeg.writeFile("input.webm", await fetchFile(finalBlob));
    await ffmpeg.exec([
      "-i", "input.webm",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "160k",
      "-movflags", "+faststart",
      "output.mp4"
    ]);

    const data = await ffmpeg.readFile("output.mp4");
    const mp4Blob = new Blob([data.buffer], { type: "video/mp4" });

    if (mp4Url) URL.revokeObjectURL(mp4Url);
    mp4Url = URL.createObjectURL(mp4Blob);
    downloadMp4Btn.href = mp4Url;
    downloadMp4Btn.classList.remove("hidden");

    try {
      await ffmpeg.deleteFile("input.webm");
      await ffmpeg.deleteFile("output.mp4");
    } catch (error) {
      console.warn("Nettoyage FFmpeg impossible", error);
    }

    setProgress(100, "MP4 prêt.");
    showMessage(`MP4 prêt pour CapCut : ${formatMo(mp4Blob.size)}.`, "success");
  } catch (error) {
    console.error(error);
    showMessage("Conversion MP4 impossible sur ce téléphone. Garde le WebM ou convertis sur ordinateur.", "error");
  } finally {
    lockUi(false);
    convertMp4Btn.disabled = false;
    convertMp4Btn.textContent = "Convertir en MP4 pour CapCut";
  }
}

function drawLoop() {
  if (!exportRunning || hiddenVideo.ended || hiddenVideo.paused) return;
  const ctx = exportCanvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  drawVideoContain(ctx, hiddenVideo, exportCanvas.width, exportCanvas.height);
  drawSubtitle(ctx, getSubtitleAt(hiddenVideo.currentTime));
  const percent = hiddenVideo.duration ? Math.min(99, Math.round((hiddenVideo.currentTime / hiddenVideo.duration) * 100)) : 0;
  setProgress(percent, "Enregistrement local en cours...");
  requestAnimationFrame(drawLoop);
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

  if (format === "vertical") return setCanvas(1080, 1920);
  if (format === "square") return setCanvas(1080, 1080);
  if (format === "horizontal") return setCanvas(1920, 1080);
  if (format === "mobile720") {
    if (vh >= vw) return setCanvas(720, 1280);
    return setCanvas(1280, 720);
  }

  const maxSide = getMaxSideForQuality();
  const ratio = vw / vh;
  if (vw >= vh) return setCanvas(maxSide, Math.round(maxSide / ratio));
  return setCanvas(Math.round(maxSide * ratio), maxSide);
}

function getMaxSideForQuality() {
  if (qualitySelect.value === "high") return 1920;
  if (qualitySelect.value === "medium") return 1280;
  return 720;
}

function setCanvas(w, h) {
  exportCanvas.width = Math.max(2, Math.round(w));
  exportCanvas.height = Math.max(2, Math.round(h));
}

function getVideoBitrate() {
  if (qualitySelect.value === "high") return 14000000;
  if (qualitySelect.value === "medium") return 8500000;
  return 3500000;
}

function getRecorderMimeType() {
  const types = ["video/mp4;codecs=h264,aac", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return types.find(type => MediaRecorder.isTypeSupported(type)) || "video/webm";
}

function prepareVideo(video) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1) return resolve();
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Impossible de lire la vidéo"));
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
  convertMp4Btn.disabled = locked;
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

function resetDownload() {
  if (finalUrl) URL.revokeObjectURL(finalUrl);
  if (mp4Url) URL.revokeObjectURL(mp4Url);
  finalUrl = null;
  finalBlob = null;
  mp4Url = null;
  downloadVideoBtn.href = "#";
  downloadMp4Btn.href = "#";
  downloadVideoBtn.classList.add("hidden");
  downloadMp4Btn.classList.add("hidden");
  convertMp4Btn.classList.add("hidden");
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

function formatMo(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

validateSrt();
