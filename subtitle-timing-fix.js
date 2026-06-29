/*
  Correctif timing sous-titres.
  But : ne jamais afficher le premier sous-titre avant son timecode SRT réel.
*/
(function () {
  const EPSILON = 0.035;

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
    const t = Number(time);
    if (!Number.isFinite(t) || !Array.isArray(window.subtitleCues) && typeof subtitleCues === "undefined") return "";

    const cues = typeof subtitleCues !== "undefined" ? subtitleCues : window.subtitleCues;
    if (!Array.isArray(cues) || !cues.length) return "";

    const firstCue = cues[0];
    if (t + EPSILON < firstCue.start) return "";

    const cue = cues.find(item => {
      if (!item) return false;
      return t + EPSILON >= item.start && t < item.end - EPSILON;
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
