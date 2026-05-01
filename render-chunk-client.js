(() => {
  const RENDER_URL = "https://srt-sous-titres.onrender.com";
  const SIMPLE_LIMIT_MB = 700;
  const CHUNK_SIZE_MB = 240;
  const MB = 1024 * 1024;

  window.addEventListener("load", () => {
    const renderUrlInput = document.getElementById("renderUrl");
    const renderBtn = document.getElementById("renderExportBtn");
    const renderStatus = document.getElementById("renderStatus");
    const downloadLink = document.getElementById("renderDownloadLink");
    const videoInput = document.getElementById("videoFile");
    const srtOutput = document.getElementById("srtOutput");
    const fontSize = document.getElementById("fontSize");
    const position = document.getElementById("subtitlePosition");

    if (!renderBtn || !renderUrlInput || !renderStatus) return;

    renderUrlInput.value = RENDER_URL;
    localStorage.setItem("srt_app_render_url", RENDER_URL);

    let progress = document.getElementById("renderProgress");
    if (!progress) {
      progress = document.createElement("progress");
      progress.id = "renderProgress";
      progress.max = 100;
      progress.value = 0;
      progress.style.width = "100%";
      progress.style.marginTop = "14px";
      renderStatus.insertAdjacentElement("afterend", progress);
    }

    let detail = document.getElementById("renderDetail");
    if (!detail) {
      detail = document.createElement("div");
      detail.id = "renderDetail";
      detail.className = "miniStatus";
      detail.textContent = "En attente.";
      progress.insertAdjacentElement("afterend", detail);
    }

    renderBtn.addEventListener("click", event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      startRenderExport();
    }, true);

    async function startRenderExport() {
      const videoFile = videoInput.files && videoInput.files[0];
      const srtText = (srtOutput.value || "").trim();

      if (!videoFile) return setStatus("Ajoute la vidéo originale.", "error");
      if (!srtText) return setStatus("Génère d’abord les sous-titres SRT.", "error");

      renderBtn.disabled = true;
      renderBtn.textContent = "Render travaille...";
      downloadLink.classList.remove("show");
      progress.value = 0;

      try {
        if (videoFile.size > SIMPLE_LIMIT_MB * MB) {
          await exportWithChunks(videoFile, srtText);
        } else {
          await exportSimple(videoFile, srtText);
        }
      } catch (error) {
        console.error(error);
        progress.value = 0;
        setStatus(error.message || "Erreur Render.", "error");
      } finally {
        renderBtn.disabled = false;
        renderBtn.textContent = "Créer MP4 avec Render FFmpeg";
      }
    }

    async function exportSimple(videoFile, srtText) {
      setStatus("Envoi simple vers Render...", "loading");
      setDetail(`Vidéo : ${formatSize(videoFile.size)}.`);

      const formData = new FormData();
      formData.append("video", videoFile, videoFile.name || "video.mp4");
      formData.append("srt", new Blob([srtText], { type: "text/plain;charset=utf-8" }), "subtitles.srt");
      formData.append("fontSize", fontSize.value);
      formData.append("position", position.value);

      const blob = await xhrPostBlob(`${RENDER_URL}/api/burn-subtitles`, formData, percent => {
        progress.value = Math.min(50, Math.max(1, Math.round(percent * 0.5)));
        setStatus(`Envoi simple : ${Math.round(percent)}%`, "loading");
      });

      progress.value = 100;
      showDownload(blob);
    }

    async function exportWithChunks(videoFile, srtText) {
      const chunkSize = CHUNK_SIZE_MB * MB;
      const totalChunks = Math.ceil(videoFile.size / chunkSize);

      setStatus("Mode gros fichier : envoi fragmenté activé.", "loading");
      setDetail(`Vidéo : ${formatSize(videoFile.size)}. Fragments : ${totalChunks} x environ ${CHUNK_SIZE_MB} Mo.`);
      progress.value = 1;

      const initResponse = await fetch(`${RENDER_URL}/api/chunk/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: videoFile.name || "video.mp4",
          fileSize: videoFile.size,
          totalChunks,
          srtText,
          fontSize: fontSize.value,
          position: position.value
        })
      });

      if (!initResponse.ok) {
        const text = await initResponse.text();
        throw new Error(`Erreur init Render : ${text}`);
      }

      const initData = await initResponse.json();
      const jobId = initData.jobId;
      if (!jobId) throw new Error("Render n’a pas renvoyé de jobId.");

      for (let index = 0; index < totalChunks; index++) {
        const start = index * chunkSize;
        const end = Math.min(start + chunkSize, videoFile.size);
        const chunk = videoFile.slice(start, end);
        const formData = new FormData();
        formData.append("chunk", chunk, `chunk-${String(index).padStart(6, "0")}.part`);

        setStatus(`Envoi fragment ${index + 1} / ${totalChunks}`, "loading");
        setDetail(`Fragment ${index + 1} : ${formatSize(chunk.size)}.`);

        await xhrPostJson(`${RENDER_URL}/api/chunk/upload?jobId=${encodeURIComponent(jobId)}&index=${index}`, formData, percent => {
          const chunkBase = (index / totalChunks) * 80;
          const chunkProgress = (percent / 100) * (80 / totalChunks);
          progress.value = Math.max(1, Math.min(80, Math.round(chunkBase + chunkProgress)));
        });
      }

      progress.value = 85;
      setStatus("Tous les fragments sont envoyés. Assemblage Render...", "loading");
      setDetail("Render assemble la vidéo puis lance FFmpeg. Cette étape peut être longue.");

      const finishBlob = await xhrPostBlobJson(`${RENDER_URL}/api/chunk/finish`, {
        jobId,
        totalChunks
      });

      progress.value = 100;
      showDownload(finishBlob);
    }

    function xhrPostJson(url, formData, onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        xhr.timeout = 30 * 60 * 1000;

        xhr.upload.onprogress = event => {
          if (event.lengthComputable && onProgress) onProgress((event.loaded / event.total) * 100);
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText || "{}"));
            } catch {
              resolve({ ok: true });
            }
          } else {
            reject(new Error(`Erreur Render ${xhr.status} : ${xhr.responseText || "upload impossible"}`));
          }
        };

        xhr.onerror = () => reject(new Error("Connexion Render coupée pendant l’envoi d’un fragment."));
        xhr.ontimeout = () => reject(new Error("Timeout Render pendant l’envoi d’un fragment."));
        xhr.send(formData);
      });
    }

    function xhrPostBlob(url, formData, onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        xhr.responseType = "blob";
        xhr.timeout = 45 * 60 * 1000;

        xhr.upload.onprogress = event => {
          if (event.lengthComputable && onProgress) onProgress((event.loaded / event.total) * 100);
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) return resolve(xhr.response);
          reject(new Error(`Erreur Render ${xhr.status}. Regarde les logs Render.`));
        };

        xhr.onerror = () => reject(new Error("Connexion Render coupée."));
        xhr.ontimeout = () => reject(new Error("Render met trop longtemps."));
        xhr.send(formData);
      });
    }

    function xhrPostBlobJson(url, data) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.responseType = "blob";
        xhr.timeout = 60 * 60 * 1000;

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) return resolve(xhr.response);
          reject(new Error(`Erreur Render ${xhr.status}. Regarde les logs Render.`));
        };

        xhr.onerror = () => reject(new Error("Connexion Render coupée pendant l’assemblage."));
        xhr.ontimeout = () => reject(new Error("Render met trop longtemps pendant FFmpeg."));
        xhr.send(JSON.stringify(data));
      });
    }

    function showDownload(blob) {
      const url = URL.createObjectURL(blob);
      downloadLink.href = url;
      downloadLink.classList.add("show");
      setStatus(`MP4 Render créé : ${formatSize(blob.size)}.`, "success");
      setDetail("Appuie sur Télécharger le MP4 Render.");
    }

    function setStatus(message, type) {
      renderStatus.textContent = message;
      renderStatus.className = "status";
      if (type) renderStatus.classList.add(type);
    }

    function setDetail(message) {
      detail.textContent = message;
    }

    function formatSize(bytes) {
      if (!bytes) return "0 Mo";
      return `${(bytes / MB).toFixed(2)} Mo`;
    }
  });
})();
