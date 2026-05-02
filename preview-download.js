(() => {
  let previewVideoUrl = null;

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
    if (exportCard) {
      const title = exportCard.querySelector("h2");
      const info = exportCard.querySelector("p.info");
      if (title) title.textContent = "8. Télécharger l’aperçu sous-titré";
      if (info) {
        info.textContent = "Cette option filme uniquement l’aperçu propre : ta vidéo + les sous-titres visibles. Le fichier est sauvegardé dans les téléchargements du téléphone.";
      }
    }

    burnBtn.textContent = "Télécharger l’aperçu avec sous-titres";
    downloadLink.textContent = "Ouvrir / télécharger la vidéo de l’aperçu";
    downloadLink.download = "apercu-sous-titre.webm";

    burnBtn.addEventListener("click", async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      await capturePreviewVideo();
    }, true);

    async function capturePreviewVideo() {
      const srtText = (srtOutput.value || "").trim();
      if (!video.src) return setStatus("Charge la vidéo avant de télécharger l’aperçu.", "error");
      if (!srtText) return setStatus("Génère d’abord les sous-titres SRT.", "error");
      if (!window.MediaRecorder) return setStatus("Ton navigateur ne permet pas de filmer l’aperçu.", "error");

      const cues = parseSrtPreview(srtText);
      if (!cues.length) return setStatus("Le SRT est vide ou mal formaté.", "error");

      try {
        burnBtn.disabled = true;
        burnBtn.textContent = "Capture de l’aperçu...";
        progress.value = 0;
        downloadLink.classList.remove("show");
        setStatus("Capture de l’aperçu en cours. Ne ferme pas la page.", "loading");

        const result = await recordPreview(cues);
        if (previewVideoUrl) URL.revokeObjectURL(previewVideoUrl);
        previewVideoUrl = URL.createObjectURL(result.blob);

        const fileName = result.mimeType.includes("mp4") ? "apercu-sous-titre.mp4" : "apercu-sous-titre.webm";
        downloadLink.href = previewVideoUrl;
        downloadLink.download = fileName;
        downloadLink.classList.add("show");

        await saveBlobToPhone(result.blob, fileName, result.mimeType);
        setStatus(`Aperçu sauvegardé : ${formatSizePreview(result.blob.size)}.`, "success");
      } catch (error) {
        console.error(error);
        setStatus("Capture impossible sur ce téléphone. Essaie une vidéo plus courte.", "error");
      } finally {
        burnBtn.disabled = false;
        burnBtn.textContent = "Télécharger l’aperçu avec sous-titres";
      }
    }

    async function recordPreview(cues) {
      await waitForVideoReady(video);

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
      const duration = video.duration || 1;

      video.pause();
      video.currentTime = 0;
      await waitForSeekPreview(video);

      recorder.start(1000);
      await video.play();

      await new Promise(resolve => {
        const draw = () => {
          ctx.fillStyle = "#000000";
          ctx.fillRect(0, 0, naturalWidth, naturalHeight);
          ctx.drawImage(video, 0, 0, naturalWidth, naturalHeight);

          const subtitle = getCueText(cues, video.currentTime);
          if (subtitle) drawPreviewSubtitle(ctx, subtitle, naturalWidth, naturalHeight, drawFontSize, position);

          progress.value = Math.min(100, Math.round((video.currentTime / duration) * 100));

          if (video.ended || video.currentTime >= duration) {
            resolve();
            return;
          }
          requestAnimationFrame(draw);
        };
        draw();
      });

      recorder.stop();
      video.pause();
      progress.value = 100;
      const blob = await done;
      return { blob, mimeType: recorderConfig.mimeType };
    }

    function addAudioTracks(videoElement, canvasStream) {
      const sourceStream = typeof videoElement.captureStream === "function" ? videoElement.captureStream() : null;
      if (!sourceStream) return;
      sourceStream.getAudioTracks().forEach(track => canvasStream.addTrack(track));
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
      let videoBitsPerSecond = 9000000;
      if (pixels >= 1920 * 1080) videoBitsPerSecond = 16000000;
      if (pixels >= 2160 * 3840) videoBitsPerSecond = 24000000;
      return {
        mimeType,
        videoBitsPerSecond,
        audioBitsPerSecond: 192000
      };
    }

    async function saveBlobToPhone(blob, fileName, mimeType) {
      if (window.showSaveFilePicker) {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: fileName,
            types: [{
              description: "Vidéo de l’aperçu",
              accept: { [mimeType]: [fileName.endsWith(".mp4") ? ".mp4" : ".webm"] }
            }]
          });
          const writable = await handle.createWritable();
          await writable.write(blob);
          await writable.close();
          return;
        } catch (error) {
          console.warn("Sauvegarde manuelle annulée ou indisponible", error);
        }
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
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
