/*
  Correctif export navigateur.
  Problème constaté : certains Chrome Android acceptent MediaRecorder MP4,
  mais créent un MP4 fragmenté avec une durée mal lue par CapCut/Galerie.
  Solution mobile sans serveur : forcer WebM VP8 + correction durée WebM quand la librairie est disponible.
*/
(function () {
  function pickWebmType() {
    const types = [
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp9,opus",
      "video/webm"
    ];
    return types.find(type => window.MediaRecorder && MediaRecorder.isTypeSupported(type));
  }

  window.getBestRecorderConfig = function getBestRecorderConfigForcedWebm() {
    const webm = pickWebmType();
    if (!webm) throw new Error("Aucun export WebM compatible trouvé sur ce navigateur.");
    return { mimeType: webm, extension: "webm" };
  };

  window.showCompatibilityStatus = function showCompatibilityStatusForcedWebm() {
    const compatStatus = document.getElementById("compatStatus");
    if (!compatStatus) return;

    if (!window.MediaRecorder) {
      compatStatus.textContent = "Export impossible : MediaRecorder non supporté par ce navigateur.";
      compatStatus.className = "status error";
      return;
    }

    const webm = pickWebmType();
    if (!webm) {
      compatStatus.textContent = "Export impossible : WebM non supporté par ce navigateur.";
      compatStatus.className = "status error";
      return;
    }

    compatStatus.textContent = "Mode stable : export WebM forcé pour éviter les vidéos affichées à 3 secondes. Convertis ensuite en MP4 si CapCut refuse le WebM.";
    compatStatus.className = "status warning";
  };

  try {
    window.showCompatibilityStatus();
  } catch (error) {
    console.warn("Statut compatibilité non mis à jour", error);
  }
})();
