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
const audioInfo = document.getElementById("audioInfo");
const renderUrlInput = document.getElementById("renderUrl");
const renderStatus = document.getElementById("renderStatus");
const renderDownloadLink = document.getElementById("renderDownloadLink");

const saveWorkerBtn = document.getElementById("saveWorkerBtn");
const loadVideoBtn = document.getElementById("loadVideoBtn");
const generateBtn = document.getElementById("generateBtn");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");
const burnBtn = document.getElementById("burnBtn");
const compressAudioBtn = document.getElementById("compressAudioBtn");
const saveRenderBtn = document.getElementById("saveRenderBtn");
const renderExportBtn = document.getElementById("renderExportBtn");

let currentSrtText = "";
let currentTrackUrl = null;
let subtitleCues = [];
let videoObjectUrl = null;
let finalVideoUrl = null;
let renderVideoUrl = null;
let overlayTimer = null;
let compressedAudioFile = null;

window.addEventListener("load", () => {
  const savedWorkerUrl = localStorage.getItem("srt_app_worker_url");
  if (savedWorkerUrl) workerUrlInput.value = savedWorkerUrl;

  const savedRenderUrl = localStorage.getItem("srt_app_render_url");
  if (savedRenderUrl && renderUrlInput) renderUrlInput.value = savedRenderUrl;
});

saveWorkerBtn.addEventListener("click", () => {
  const url = normalizeUrl(workerUrlInput.value.trim());
  if (!url) return showStatus("Ajoute l’URL de ton Worker Cloudflare.", "error");
  localStorage.setItem("srt_app_worker_url", url);
  workerUrlInput.value = url;
  showStatus("Lien Worker sauvegardé sur ce téléphone.", "success");
});

if (saveRenderBtn) {
  saveRenderBtn.addEventListener("click", () => {
    const url = normalizeUrl(renderUrlInput.value.trim());
    if (!url) return showRenderStatus("Ajoute l’URL de ton backend Render.", "error");
    localStorage.setItem("srt_app_render_url", url);
    renderUrlInput.value = url;
    showRenderStatus("Lien Render sauvegardé sur ce téléphone.", "success");
  });
}

audioFileInput.addEventListener("change", () => {
  compressedAudioFile = null;
  const file = audioFileInput.files[0];
  if (!file) {
    audioInfo.textContent = "Aucun audio sélectionné.";
    return;
  }
  audioInfo.textContent = `Audio original : ${formatSize(file.size)}`;
});

