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
const applySrtBtn = document.getElementById("applySrtBtn");
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
  showStatus("Vidéo chargée. Tu peux générer ou coller les sous-titres.", "success");
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

    applySrtTextToPreview(text, "Sous-titres générés avec succès.");
  } catch (error) {
    console.error(error);
    showStatus("Erreur : impossible de contacter le Worker Cloudflare.", "error");
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = "Générer les sous-titres SRT avec l’API";
  }
});

if (applySrtBtn) {
  applySrtBtn.addEventListener("click", () => {
    const text = srtOutput.value.trim();
    if (!text) return showStatus("Colle d’abord ton SRT dans la zone texte.", "error");
    applySrtTextToPreview(text, "SRT collé lu dans l’aperçu. Tu peux lancer la vidéo.");
  });
}

srtOutput.addEventListener("input", () => {
  const text = srtOutput.value.trim();
  if (!text) {
    currentSrtText = "";
    subtitleCues = [];
    subtitleOverlay.textContent = "";
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
    if (!srtText) return showRenderStatus("Génère ou colle d’abord les sous-titres SRT.", "error");

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

if (burnBtn) {
  burnBtn.addEventListener("click", async () => {
    const srtText = srtOutput.value.trim();

    if (!videoPreview.src) return showStatus("Charge la vidéo avant l’export.", "error");
    if (!srtText) return showStatus("Génère ou colle les sous-titres avant l’export.", "error");
    if (!window.MediaRecorder) return showStatus("Ton navigateur ne permet pas l’export vidéo ici.", "error");

    subtitleCues = parseSrt(srtText);
    if (!subtitleCues.length) return showStatus("Le SRT est vide ou mal formaté.", "error");
  });
}

fontSizeSelect.addEventListener("change", updateOverlayPositionAndSize);
subtitlePositionSelect.addEventListener("change", updateOverlayPositionAndSize);
videoPreview.addEventListener("play", startOverlayLoop);
videoPreview.addEventListener("pause", updateSubtitleOverlay);
videoPreview.addEventListener("seeked", updateSubtitleOverlay);
videoPreview.addEventListener("timeupdate", updateSubtitleOverlay);

function applySrtTextToPreview(srtText, successMessage) {
  const cleanText = normalizeSrtTextForApp(srtText);
  const cues = parseSrt(cleanText);

  if (!cues.length) {
    showStatus("SRT illisible. Vérifie le format : numéro, timing, texte.", "error");
    return false;
  }

  currentSrtText = cleanText;
  srtOutput.value = cleanText;
  subtitleCues = cues;
  createVideoSubtitles(cleanText);
  startOverlayLoop();
  updateSubtitleOverlay();
  showStatus(successMessage, "success");
  return true;
}

function normalizeSrtTextForApp(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[–—]/g, "--")
    .trim()
    .concat("\n");
}

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
