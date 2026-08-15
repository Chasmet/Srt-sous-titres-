package com.chk.srtstudio;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

public final class WorkerClient {

    private WorkerClient() {
    }

    public static String transcribe(String workerUrl, File audioFile, String language) throws Exception {
        if (workerUrl == null || !workerUrl.startsWith("https://")) {
            throw new IllegalArgumentException("Lien Worker HTTPS invalide.");
        }
        if (audioFile == null || !audioFile.isFile() || audioFile.length() == 0) {
            throw new IllegalArgumentException("Segment audio invalide.");
        }

        String boundary = "----SRTStudioAuto" + UUID.randomUUID().toString().replace("-", "");
        HttpURLConnection connection = (HttpURLConnection) new URL(workerUrl).openConnection();

        connection.setRequestMethod("POST");
        connection.setConnectTimeout(30_000);
        connection.setReadTimeout(10 * 60_000);
        connection.setDoOutput(true);
        connection.setUseCaches(false);
        connection.setChunkedStreamingMode(64 * 1024);
        connection.setRequestProperty("Accept", "text/plain");
        connection.setRequestProperty("User-Agent", "SRT-Studio-Auto/2.0 Android");
        connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);

        try {
            OutputStream raw = connection.getOutputStream();
            BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(raw, StandardCharsets.UTF_8));

            writer.write("--" + boundary + "\r\n");
            writer.write("Content-Disposition: form-data; name=\"language\"\r\n\r\n");
            writer.write(language == null || language.trim().isEmpty() ? "fr" : language.trim());
            writer.write("\r\n");

            writer.write("--" + boundary + "\r\n");
            writer.write("Content-Disposition: form-data; name=\"file\"; filename=\"audio.m4a\"\r\n");
            writer.write("Content-Type: audio/mp4\r\n\r\n");
            writer.flush();

            try (BufferedInputStream input = new BufferedInputStream(new FileInputStream(audioFile))) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    raw.write(buffer, 0, read);
                }
            }

            raw.flush();
            writer.write("\r\n--" + boundary + "--\r\n");
            writer.flush();
            writer.close();

            int status = connection.getResponseCode();
            InputStream responseStream = status >= 200 && status < 300
                    ? connection.getInputStream()
                    : connection.getErrorStream();

            String response = readAll(responseStream);

            if (status < 200 || status >= 300) {
                String shortResponse = response == null ? "" : response.trim();
                if (shortResponse.length() > 350) shortResponse = shortResponse.substring(0, 350);
                throw new IllegalStateException("Erreur Worker " + status
                        + (shortResponse.isEmpty() ? "" : " : " + shortResponse));
            }

            if (response == null || response.trim().isEmpty()) {
                throw new IllegalStateException("Le Worker a renvoyé une réponse vide.");
            }

            return response.replace("\uFEFF", "").trim();

        } finally {
            connection.disconnect();
        }
    }

    private static String readAll(InputStream stream) throws Exception {
        if (stream == null) return "";

        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                result.append(line).append('\n');
            }
        }
        return result.toString();
    }
}
