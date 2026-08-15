package com.chk.srtstudio;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {

    private static final String APP_URL = "https://chasmet.github.io/Srt-sous-titres-/?apk=2.0.0";
    private static final int FILE_CHOOSER_REQUEST = 4412;
    private static final String PREFS = "srt_studio_auto";
    private static final String PREF_WORKER = "worker_url";

    private WebView webView;
    private ProgressBar pageProgress;
    private ValueCallback<Uri[]> filePathCallback;
    private boolean chooserIsVideo;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private SharedPreferences preferences;
    private volatile int processingGeneration = 0;

    private final Object saveLock = new Object();
    private OutputStream pendingVideoOutput;
    private Uri pendingVideoUri;
    private Uri lastSavedVideoUri;

    @Override
    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        preferences = getSharedPreferences(PREFS, MODE_PRIVATE);

        webView = findViewById(R.id.webView);
        pageProgress = findViewById(R.id.pageProgress);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setLoadsImagesAutomatically(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportZoom(false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }

        webView.addJavascriptInterface(new NativeBridge(), "AndroidSrt");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                pageProgress.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageProgress.setVisibility(View.GONE);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> filePathCallbackParam,
                    FileChooserParams fileChooserParams) {

                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }

                filePathCallback = filePathCallbackParam;
                chooserIsVideo = acceptsVideo(fileChooserParams == null ? null : fileChooserParams.getAcceptTypes());

                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType(resolveMime(fileChooserParams == null ? null : fileChooserParams.getAcceptTypes()));

                try {
                    startActivityForResult(Intent.createChooser(intent,
                            chooserIsVideo ? "Choisir la vidéo" : "Choisir un fichier"), FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, "Sélecteur de fichiers indisponible.", Toast.LENGTH_LONG).show();
                    return false;
                }
            }
        });

        webView.loadUrl(APP_URL);
    }

    private static boolean acceptsVideo(String[] acceptTypes) {
        if (acceptTypes == null) return false;
        for (String value : acceptTypes) {
            if (value != null && value.toLowerCase().contains("video")) return true;
        }
        return false;
    }

    private static String resolveMime(String[] acceptTypes) {
        if (acceptTypes != null) {
            for (String value : acceptTypes) {
                if (value == null) continue;
                String lower = value.toLowerCase();
                if (lower.contains("video")) return "video/*";
                if (lower.contains("audio")) return "audio/*";
                if (lower.contains("image")) return "image/*";
            }
        }
        return "*/*";
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != FILE_CHOOSER_REQUEST) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }

        Uri selectedUri = null;
        if (resultCode == RESULT_OK && data != null) {
            selectedUri = data.getData();
        }

        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(selectedUri == null ? null : new Uri[]{selectedUri});
            filePathCallback = null;
        }

        if (selectedUri != null) {
            try {
                int flags = data == null ? 0 : data.getFlags();
                flags &= (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                getContentResolver().takePersistableUriPermission(selectedUri, flags);
            } catch (Exception ignored) {
            }
        }

        if (selectedUri != null && chooserIsVideo) {
            final Uri videoUri = selectedUri;
            webView.postDelayed(() -> requestWorkerAndProcess(videoUri), 650L);
        }

        chooserIsVideo = false;
    }

    private void requestWorkerAndProcess(Uri videoUri) {
        String javascript = "(function(){"
                + "var e=document.getElementById('workerUrl');"
                + "return e ? (e.value || localStorage.getItem('srt_app_worker_url') || '') : '';"
                + "})()";

        webView.evaluateJavascript(javascript, rawValue -> {
            String worker = decodeJavascriptString(rawValue);
            if (worker == null || worker.trim().isEmpty()) {
                worker = preferences.getString(PREF_WORKER, "");
            }

            if (worker == null || !worker.startsWith("https://")) {
                callJsError("Ajoute une seule fois ton lien Cloudflare Worker dans « SRT et API avancés », puis sauvegarde-le.");
                return;
            }

            preferences.edit().putString(PREF_WORKER, worker).apply();
            startAutomaticProcessing(videoUri, worker);
        });
    }

    private String decodeJavascriptString(String rawValue) {
        if (rawValue == null || "null".equals(rawValue) || "undefined".equals(rawValue)) return "";
        try {
            return new JSONArray("[" + rawValue + "]").getString(0);
        } catch (Exception ignored) {
            return rawValue.replaceAll("^\"|\"$", "");
        }
    }

    private void startAutomaticProcessing(Uri videoUri, String workerUrl) {
        final int generation = ++processingGeneration;

        executor.execute(() -> {
            List<AudioExtractor.AudioChunk> chunks = new ArrayList<>();
            try {
                callJsProgress("audio", "Analyse de la piste audio…", 7);

                chunks = AudioExtractor.extract(
                        MainActivity.this,
                        videoUri,
                        getCacheDir(),
                        (current, total) -> {
                            if (generation != processingGeneration) return;
                            int percent = 8 + Math.min(27, Math.round((current / (float) Math.max(1, total)) * 27f));
                            callJsProgress("audio",
                                    "Extraction audio " + current + "/" + total + "…",
                                    percent);
                        });

                if (generation != processingGeneration) return;
                if (chunks.isEmpty()) throw new IllegalStateException("Aucune piste audio détectée dans cette vidéo.");

                callJsProgress("srt", "Audio prêt. Génération du SRT…", 38);

                List<SrtMerger.TimedSrt> srtParts = new ArrayList<>();
                for (int i = 0; i < chunks.size(); i++) {
                    if (generation != processingGeneration) return;

                    AudioExtractor.AudioChunk chunk = chunks.get(i);
                    int percent = 40 + Math.round(((i + 0.4f) / chunks.size()) * 23f);
                    callJsProgress("srt",
                            "Transcription " + (i + 1) + "/" + chunks.size() + "…",
                            percent);

                    String srt = WorkerClient.transcribe(workerUrl, chunk.file, "fr");
                    srtParts.add(new SrtMerger.TimedSrt(srt, chunk.offsetMs));
                }

                if (generation != processingGeneration) return;

                callJsProgress("merge", "Assemblage et synchronisation du SRT…", 66);
                String mergedSrt = SrtMerger.merge(srtParts);

                if (mergedSrt.trim().isEmpty()) {
                    throw new IllegalStateException("Le SRT généré est vide.");
                }

                callJsSrtReady(mergedSrt);

            } catch (Exception e) {
                callJsError(humanizeError(e));
            } finally {
                for (AudioExtractor.AudioChunk chunk : chunks) {
                    if (chunk != null && chunk.file != null) {
                        chunk.file.delete();
                    }
                }
            }
        });
    }

    private String humanizeError(Exception e) {
        String message = e.getMessage();
        if (message == null || message.trim().isEmpty()) return "Erreur inconnue pendant le traitement automatique.";
        if (message.contains("413") || message.toLowerCase().contains("too large")) {
            return "Le fichier audio reste trop lourd pour l’API. Réessaie avec une vidéo plus courte.";
        }
        if (message.toLowerCase().contains("no audio") || message.toLowerCase().contains("aucune piste")) {
            return "Aucune piste audio exploitable n’a été trouvée dans cette vidéo.";
        }
        return message;
    }

    private void callJsProgress(String stage, String message, int percent) {
        runOnUiThread(() -> webView.evaluateJavascript(
                "window.onNativeAutoProgress && window.onNativeAutoProgress("
                        + JSONObject.quote(stage) + ","
                        + JSONObject.quote(message) + ","
                        + percent + ");",
                null));
    }

    private void callJsError(String message) {
        runOnUiThread(() -> webView.evaluateJavascript(
                "window.onNativeAutoError && window.onNativeAutoError(" + JSONObject.quote(message) + ");",
                null));
    }

    private void callJsSrtReady(String srt) {
        runOnUiThread(() -> webView.evaluateJavascript(
                "window.onNativeSrtReady && window.onNativeSrtReady(" + JSONObject.quote(srt) + ");",
                null));
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        processingGeneration++;
        executor.shutdownNow();
        closePendingSave(true);

        if (webView != null) {
            webView.removeJavascriptInterface("AndroidSrt");
            webView.destroy();
        }
        super.onDestroy();
    }

    public final class NativeBridge {

        @JavascriptInterface
        public String getVersion() {
            return "2.0";
        }

        @JavascriptInterface
        public void rememberWorker(String url) {
            if (url != null && url.startsWith("https://")) {
                preferences.edit().putString(PREF_WORKER, url.trim()).apply();
            }
        }

        @JavascriptInterface
        public boolean beginVideoSave(String fileName, String mimeType) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false;

            synchronized (saveLock) {
                closePendingSave(true);
                try {
                    String safeName = sanitizeFileName(fileName);
                    if (!safeName.toLowerCase().endsWith(".mp4") && !safeName.toLowerCase().endsWith(".webm")) {
                        safeName += ".mp4";
                    }

                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, safeName);
                    values.put(MediaStore.MediaColumns.MIME_TYPE,
                            mimeType == null || mimeType.trim().isEmpty() ? "video/mp4" : mimeType);
                    values.put(MediaStore.MediaColumns.RELATIVE_PATH,
                            Environment.DIRECTORY_MOVIES + "/SRT Studio");
                    values.put(MediaStore.MediaColumns.IS_PENDING, 1);

                    pendingVideoUri = getContentResolver().insert(
                            MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values);

                    if (pendingVideoUri == null) return false;

                    pendingVideoOutput = getContentResolver().openOutputStream(pendingVideoUri, "w");
                    if (pendingVideoOutput == null) {
                        getContentResolver().delete(pendingVideoUri, null, null);
                        pendingVideoUri = null;
                        return false;
                    }

                    return true;
                } catch (Exception e) {
                    closePendingSave(true);
                    return false;
                }
            }
        }

        @JavascriptInterface
        public boolean appendVideoChunk(String base64Chunk) {
            synchronized (saveLock) {
                if (pendingVideoOutput == null || base64Chunk == null) return false;
                try {
                    byte[] data = Base64.decode(base64Chunk, Base64.DEFAULT);
                    pendingVideoOutput.write(data);
                    return true;
                } catch (Exception e) {
                    closePendingSave(true);
                    return false;
                }
            }
        }

        @JavascriptInterface
        public String finishVideoSave() {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return "";

            synchronized (saveLock) {
                if (pendingVideoOutput == null || pendingVideoUri == null) return "";

                try {
                    pendingVideoOutput.flush();
                    pendingVideoOutput.close();
                    pendingVideoOutput = null;

                    ContentValues values = new ContentValues();
                    values.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    getContentResolver().update(pendingVideoUri, values, null, null);

                    lastSavedVideoUri = pendingVideoUri;
                    String result = pendingVideoUri.toString();
                    pendingVideoUri = null;

                    runOnUiThread(() ->
                            Toast.makeText(MainActivity.this,
                                    "Vidéo enregistrée dans Movies/SRT Studio",
                                    Toast.LENGTH_LONG).show());

                    return result;
                } catch (Exception e) {
                    closePendingSave(true);
                    return "";
                }
            }
        }

        @JavascriptInterface
        public void cancelVideoSave() {
            synchronized (saveLock) {
                closePendingSave(true);
            }
        }

        @JavascriptInterface
        public void shareLastVideo() {
            final Uri uri = lastSavedVideoUri;
            if (uri == null) {
                runOnUiThread(() ->
                        Toast.makeText(MainActivity.this,
                                "Enregistre d’abord la vidéo.",
                                Toast.LENGTH_SHORT).show());
                return;
            }

            runOnUiThread(() -> {
                Intent share = new Intent(Intent.ACTION_SEND);
                share.setType("video/*");
                share.putExtra(Intent.EXTRA_STREAM, uri);
                share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                startActivity(Intent.createChooser(share, "Partager la vidéo"));
            });
        }
    }

    private void closePendingSave(boolean deleteUri) {
        synchronized (saveLock) {
            try {
                if (pendingVideoOutput != null) pendingVideoOutput.close();
            } catch (Exception ignored) {
            }
            pendingVideoOutput = null;

            if (deleteUri && pendingVideoUri != null) {
                try {
                    getContentResolver().delete(pendingVideoUri, null, null);
                } catch (Exception ignored) {
                }
            }
            pendingVideoUri = null;
        }
    }

    private String sanitizeFileName(String name) {
        String value = name == null || name.trim().isEmpty() ? "video-sous-titree.mp4" : name.trim();
        return value.replaceAll("[\\\\/:*?\"<>|]", "_");
    }
}
