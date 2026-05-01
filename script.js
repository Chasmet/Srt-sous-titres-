const apiKeyInput = document.getElementById("apiKey");
const audioFileInput = document.getElementById("audioFile");
const videoFileInput = document.getElementById("videoFile");
const videoPreview = document.getElementById("videoPreview");
const srtOutput = document.getElementById("srtOutput");
const statusBox = document.getElementById("status");

const saveKeyBtn = document.getElementById("saveKeyBtn");
const loadVideoBtn = document.getElementById("loadVideoBtn");
const generateBtn = document.getElementById("generateBtn");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");

let currentSrtText = "";
let currentTrackUrl = null;

window.addEventListener("load", () => {
  const savedKey = localStorage.getItem("openai_api_key_srt_app");

  if (savedKey) {
    apiKeyInput.value = savedKey;
  }
});

saveKeyBtn.addEventListener("click", () => {
  const key = apiKeyInput.value.trim();

  if (!key) {
    showStatus("Ajoute d’abord ta clé API OpenAI.", "error");
    return;
  }

  localStorage.setItem("openai_api_key_srt_app", key);
  showStatus("Clé API sauvegardée sur ce téléphone.", "success");
});

loadVideoBtn.addEventListener("click", () => {
  const videoFile = videoFileInput.files[0];

  if (!videoFile) {
    showStatus("Ajoute une vidéo avant de charger la prévisualisation.", "error");
    return;
  }

  const videoUrl = URL.createObjectURL(videoFile);
  videoPreview.src = videoUrl;

  showStatus("Vidéo chargée. Tu peux maintenant générer les sous-titres.", "success");
});

generateBtn.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  const audioFile = audioFileInput.files[0];

  if (!apiKey) {
    showStatus("Ajoute ta clé API OpenAI.", "error");
    return;
  }

  if (!audioFile) {
    showStatus("Ajoute un fichier audio.", "error");
    return;
  }

  if (audioFile.size > 25 * 1024 * 1024) {
    showStatus("Ton audio dépasse 25 Mo. Coupe-le ou compresse-le avant.", "error");
    return;
  }

  try {
    showStatus("Envoi de l’audio à OpenAI...", "loading");
    generateBtn.disabled = true;
    generateBtn.textContent = "Génération en cours...";

    const formData = new FormData();
    formData.append("file", audioFile);
    formData.append("model", "whisper-1");
    formData.append("response_format", "srt");
    formData.append("language", "fr");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`
      },
      body: formData
    });

    const text = await response.text();

    if (!response.ok) {
      console.error(text);
      showStatus("Erreur OpenAI. Vérifie ta clé API ou ton fichier audio.", "error");
      return;
    }

    currentSrtText = text;
    srtOutput.value = text;

    createVideoSubtitles(text);

    showStatus("Sous-titres générés avec succès.", "success");
  } catch (error) {
    console.error(error);
    showStatus("Erreur : impossible de générer les sous-titres.", "error");
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = "Générer les sous-titres SRT";
  }
});

copyBtn.addEventListener("click", async () => {
  const text = srtOutput.value.trim();

  if (!text) {
    showStatus("Aucun SRT à copier.", "error");
    return;
  }

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

  if (!text) {
    showStatus("Aucun SRT à télécharger.", "error");
    return;
  }

  const blob = new Blob([text], {
    type: "text/plain;charset=utf-8"
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "sous-titres.srt";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);

  showStatus("Fichier SRT téléchargé.", "success");
});

function createVideoSubtitles(srtText) {
  if (!videoPreview.src) {
    showStatus("SRT généré. Ajoute une vidéo pour voir la prévisualisation.", "success");
    return;
  }

  const oldTracks = videoPreview.querySelectorAll("track");
  oldTracks.forEach(track => track.remove());

  if (currentTrackUrl) {
    URL.revokeObjectURL(currentTrackUrl);
  }

  const vttText = convertSrtToVtt(srtText);

  const blob = new Blob([vttText], {
    type: "text/vtt;charset=utf-8"
  });

  currentTrackUrl = URL.createObjectURL(blob);

  const track = document.createElement("track");
  track.kind = "subtitles";
  track.label = "Français";
  track.srclang = "fr";
  track.src = currentTrackUrl;
  track.default = true;

  videoPreview.appendChild(track);

  videoPreview.textTracks[0].mode = "showing";
}

function convertSrtToVtt(srtText) {
  let cleanText = srtText
    .replace(/\r+/g, "")
    .trim();

  cleanText = cleanText.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");

  return "WEBVTT\n\n" + cleanText + "\n";
}

function showStatus(message, type) {
  statusBox.textContent = message;
  statusBox.className = "status";

  if (type) {
    statusBox.classList.add(type);
  }
}
