/*
  Mode MP4 full demandé.
  Force l'application à exporter en MP4 si le navigateur le supporte.
  Ne bascule plus automatiquement en WebM.
*/
(function () {
  function pickMp4Type() {
    const types = [
      "video/mp4;codecs=h264,aac",
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4;codecs=avc1.64001F,mp4a.40.2",
      "video/mp4"
    ];
    return types.find(type => window.MediaRecorder && MediaRecorder.isTypeSupported(type));
  }

  window.getBestRecorderConfig = function getBestRecorderConfigMp4Full() {
    const mp4 = pickMp4Type();
    if (!mp4) throw new Error("Ton navigateur ne permet pas l’export MP4 direct. Essaie Chrome à jour.");
    return { mimeType: mp4, extension: "mp4" };
  };

  window.showCompatibilityStatus = function showCompatibilityStatusMp4Full() {
    const compatStatus = document.getElementById("compatStatus");
    if (!compatStatus) return;

    if (!window.MediaRecorder) {
      compatStatus.textContent = "Export impossible : MediaRecorder non supporté par ce navigateur.";
      compatStatus.className = "status error";
      return;
    }

    const mp4 = pickMp4Type();
    if (mp4) {
      compatStatus.textContent = "Mode MP4 full actif : l’application exporte directement en MP4.";
      compatStatus.className = "status success";
    } else {
      compatStatus.textContent = "MP4 direct non supporté par ce navigateur. Mets Chrome à jour.";
      compatStatus.className = "status error";
    }
  };

  try {
    window.showCompatibilityStatus();
  } catch (error) {
    console.warn("Statut MP4 non mis à jour", error);
  }
})();
