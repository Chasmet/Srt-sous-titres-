(() => {
  const PART_COUNT = 3;
  const previewVideoUrls = [];

  window.addEventListener("load", () => {
    const video = document.getElementById("videoPreview");
    const srtOutput = document.getElementById("srtOutput");
    const fontSizeSelect = document.getElementById("fontSize");
    const subtitlePositionSelect = document.getElementById("subtitlePosition");
    const progress = document.getElementById("exportProgress");
    const downloadLink = document.getElementById("downloadVideoLink");
    const burnBtn = document.getElementById("burnBtn");
    const statusBox = document.getElementById("status");

    if (!video || !srtOutput || !burnBtn || !progress || !downloadLink) return;

    const exportCard = burnBtn.closest("section");
    let partsBox = document.getElementById("previewPartsBox");

    if (exportCard) {
      const title = exportCard.querySelector("h2");
      const info = exportCard.querySelector("p.info") || exportCard.querySelector("p");
      if (title) title.textContent = "7. Télécharger l’aperçu en 3 vidéos";
      if (info) {
        info.textContent = "L’app filme l’aperçu en 3 fichiers séparés pour éviter que le téléphone plante. Tu peux ensuite recoller les 3 vidéos dans CapCut.";
      }

      if (!partsBox) {
        partsBox = document.createElement("div");
        partsBox.id = "previewPartsBox";
        partsBox.className = "actions";
        partsBox.style.marginTop = "12px";
        exportCard.appendChild(partsBox);
      }
    }

    burnBtn.textContent = "Créer 3 vidéos de l’aperçu";
    downloadLink.textContent = "Dernière partie créée";
    downloadLink.download = "apercu-sous-titre-partie.webm";

    burnBtn.addEventListener("click", async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      await capturePreviewInThreeParts();
    }, true);

    async function capturePreviewInThreeParts() {
      const srtText = (srtOutput.value || "").trim();
      if (!video.src) return setStatus("Charge la vidéo avant de télécharger l’aperçu.", "error");
      if (!srtText) return setStatus("Génère d’abord les sous-titres SRT.", "error");
      if (!window.MediaRecorder) return setStatus("Ton navigateur ne permet pas de filmer l’aperçu.", "error");

      const cues = parseSrtPreview(srtText);
      if (!cues.length) return setStatus("Le SRT est vide ou mal formaté.", "error");

      try {
        await waitForVideoReady(video);
        const duration = video.duration || 0;
        if (!duration || !Number.isFinite(duration)) return setStatus("Durée vidéo introuvable.", "error");

        clearOldPartLinks();

        burnBtn.disabled = true;
        burnBtn.textContent = "Capture 1/3...";
        progress.value = 0;
        downloadLink.classList.remove("show");
        setStatus("Capture en 3 fichiers. Laisse l’écran allumé.", "loading");

        const partDuration = duration / PART_COUNT;
        const results = [];

        for (let partIndex = 0; partIndex < PART_COUNT; partIndex++) {
          const start = partIndex * partDuration;
          const end = partIndex === PART_COUNT - 1 ? duration : (partIndex + 1) * partDuration;

          burnBtn.textContent = `Capture ${partIndex + 1}/3...`;
          setStatus(`Capture de la partie ${partIndex + 1}/3 en cours...`, "loading");

          const result = await recordPreviewPart(cues, start, end, partIndex, duration);
          const fileName = buildFileName(result.mimeType, partIndex + 1);
          const url = URL.createObjectURL(result.blob);
          previewVideoUrls.push(url);
          results.push({ ...result, url, fileName, partNumber: partIndex + 1 });

          addPartLink(url, fileName, partIndex + 1, result.blob.size);
          await saveBlobToPhone(result.blob, fileName, result.mimeType);
          await pauseBetweenParts();
        }

        const last = results[results.length - 1];
        if (last) {
          downloadLink.href = last.url;
          downloadLink.download = last.fileName;
          downloadLink.classList.add("show");
        }

        progress.value = 100;
        const totalSize = results.reduce((sum, item) => sum + item.blob.size, 0);
        setStatus(`3 vidéos créées : ${formatSizePreview(totalSize)} au total. Recoller dans CapCut.`, "success");
      } catch (error) {
        console.error(error);
        setStatus("Capture interrompue. Essaie avec écran allumé et sans changer d’application.", "error");
      } finally {
        burnBtn.disabled = false;
        burnBtn.textContent = "Créer 3 vidéos de l’aperçu";
        video.pause();
      }
    }

    async function recordPreviewPart(cues, startTime, endTime, partIndex, totalDuration) {
      const naturalWidth = video.videoWidth || 720;
      const naturalHeight = video.videoHeight || 1280;
      const displayWidth = video.clientWidth || naturalWidth;
      const scale = naturalWidth / displayWidth;

      const canvas = document.createElement("canvas");
      canvas.width = naturalWidth;
      canvas.height = naturalHeight;
      const ctx = canvas.getContext("2d", { alpha: false });

      const fps = 30;
      const canvasStream = canvas.captureStream(fps);
      addAudioTracks(video, canvasStream);

      const recorderConfig = getRecorderConfig(naturalWidth, naturalHeight);
      const recorder = new MediaRecorder(canvasStream, recorderConfig);
      const chunks = [];

      recorder.ondataavailable = event => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };

      const done = new Promise((resolve, reject) => {
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorderConfig.mimeType }));
        recorder.onerror = event => reject(event.error || new Error("Erreur MediaRecorder"));
      });

      const selectedFont = Number(fontSizeSelect?.value || 42);
      const cssFontSize = Math.max(18, selectedFont / 2);
      const drawFontSize = Math.round(cssFontSize * scale);
      const position = subtitlePositionSelect?.value || "bottom";

      video.pause();
      video.currentTime = Math.max(0, startTime);
      await waitForSeekPreview(video);

      recorder.start(500);
      await video.play();

      await new Promise(resolve => {
        const draw = () => {
          ctx.fillStyle = "#000000";
          ctx.fillRect(0, 0, naturalWidth, naturalHeight);
          ctx.drawImage(video, 0, 0, naturalWidth, naturalHeight);

          const subtitle = getCueText(cues, video.currentTime);
          if (subtitle) drawPreviewSubtitle(ctx, subtitle, naturalWidth, naturalHeight, drawFontSize, position);

          const totalPercent = ((partIndex + ((video.currentTime - startTime) / Math.max(1, endTime - startTime))) / PART_COUNT) * 100;
          progress.value = Math.min(100, Math.max(0, Math.round(totalPercent)));

          if (video.ended || video.currentTime >= endTime || video.currentTime >= totalDuration) {
            resolve();
            return;
          }
          requestAnimationFrame(draw);
        };
        draw();
      });

      recorder.stop();
      video.pause();
      const blob = await done;
      stopCanvasTracks(canvasStream);
      return { blob, mimeType: recorderConfig.mimeType };
    }

    function addAudioTracks(videoElement, canvasStream) {
      const sourceStream = typeof videoElement.captureStream === "function" ? videoElement.captureStream() : null;
      if (!sourceStream) return;
      sourceStream.getAudioTracks().forEach(track => canvasStream.addTrack(track));
    }

    function stopCanvasTracks(stream) {
      try {
        stream.getTracks().forEach(track => track.stop());
      } catch (error) {
        console.warn("Impossible de stopper les pistes", error);
      }
    }

    function getRecorderConfig(width, height) {
      const mimeTypes = [
        "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
        "video/mp4",
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm"
      ];
      const mimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || "video/webm";
      const pixels = width * height;
      let videoBitsPerSecond = 8000000;
      if (pixels >= 1920 * 1080) videoBitsPerSecond = 12000000;
      if (pixels >= 2160 * 3840) videoBitsPerSecond = 18000000;
      return {
        mimeType,
        videoBitsPerSecond,
        audioBitsPerSecond: 192000
      };
    }

    async function saveBlobToPhone(blob, fileName, mimeType) {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }

    function buildFileName(mimeType, partNumber) {
      const extension = mimeType.includes("mp4") ? "mp4" : "webm";
      return `apercu-sous-titre-partie-${partNumber}.${extension}`;
    }

    function addPartLink(url, fileName, partNumber, size) {
      if (!partsBox) return;
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.className = "downloadLink show";
      link.textContent = `Télécharger partie ${partNumber}/3 - ${formatSizePreview(size)}`;
      partsBox.appendChild(link);
    }

    function clearOldPartLinks() {
      previewVideoUrls.splice(0).forEach(url => URL.revokeObjectURL(url));
      if (partsBox) partsBox.innerHTML = "";
      downloadLink.classList.remove("show");
    }

    function pauseBetweenParts() {
      return new Promise(resolve => setTimeout(resolve, 800));
    }

    function drawPreviewSubtitle(ctx, text, width, height, fontSize, position) {
      const paddingX = Math.round(width * 0.08);
      const maxWidth = width - paddingX * 2;
      const lineHeight = Math.round(fontSize * 1.22);
      const lines = wrapPreviewText(ctx, text, maxWidth, fontSize).slice(0, 2);
      const blockHeight = lines.length * lineHeight;

      let y;
      if (position === "top") y = Math.round(height * 0.09);
      else if (position === "middle") y = Math.round((height - blockHeight) / 2);
      else y = Math.round(height - blockHeight - height * 0.09);

      ctx.save();
      ctx.font = `900 ${fontSize}px Arial, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = Math.max(6, Math.round(fontSize * 0.18));
      ctx.fillStyle = "#ffffff";
      ctx.shadowColor = "rgba(0,0,0,0.95)";
      ctx.shadowBlur = Math.round(fontSize * 0.18);
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = Math.round(fontSize * 0.08);

      lines.forEach((line, index) => {
        const lineY = y + index * lineHeight;
        ctx.strokeText(line, width / 2, lineY);
        ctx.fillText(line, width / 2, lineY);
      });
      ctx.restore();
    }

    function wrapPreviewText(ctx, text, maxWidth, fontSize) {
      ctx.font = `900 ${fontSize}px Arial, sans-serif`;
      const words = String(text).replace(/\s+/g, " ").trim().split(" ");
      const lines = [];
      let line = "";

      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
      return lines;
    }

    function parseSrtPreview(srtText) {
      return String(srtText)
        .replace(/\r/g, "")
        .trim()
        .split(/\n\s*\n/)
        .map(block => {
          const lines = block.split("\n").map(line => line.trim()).filter(Boolean);
          const timeIndex = lines.findIndex(line => line.includes("-->"));
          if (timeIndex === -1) return null;
          const [startRaw, endRaw] = lines[timeIndex].split("-->").map(part => part.trim());
          const start = srtTimeToSecondsPreview(startRaw);
          const end = srtTimeToSecondsPreview(endRaw);
          const text = lines.slice(timeIndex + 1).join(" ").trim();
          if (!Number.isFinite(start) || !Number.isFinite(end) || !text) return null;
          return { start, end, text };
        })
        .filter(Boolean);
    }

    function srtTimeToSecondsPreview(time) {
      const match = String(time).replace(",", ".").match(/(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
      if (!match) return NaN;
      return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    }

    function getCueText(cues, time) {
      const cue = cues.find(item => time >= item.start && time <= item.end);
      return cue ? cue.text : "";
    }

    function waitForVideoReady(videoElement) {
      return new Promise((resolve, reject) => {
        if (videoElement.readyState >= 2 && videoElement.videoWidth) return resolve();
        videoElement.onloadeddata = () => resolve();
        videoElement.onerror = () => reject(new Error("Impossible de lire la vidéo"));
      });
    }

    function waitForSeekPreview(videoElement) {
      return new Promise(resolve => {
        const done = () => {
          videoElement.removeEventListener("seeked", done);
          resolve();
        };
        videoElement.addEventListener("seeked", done);
        setTimeout(done, 600);
      });
    }

    function setStatus(message, type) {
      statusBox.textContent = message;
      statusBox.className = "status";
      if (type) statusBox.classList.add(type);
    }

    function formatSizePreview(bytes) {
      if (!bytes) return "0 Mo";
      return `${(bytes / 1024 / 1024).toFixed(2)} Mo`;
    }
  });
})();