compressAudioBtn.addEventListener("click", async () => {
  const audioFile = audioFileInput.files[0];
  if (!audioFile) return showStatus("Ajoute d’abord un audio.", "error");

  try {
    compressAudioBtn.disabled = true;
    compressAudioBtn.textContent = "Compression en cours...";
    audioInfo.textContent = `Audio original : ${formatSize(audioFile.size)}. Compression...`;
    showStatus("Compression audio en cours sur le téléphone...", "loading");

    compressedAudioFile = await compressAudioToWebm(audioFile);
    audioInfo.textContent = `Audio compressé prêt : ${formatSize(compressedAudioFile.size)}`;
    showStatus("Audio compressé. Tu peux générer les sous-titres.", "success");
  } catch (error) {
    console.error(error);
    compressedAudioFile = null;
    audioInfo.textContent = "Compression impossible sur ce téléphone.";
    showStatus("Compression impossible. Essaie un audio plus court.", "error");
  } finally {
    compressAudioBtn.disabled = false;
    compressAudioBtn.textContent = "Compresser l’audio";
  }
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
  const workerUrl = normalizeUrl(workerUrlInput.value.trim() || localStorage.getItem("srt_app_worker_url") || "");
  const originalAudioFile = audioFileInput.files[0];
  const audioFile = compressedAudioFile || originalAudioFile;

  if (!workerUrl) return showStatus("Ajoute le lien Cloudflare Worker.", "error");
  if (!audioFile) return showStatus("Ajoute un fichier audio.", "error");
  if (audioFile.size > 25 * 1024 * 1024) return showStatus("Ton audio dépasse encore 25 Mo. Appuie d’abord sur Compresser l’audio.", "error");

  try {
    localStorage.setItem("srt_app_worker_url", workerUrl);
    workerUrlInput.value = workerUrl;

    showStatus("Envoi de l’audio au Worker Cloudflare...", "loading");
    generateBtn.disabled = true;
    generateBtn.textContent = "Génération en cours...";

    const formData = new FormData();
    formData.append("file", audioFile, audioFile.name || "audio.webm");
    formData.append("language", "fr");

    const response = await fetch(workerUrl, {
      method: "POST",
      body: formData
    });

    const text = await response.text();
    if (!response.ok) {
      console.error(text);
      return showStatus("Erreur Worker/OpenAI. Vérifie le Worker Cloudflare.", "error");
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

if (renderExportBtn) {
  renderExportBtn.addEventListener("click", async () => {
    const renderUrl = normalizeUrl(renderUrlInput.value.trim() || localStorage.getItem("srt_app_render_url") || "");
    const videoFile = videoFileInput.files[0];
    const srtText = srtOutput.value.trim();

    if (!renderUrl) return showRenderStatus("Ajoute le lien Render.", "error");
    if (!videoFile) return showRenderStatus("Ajoute la vidéo originale.", "error");
    if (!srtText) return showRenderStatus("Génère d’abord les sous-titres SRT.", "error");

    try {
      localStorage.setItem("srt_app_render_url", renderUrl);
      renderUrlInput.value = renderUrl;
      renderExportBtn.disabled = true;
      renderExportBtn.textContent = "Render travaille...";
      renderDownloadLink.classList.remove("show");
      showRenderStatus("Envoi à Render. Ne ferme pas la page.", "loading");

      const formData = new FormData();
      formData.append("video", videoFile, videoFile.name || "video.mp4");
      formData.append("srt", new Blob([srtText], { type: "text/plain;charset=utf-8" }), "subtitles.srt");
      formData.append("fontSize", fontSizeSelect.value);
      formData.append("position", subtitlePositionSelect.value);

      const response = await fetch(`${renderUrl}/api/burn-subtitles`, {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(errorText);
        return showRenderStatus("Erreur Render. Vérifie le backend ou teste une vidéo plus courte.", "error");
      }

      const blob = await response.blob();
      if (renderVideoUrl) URL.revokeObjectURL(renderVideoUrl);
      renderVideoUrl = URL.createObjectURL(blob);
      renderDownloadLink.href = renderVideoUrl;
      renderDownloadLink.classList.add("show");
      showRenderStatus(`MP4 Render créé : ${formatSize(blob.size)}.`, "success");
    } catch (error) {
      console.error(error);
      showRenderStatus("Impossible de contacter Render.", "error");
    } finally {
      renderExportBtn.disabled = false;
      renderExportBtn.textContent = "Créer MP4 avec Render FFmpeg";
    }
  });
}

burnBtn.addEventListener("click", async () => {
  const srtText = srtOutput.value.trim();

  if (!videoPreview.src) return showStatus("Charge la vidéo avant l’export.", "error");
  if (!srtText) return showStatus("Génère les sous-titres avant l’export.", "error");
  if (!window.MediaRecorder) return showStatus("Ton navigateur ne permet pas l’export vidéo ici.", "error");

  subtitleCues = parseSrt(srtText);
  if (!subtitleCues.length) return showStatus("Le SRT est vide ou mal formaté.", "error");

  try {
    burnBtn.disabled = true;
    burnBtn.textContent = "Export en cours...";
    exportProgress.value = 0;
    downloadVideoLink.classList.remove("show");
    showStatus("Export navigateur simple : laisse la vidéo jouer jusqu’à la fin.", "loading");

    const resultBlob = await renderVisiblePreviewWithSubtitles(subtitleCues);

    if (finalVideoUrl) URL.revokeObjectURL(finalVideoUrl);
    finalVideoUrl = URL.createObjectURL(resultBlob);
    downloadVideoLink.href = finalVideoUrl;
    downloadVideoLink.classList.add("show");

    showStatus(`Vidéo navigateur créée : ${formatSize(resultBlob.size)}.`, "success");
  } catch (error) {
    console.error(error);
    showStatus("Export impossible sur ce téléphone. Utilise Render ou télécharge le SRT.", "error");
  } finally {
    burnBtn.disabled = false;
    burnBtn.textContent = "Créer une vidéo sous-titrée rapide";
  }
});

fontSizeSelect.addEventListener("change", updateOverlayPositionAndSize);
subtitlePositionSelect.addEventListener("change", updateOverlayPositionAndSize);
videoPreview.addEventListener("play", startOverlayLoop);
videoPreview.addEventListener("pause", updateSubtitleOverlay);
videoPreview.addEventListener("seeked", updateSubtitleOverlay);
videoPreview.addEventListener("timeupdate", updateSubtitleOverlay);

function normalizeUrl(url) {
  if (!url) return "";
  const clean = url.trim().replace(/\/+$/, "");
  if (!clean.startsWith("https://")) return "";
  return clean;
}

async function compressAudioToWebm(file) {
  if (!window.MediaRecorder) throw new Error("MediaRecorder non disponible");

  const audio = document.createElement("audio");
  audio.src = URL.createObjectURL(file);
  audio.crossOrigin = "anonymous";

  await waitForAudioMetadata(audio);

  const audioContext = new AudioContext();
  const source = audioContext.createMediaElementSource(audio);
  const destination = audioContext.createMediaStreamDestination();
  source.connect(destination);
  source.connect(audioContext.destination);

  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
  const recorder = new MediaRecorder(destination.stream, {
    mimeType,
    audioBitsPerSecond: 64000
  });

  const chunks = [];
  recorder.ondataavailable = event => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };

  const done = new Promise((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.onerror = event => reject(event.error || new Error("Erreur compression audio"));
  });

  recorder.start(1000);
  audio.currentTime = 0;
  await audio.play();

  await new Promise(resolve => {
    audio.onended = resolve;
  });

  recorder.stop();
  await audioContext.close();
  URL.revokeObjectURL(audio.src);

  const blob = await done;
  return new File([blob], "audio-compresse.webm", { type: mimeType });
}

function waitForAudioMetadata(audio) {
  return new Promise((resolve, reject) => {
    audio.onloadedmetadata = () => resolve();
    audio.onerror = () => reject(new Error("Impossible de lire l’audio"));
  });
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

    const timeLineIndex = lines.findIndex(line => line.includes("-->"));
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

async function renderVisiblePreviewWithSubtitles(cues) {
  await waitForVideoMetadata(videoPreview);

  const width = videoPreview.videoWidth || 720;
  const height = videoPreview.videoHeight || 1280;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  const canvasStream = canvas.captureStream(24);

  if (videoPreview.captureStream) {
    const videoStream = videoPreview.captureStream();
    videoStream.getAudioTracks().forEach(track => canvasStream.addTrack(track));
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

  const fontSize = Number(fontSizeSelect.value);
  const position = subtitlePositionSelect.value;
  const duration = videoPreview.duration || 1;

  videoPreview.pause();
  videoPreview.currentTime = 0;
  await waitForSeek(videoPreview);

  recorder.start(1000);
  await videoPreview.play();

  await new Promise(resolve => {
    function drawFrame() {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(videoPreview, 0, 0, width, height);

      const text = getCueTextAt(cues, videoPreview.currentTime);
      if (text) drawSubtitle(ctx, text, width, height, fontSize, position);

      exportProgress.value = Math.min(100, Math.round((videoPreview.currentTime / duration) * 100));

      if (videoPreview.ended || videoPreview.currentTime >= duration) {
        resolve();
        return;
      }

      requestAnimationFrame(drawFrame);
    }

    drawFrame();
  });

  recorder.stop();
  videoPreview.pause();
  exportProgress.value = 100;
  return await done;
}

function waitForVideoMetadata(video) {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1 && video.videoWidth) return resolve();
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Impossible de lire la vidéo"));
  });
}

function waitForSeek(video) {
  return new Promise(resolve => {
    const finish = () => {
      video.removeEventListener("seeked", finish);
      resolve();
    };
    video.addEventListener("seeked", finish);
    setTimeout(finish, 500);
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

function formatSize(bytes) {
  if (!bytes) return "0 Mo";
  return `${(bytes / 1024 / 1024).toFixed(2)} Mo`;
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

function showRenderStatus(message, type) {
  if (!renderStatus) return;
  renderStatus.textContent = message;
  renderStatus.className = "status";
  if (type) renderStatus.classList.add(type);
}
