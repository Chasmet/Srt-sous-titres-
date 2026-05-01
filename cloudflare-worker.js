export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Méthode non autorisée", {
        status: 405,
        headers: corsHeaders
      });
    }

    if (!env.OPENAI_API_KEY) {
      return new Response("Secret OPENAI_API_KEY manquant dans Cloudflare", {
        status: 500,
        headers: corsHeaders
      });
    }

    try {
      const incomingForm = await request.formData();
      const file = incomingForm.get("file");
      const language = incomingForm.get("language") || "fr";

      if (!file) {
        return new Response("Fichier audio manquant", {
          status: 400,
          headers: corsHeaders
        });
      }

      const openAiForm = new FormData();
      openAiForm.append("file", file, file.name || "audio.mp3");
      openAiForm.append("model", "whisper-1");
      openAiForm.append("response_format", "srt");
      openAiForm.append("language", language);

      const openAiResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENAI_API_KEY}`
        },
        body: openAiForm
      });

      const resultText = await openAiResponse.text();

      return new Response(resultText, {
        status: openAiResponse.status,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/plain; charset=utf-8"
        }
      });
    } catch (error) {
      return new Response("Erreur Worker : " + error.message, {
        status: 500,
        headers: corsHeaders
      });
    }
  }
};
