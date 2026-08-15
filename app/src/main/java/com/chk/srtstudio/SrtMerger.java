package com.chk.srtstudio;

import java.util.ArrayList;
import java.util.List;

public final class SrtMerger {

    private SrtMerger() {
    }

    public static final class TimedSrt {
        public final String srt;
        public final long offsetMs;

        public TimedSrt(String srt, long offsetMs) {
            this.srt = srt == null ? "" : srt;
            this.offsetMs = Math.max(0L, offsetMs);
        }
    }

    public static String merge(List<TimedSrt> parts) {
        StringBuilder output = new StringBuilder();
        int index = 1;

        if (parts == null) return "";

        for (TimedSrt part : parts) {
            if (part == null || part.srt.trim().isEmpty()) continue;

            String normalized = part.srt
                    .replace("\r\n", "\n")
                    .replace('\r', '\n')
                    .trim();

            String[] blocks = normalized.split("\\n\\s*\\n");

            for (String block : blocks) {
                Cue cue = parseBlock(block);
                if (cue == null || cue.text.isEmpty()) continue;

                long start = Math.max(0L, cue.startMs + part.offsetMs);
                long end = Math.max(start + 1L, cue.endMs + part.offsetMs);

                output.append(index++).append('\n')
                        .append(formatTime(start))
                        .append(" --> ")
                        .append(formatTime(end))
                        .append('\n')
                        .append(cue.text.trim())
                        .append("\n\n");
            }
        }

        return output.toString().trim();
    }

    private static Cue parseBlock(String block) {
        if (block == null) return null;

        String[] lines = block.trim().split("\\n");
        int timeLine = -1;

        for (int i = 0; i < lines.length; i++) {
            if (lines[i].contains("-->")) {
                timeLine = i;
                break;
            }
        }

        if (timeLine < 0) return null;

        String[] times = lines[timeLine].split("-->");
        if (times.length != 2) return null;

        long start = parseTime(times[0].trim());
        long end = parseTime(times[1].trim());
        if (start < 0 || end < 0) return null;

        List<String> textLines = new ArrayList<>();
        for (int i = timeLine + 1; i < lines.length; i++) {
            String value = lines[i].trim();
            if (!value.isEmpty()) textLines.add(value);
        }

        return new Cue(start, end, joinLines(textLines));
    }

    private static String joinLines(List<String> lines) {
        StringBuilder out = new StringBuilder();
        for (String line : lines) {
            if (out.length() > 0) out.append('\n');
            out.append(line);
        }
        return out.toString();
    }

    private static long parseTime(String value) {
        try {
            String clean = value.replace('.', ',');
            String[] main = clean.split(",");
            String[] hms = main[0].split(":");
            if (hms.length != 3) return -1L;

            long hours = Long.parseLong(hms[0].trim());
            long minutes = Long.parseLong(hms[1].trim());
            long seconds = Long.parseLong(hms[2].trim());

            String millisText = main.length > 1 ? main[1].trim() : "0";
            while (millisText.length() < 3) millisText += "0";
            if (millisText.length() > 3) millisText = millisText.substring(0, 3);
            long millis = Long.parseLong(millisText);

            return hours * 3_600_000L
                    + minutes * 60_000L
                    + seconds * 1_000L
                    + millis;
        } catch (Exception ignored) {
            return -1L;
        }
    }

    private static String formatTime(long millis) {
        long totalSeconds = millis / 1000L;
        long ms = millis % 1000L;
        long seconds = totalSeconds % 60L;
        long totalMinutes = totalSeconds / 60L;
        long minutes = totalMinutes % 60L;
        long hours = totalMinutes / 60L;

        return String.format("%02d:%02d:%02d,%03d", hours, minutes, seconds, ms);
    }

    private static final class Cue {
        final long startMs;
        final long endMs;
        final String text;

        Cue(long startMs, long endMs, String text) {
            this.startMs = startMs;
            this.endMs = endMs;
            this.text = text == null ? "" : text;
        }
    }
}
