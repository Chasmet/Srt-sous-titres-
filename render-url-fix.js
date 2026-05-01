(() => {
  const RENDER_URL = "https://srt-sous-titres.onrender.com";
  localStorage.setItem("srt_app_render_url", RENDER_URL);
  window.addEventListener("load", () => {
    const input = document.getElementById("renderUrl");
    if (input) input.value = RENDER_URL;
  });
})();
