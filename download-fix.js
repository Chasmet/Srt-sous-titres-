(() => {
  const VIDEO_NAME = "video-sous-titree.webm";

  window.addEventListener("load", () => {
    const classicLink = document.getElementById("downloadVideoLink");
    const statusBox = document.getElementById("status");

    if (!classicLink || document.getElementById("forceDownloadVideoBtn")) return;

    const box = document.createElement("div");
    box.className = "actions";
    box.style.marginTop = "12px";

    const forceBtn = document.createElement("button");
    forceBtn.id = "forceDownloadVideoBtn";
    forceBtn.className = "btn secondary";
    forceBtn.type = "button";
    forceBtn.textContent = "Télécharger la vidéo maintenant";
    forceBtn.style.display = "none";

    const shareBtn = document.createElement("button");
    shareBtn.id = "shareVideoBtn";
    shareBtn.className = "btn secondary";
    shareBtn.type = "button";
    shareBtn.textContent = "Partager / enregistrer la vidéo";
    shareBtn.style.display = "none";

    const openLink = document.createElement("a");
    openLink.id = "openVideoLink";
    openLink.className = "downloadLink";
    openLink.textContent = "Ouvrir la vidéo finale";
    openLink.target = "_blank";
    openLink.rel = "noopener";
    openLink.style.display = "none";

    box.appendChild(forceBtn);
    box.appendChild(shareBtn);
    box.appendChild(openLink);
    classicLink.insertAdjacentElement("afterend", box);

    const setStatus = (message, type = "success") => {
      if (!statusBox) return;
      statusBox.textContent = message;
      statusBox.className = "status";
      statusBox.classList.add(type);
    };

    const getVideoUrl = () => {
      const href = classicLink.getAttribute("href") || "";
      if (!href || href === "#") return "";
      return href;
    };

    const refreshButtons = () => {
      const url = getVideoUrl();
      const ready = Boolean(url);
      forceBtn.style.display = ready ? "block" : "none";
      shareBtn.style.display = ready && navigator.share ? "block" : "none";
      openLink.style.display = ready ? "block" : "none";
      if (ready) {
        openLink.href = url;
        classicLink.textContent = "Télécharger la vidéo sous-titrée - méthode classique";
      }
    };

    const forceDownload = () => {
      const url = getVideoUrl();
      if (!url) {
        setStatus("La vidéo finale n’est pas encore prête.", "error");
        return;
      }

      const a = document.createElement("a");
      a.href = url;
      a.download = VIDEO_NAME;
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setStatus("Téléchargement lancé. Si rien ne se passe, utilise Ouvrir la vidéo finale puis le menu ⋮ > Télécharger.", "success");
    };

    const shareVideo = async () => {
      const url = getVideoUrl();
      if (!url) {
        setStatus("La vidéo finale n’est pas encore prête.", "error");
        return;
      }

      try {
        setStatus("Préparation du partage de la vidéo...", "loading");
        const response = await fetch(url);
        const blob = await response.blob();
        const file = new File([blob], VIDEO_NAME, { type: blob.type || "video/webm" });

        if (navigator.canShare && !navigator.canShare({ files: [file] })) {
          setStatus("Le partage fichier n’est pas disponible sur ce navigateur. Utilise Télécharger maintenant.", "error");
          return;
        }

        await navigator.share({
          files: [file],
          title: "Vidéo sous-titrée",
          text: "Vidéo sous-titrée générée"
        });
        setStatus("Partage ouvert. Tu peux enregistrer la vidéo depuis le menu proposé.", "success");
      } catch (error) {
        console.error(error);
        setStatus("Partage impossible. Utilise Télécharger maintenant ou Ouvrir la vidéo finale.", "error");
      }
    };

    forceBtn.addEventListener("click", forceDownload);
    shareBtn.addEventListener("click", shareVideo);

    classicLink.addEventListener("click", () => {
      setTimeout(() => {
        setStatus("Si le téléchargement ne démarre pas, utilise le bouton Télécharger la vidéo maintenant.", "success");
      }, 300);
    });

    const observer = new MutationObserver(refreshButtons);
    observer.observe(classicLink, {
      attributes: true,
      attributeFilter: ["href", "class"]
    });

    setInterval(refreshButtons, 1500);
    refreshButtons();
  });
})();
