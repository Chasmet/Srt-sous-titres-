package com.chk.srtstudio;

import android.content.Context;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMuxer;
import android.net.Uri;

import java.io.File;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;

public final class AudioExtractor {

    private static final long MAX_CHUNK_US = 8L * 60L * 1_000_000L;
    private static final long FALLBACK_CHUNK_US = 5L * 60L * 1_000_000L;
    private static final long MIN_CHUNK_US = 60L * 1_000_000L;
    private static final long TARGET_BYTES = 18L * 1024L * 1024L;

    private AudioExtractor() {
    }

    public interface ProgressListener {
        void onProgress(int current, int total);
    }

    public static final class AudioChunk {
        public final File file;
        public final long offsetMs;

        AudioChunk(File file, long offsetMs) {
            this.file = file;
            this.offsetMs = offsetMs;
        }
    }

    public static List<AudioChunk> extract(
            Context context,
            Uri videoUri,
            File cacheDir,
            ProgressListener listener) throws Exception {

        MediaExtractor probe = new MediaExtractor();
        try {
            probe.setDataSource(context, videoUri, null);
            int audioTrack = findAudioTrack(probe);
            if (audioTrack < 0) throw new IllegalStateException("Aucune piste audio détectée.");

            MediaFormat audioFormat = probe.getTrackFormat(audioTrack);
            long durationUs = getDurationUs(audioFormat);
            if (durationUs <= 0) throw new IllegalStateException("Durée audio introuvable.");

            long chunkDurationUs = chooseChunkDurationUs(audioFormat);
            int total = Math.max(1, (int) Math.ceil(durationUs / (double) chunkDurationUs));

            List<AudioChunk> result = new ArrayList<>();
            int part = 0;

            for (long requestedStartUs = 0; requestedStartUs < durationUs; requestedStartUs += chunkDurationUs) {
                long requestedEndUs = Math.min(durationUs, requestedStartUs + chunkDurationUs);
                File out = new File(cacheDir, "srt-auto-audio-" + System.nanoTime() + "-" + part + ".m4a");

                AudioChunk chunk = remuxChunk(
                        context,
                        videoUri,
                        audioTrack,
                        audioFormat,
                        requestedStartUs,
                        requestedEndUs,
                        out);

                if (chunk != null && chunk.file.length() > 0) {
                    if (chunk.file.length() > 24L * 1024L * 1024L) {
                        chunk.file.delete();
                        throw new IllegalStateException("Un segment audio dépasse encore 24 Mo.");
                    }
                    result.add(chunk);
                }

                part++;
                if (listener != null) listener.onProgress(Math.min(part, total), total);
            }

            return result;
        } finally {
            probe.release();
        }
    }

    private static AudioChunk remuxChunk(
            Context context,
            Uri videoUri,
            int audioTrackIndex,
            MediaFormat audioFormat,
            long requestedStartUs,
            long requestedEndUs,
            File outputFile) throws Exception {

        MediaExtractor extractor = new MediaExtractor();
        MediaMuxer muxer = null;
        boolean muxerStarted = false;

        try {
            extractor.setDataSource(context, videoUri, null);
            extractor.selectTrack(audioTrackIndex);
            extractor.seekTo(requestedStartUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC);

            muxer = new MediaMuxer(
                    outputFile.getAbsolutePath(),
                    MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4);

            int destinationTrack = muxer.addTrack(audioFormat);
            muxer.start();
            muxerStarted = true;

            int maxInput = 1024 * 1024;
            if (audioFormat.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
                maxInput = Math.max(maxInput, audioFormat.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE));
            }
            maxInput = Math.min(maxInput, 4 * 1024 * 1024);

            ByteBuffer buffer = ByteBuffer.allocateDirect(maxInput);
            MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();

            long firstSourceTimeUs = -1L;
            int writtenSamples = 0;

            while (true) {
                int currentTrack = extractor.getSampleTrackIndex();
                if (currentTrack < 0) break;

                if (currentTrack != audioTrackIndex) {
                    extractor.advance();
                    continue;
                }

                long sampleTimeUs = extractor.getSampleTime();
                if (sampleTimeUs < 0) break;

                if (sampleTimeUs < requestedStartUs) {
                    extractor.advance();
                    continue;
                }

                if (sampleTimeUs >= requestedEndUs) break;

                buffer.clear();
                int size = extractor.readSampleData(buffer, 0);
                if (size < 0) break;

                if (firstSourceTimeUs < 0) firstSourceTimeUs = sampleTimeUs;

                info.offset = 0;
                info.size = size;
                info.presentationTimeUs = sampleTimeUs - firstSourceTimeUs;
                info.flags = extractor.getSampleFlags();

                buffer.position(0);
                buffer.limit(size);
                muxer.writeSampleData(destinationTrack, buffer, info);

                writtenSamples++;
                extractor.advance();
            }

            if (writtenSamples == 0 || firstSourceTimeUs < 0) {
                return null;
            }

            return new AudioChunk(outputFile, firstSourceTimeUs / 1000L);

        } finally {
            extractor.release();

            if (muxer != null) {
                try {
                    if (muxerStarted) muxer.stop();
                } catch (Exception ignored) {
                }
                try {
                    muxer.release();
                } catch (Exception ignored) {
                }
            }
        }
    }

    private static int findAudioTrack(MediaExtractor extractor) {
        for (int i = 0; i < extractor.getTrackCount(); i++) {
            MediaFormat format = extractor.getTrackFormat(i);
            String mime = format.getString(MediaFormat.KEY_MIME);
            if (mime != null && mime.startsWith("audio/")) return i;
        }
        return -1;
    }

    private static long getDurationUs(MediaFormat format) {
        if (format.containsKey(MediaFormat.KEY_DURATION)) {
            return format.getLong(MediaFormat.KEY_DURATION);
        }
        return -1L;
    }

    private static long chooseChunkDurationUs(MediaFormat format) {
        long selected = FALLBACK_CHUNK_US;

        if (format.containsKey(MediaFormat.KEY_BIT_RATE)) {
            int bitRate = format.getInteger(MediaFormat.KEY_BIT_RATE);
            if (bitRate > 0) {
                double safeSeconds = (TARGET_BYTES * 8d) / bitRate;
                selected = (long) (safeSeconds * 1_000_000d);
            }
        }

        selected = Math.max(MIN_CHUNK_US, selected);
        selected = Math.min(MAX_CHUNK_US, selected);
        return selected;
    }
}
