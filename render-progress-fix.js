(() => {
  const RENDER_URL = "https://srt-sous-titres.onrender.com";

  window.addEventListener("load", () => {
    const renderUrlInput = document.getElementById("renderUrl");
    const renderBtn = document.getElementById("renderExportBtn");
    const renderStatus = document.getElementById("renderStatus");
    const downloadLink = document.getElementById("renderDownloadLink");
    const videoInput = document.getElementById("videoFile");
    const srtOutput = document.getElementById("srtOutput");
    const fontSize = document.getElementById("fontSize");
    const position = document.getElementById("subtitlePosition");

    if (!renderBtn || !renderUrlInput) return;

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

    renderBtn.addEventListener("click", event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      startRenderExport();
    }, true);

    function startRenderExport() {
      const videoFile = videoInput.files && videoInput.files[0];
      const srtText = (srtOutput.value || "").trim();

      if (!videoFile) return setStatus("Ajoute la vidéo originale.", "error");
      if (!srtText) return setStatus("Génère d’abord les sous-titres SRT.", "error");

      const formData = new FormData();
      formData.append("video", videoFile, videoFile.name || "video.mp4");
      formData.append("srt", new Blob([srtText], { type: "text/plain;charset=utf-8" }), "subtitles.srt");
      formData.append("fontSize", fontSize.value);
      formData.append("position", position.value);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${RENDER_URL}/api/burn-subtitles`);
      xhr.responseType = "blob";
      xhr.timeout = 30 * 60 * 1000;

      renderBtn.disabled = true;
      renderBtn.textContent = "Render travaille...";
      downloadLink.classList.remove("show");
      progress.value = 1;
      setStatus("Préparation de l’envoi vers Render...", "loading");

      xhr.upload.onprogress = event => {
        if (!event.lengthComputable) {
          setStatus("Envoi à Render en cours...", "loading");
          return;
        }
        const percent = Math.max(1, Math.min(50, Math.round((event.loaded / event.total) * 50)));
        progress.value = percent;
        setStatus(`Envoi de la vidéo à Render : ${percent * 2}%`, "loading");
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          progress.value = 100;
          const blob = xhr.response;
          const url = URL.createObjectURL(blob);
          downloadLink.href = url;
          downloadLink.classList.add("show");
          setStatus(`MP4 Render créé : ${formatSize(blob.size)}.`, "success");
          resetButton();
          return;
        }

        progress.value = 0;
        setStatus(`Erreur Render ${xhr.status}. Regarde les logs Render.`, "error");
        resetButton();
      };

      xhr.onerror = () => {
        progress.value = 0;
        setStatus("Connexion Render coupée. Regarde les logs Render.", "error");
        resetButton();
      };

      xhr.ontimeout = () => {
        progress.value = 0;
        setStatus("Render met trop longtemps. Teste une vidéo plus courte.", "error");
        resetButton();
      };

      xhr.onloadstart = () => {
        setStatus("Envoi à Render lancé. Ne ferme pas la page.", "loading");
      };

      xhr.onloadend = () => {
        if (progress.value >= 50 && progress.value < 100) {
          setStatus("Render traite la vidéo avec FFmpeg. Patiente...", "loading");
        }
      };

      xhr.send(formData);
    }

    function resetButton() {
      renderBtn.disabled = false;
      renderBtn.textContent = "Créer MP4 avec Render FFmpeg";
    }

    function setStatus(message, type) {
      renderStatus.textContent = message;
      renderStatus.className = "status";
      if (type) renderStatus.classList.add(type);
    }

    function formatSize(bytes) {
      if (!bytes) return "0 Mo";
      return `${(bytes / 1024 / 1024).toFixed(2)} Mo`;
    }
  });
})();
