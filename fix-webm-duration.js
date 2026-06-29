/* Fallback local : évite que l’application plante si la librairie externe de durée WebM est bloquée. */
(function () {
  if (typeof window === "undefined") return;
  if (typeof window.fixWebmDuration === "function") return;

  window.fixWebmDuration = async function fixWebmDurationLocalFallback(blob) {
    try {
      if (!blob || !(blob instanceof Blob)) return blob;
      return blob;
    } catch (error) {
      console.warn("Fallback durée WebM : retour au fichier original", error);
      return blob;
    }
  };
})();
