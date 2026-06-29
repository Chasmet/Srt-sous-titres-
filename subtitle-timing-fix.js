/*
  Correctif timing sous-titres.
  But : ne jamais afficher un sous-titre avant son timecode SRT réel.
  Ajoute aussi un décalage manuel si le SRT est en avance ou en retard.
*/
(function () {
  const EPSILON = 0.015;
  const DELAY_KEY = "srt_app_subtitle_delay";

  const delayInput = document.getElementById("subtitleDelay");
  const delayValue = document.getElementById("subtitleDelayValue");

  if (delayInput) {
    const savedDelay = localStorage.getItem(DELAY_KEY);
    if (savedDelay !== null && Number.isFinite(Number(savedDelay))) delayInput.value = savedDelay;
    updateDelayLabel();
    delayInput.addEventListener("input", () => {
      localStorage.setItem(DELAY_KEY, delayInput.value);
      updateDelayLabel();
    });
  }

  function updateDelayLabel() {
    if (!delayInput || !delayValue) return;
    const value = Number(delayInput.value || 0);
    delayValue.textContent = `${value > 0 ? "+" : ""}${value.toFixed(1)} s`;
  }

  function getDelaySeconds() {
    const value = Number(delayInput?.value || 0);
    return Number.isFinite(value) ? value : 0;
  }

  window.timeToSeconds = function timeToSecondsFixed(time) {
    const raw = String(time || "").trim();
    const cleaned = raw
      .replace(",", ".")
      .replace(/[^0-9:.]/g, "");

    const parts = cleaned.split(":");
    if (parts.length === 3) {
      const h = Number(parts[0]);
      const m = Number(parts[1]);
      const s = Number(parts[2]);
      if ([h, m, s].every(Number.isFinite)) return h * 3600 + m * 60 + s;
    }

    if (parts.length === 2) {
      const m = Number(parts[0]);
      const s = Number(parts[1]);
      if ([m, s].every(Number.isFinite)) return m * 60 + s;
    }

    return NaN;
  };

  window.parseSrt = function parseSrtFixed(srtText) {
    return String(srtText || "")
      .replace(/\r/g, "")
      .trim()
      .split(/\n\s*\n/)
      .map(block => {
        const lines = block.split("\n").map(line => line.trim()).filter(Boolean);
        const timeIndex = lines.findIndex(line => line.includes("-->"));
        if (timeIndex === -1) return null;

        const [startRaw, endRaw] = lines[timeIndex].split("-->");
        const start = window.timeToSeconds(startRaw);
        const end = window.timeToSeconds(endRaw);
        const text = lines.slice(timeIndex + 1).join(" ").trim();

        if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
        if (!text || end <= start) return null;
        return { start, end, text };
      })
      .filter(Boolean)
      .sort((a, b) => a.start - b.start);
  };

  window.getSubtitleAt = function getSubtitleAtFixed(time) {
    const currentTime = Number(time);
    if (!Number.isFinite(currentTime)) return "";

    let cues;
    try {
      cues = typeof subtitleCues !== "undefined" ? subtitleCues : window.subtitleCues;
    } catch (error) {
      cues = window.subtitleCues;
    }

    if (!Array.isArray(cues) || !cues.length) return "";

    const effectiveTime = currentTime - getDelaySeconds();
    if (!Number.isFinite(effectiveTime) || effectiveTime < 0) return "";

    const firstCue = cues[0];
    if (effectiveTime + EPSILON < firstCue.start) return "";

    const cue = cues.find(item => {
      if (!item) return false;
      return effectiveTime + EPSILON >= item.start && effectiveTime < item.end - EPSILON;
    });

    return cue ? cue.text : "";
  };

  window.drawOneFrame = function drawOneFrameTimingFixed() {
    const ctx = exportCanvas.getContext("2d", { alpha: false });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "medium";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);

    drawVideoContain(ctx, hiddenVideo, exportCanvas.width, exportCanvas.height);

    const currentTime = Number(hiddenVideo.currentTime || 0);
    const subtitleText = window.getSubtitleAt(currentTime);
    if (subtitleText) drawSubtitle(ctx, subtitleText);
  };
})();
