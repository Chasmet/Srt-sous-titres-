(function () {
  const qualitySelect = document.getElementById("qualitySelect");
  const formatSelect = document.getElementById("formatSelect");
  const startBtn = document.getElementById("startBtn");
  const compatStatus = document.getElementById("compatStatus");

  if (qualitySelect) qualitySelect.value = "high";
  if (startBtn) startBtn.textContent = "Créer MP4 1080p propre";
  if (compatStatus) {
    compatStatus.textContent = "Mode qualité actif : MP4 1080p propre. Fichier plus net, plus lourd, export plus long.";
    compatStatus.className = "status success";
  }

  window.getMaxSideForQuality = function () {
    const quality = qualitySelect ? qualitySelect.value : "high";
    if (quality === "mobile") return 1280;
    if (quality === "smooth134") return 1600;
    if (quality === "medium") return 1920;
    return 1920;
  };

  window.getVideoBitrate = function () {
    const quality = qualitySelect ? qualitySelect.value : "high";
    if (quality === "mobile") return 6000000;
    if (quality === "smooth134") return 9000000;
    if (quality === "medium") return 12000000;
    return 16000000;
  };

  window.setupCanvasSize = function (video) {
    const canvas = document.getElementById("exportCanvas");
    if (!canvas) return;

    const format = formatSelect ? formatSelect.value : "keep";
    const vw = video.videoWidth || 1080;
    const vh = video.videoHeight || 1920;

    if (format === "vertical") return setCanvas(canvas, 1080, 1920);
    if (format === "square") return setCanvas(canvas, 1080, 1080);
    if (format === "horizontal") return setCanvas(canvas, 1920, 1080);
    if (format === "mobile720") return vh >= vw ? setCanvas(canvas, 1080, 1920) : setCanvas(canvas, 1920, 1080);

    const maxSide = window.getMaxSideForQuality();
    const ratio = vw / vh;
    if (vw >= vh) return setCanvas(canvas, maxSide, Math.round(maxSide / ratio));
    return setCanvas(canvas, Math.round(maxSide * ratio), maxSide);
  };

  function setCanvas(canvas, w, h) {
    canvas.width = Math.round(w);
    canvas.height = Math.round(h);
  }
})();
