package app.backontrack.android;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.audiofx.LoudnessEnhancer;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Plays synthesized speech through an app-owned audio session so loudness enhancement remains
 * scoped to this app while transient audio focus handles the surrounding media mix.
 */
final class TtsVolumeBoost {

    static final class SpeechRange {
        final int start;
        final int end;
        final int offsetMs;

        SpeechRange(int start, int end, int offsetMs) {
            this.start = start;
            this.end = end;
            this.offsetMs = offsetMs;
        }
    }

    interface PlaybackListener {
        default void onPrepare(String utteranceId, int durationMs, List<SpeechRange> speechRanges) {}
        void onStart(String utteranceId, int durationMs, List<SpeechRange> speechRanges);
        void onDone(String utteranceId);
    }

    // LoudnessEnhancer uses millibels. +13.98 dB is approximately five times the linear amplitude.
    static final int AMPLIFICATION_GAIN_MILLIBELS = 1398;

    private final Context context;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private String activeUtteranceId = "";
    private boolean amplificationEnabled;
    private int playbackStartLeadMs;
    private File synthesizedAudio;
    private List<SpeechRange> synthesizedSpeechRanges = Collections.emptyList();
    private MediaPlayer mediaPlayer;
    private LoudnessEnhancer loudnessEnhancer;
    private TransientAudioFocus.Lease audioFocusLease;
    private PlaybackListener playbackListener;

    TtsVolumeBoost(Context context) {
        this.context = context.getApplicationContext();
    }

    synchronized int speak(
        TextToSpeech speech,
        String text,
        String utteranceId,
        boolean amplified
    ) {
        speech.stop();
        clearPlayback();

        try {
            synthesizedAudio = File.createTempFile("backontrack-tts-", ".wav", context.getCacheDir());
        } catch (IOException error) {
            return TextToSpeech.ERROR;
        }

        activeUtteranceId = utteranceId;
        amplificationEnabled = amplified;
        int result = speech.synthesizeToFile(text, null, synthesizedAudio, utteranceId);
        if (result == TextToSpeech.ERROR) finish(utteranceId);
        return result;
    }

    synchronized void playSynthesized(String utteranceId, List<SpeechRange> speechRanges) {
        if (!activeUtteranceId.equals(utteranceId) || synthesizedAudio == null) return;
        synthesizedSpeechRanges = new ArrayList<>(speechRanges);
        File audio = synthesizedAudio;
        mainHandler.post(() -> preparePlayback(utteranceId, audio));
    }

    synchronized void playSynthesized(String utteranceId) {
        playSynthesized(utteranceId, Collections.emptyList());
    }

    synchronized void setEnabled(boolean enabled) {
        amplificationEnabled = enabled;
        if (mediaPlayer == null) return;
        if (enabled) attachLoudnessEnhancer();
        else releaseLoudnessEnhancer();
    }

    synchronized void setPlaybackStartLeadMs(int leadMs) {
        playbackStartLeadMs = Math.max(0, leadMs);
    }

    synchronized int playbackStartLeadMs() {
        return playbackStartLeadMs;
    }

    synchronized void setPlaybackListener(PlaybackListener listener) {
        playbackListener = listener;
    }

    synchronized void finish(String utteranceId) {
        if (!activeUtteranceId.equals(utteranceId)) return;
        clearPlayback();
    }

    synchronized void stop() {
        clearPlayback();
    }

    synchronized boolean isActive() {
        return !activeUtteranceId.isEmpty();
    }

    synchronized int remainingMs() {
        if (!isActive()) return 0;
        try {
            if (mediaPlayer != null) return Math.max(1, mediaPlayer.getDuration() - mediaPlayer.getCurrentPosition());
        } catch (RuntimeException ignored) {
            // Audio is still being prepared; keep visual progress moving.
        }
        return 1000;
    }

    static double linearAmplitudeMultiplier(int gainMillibels) {
        return Math.pow(10d, gainMillibels / 2000d);
    }

    private synchronized void preparePlayback(String utteranceId, File audio) {
        if (!activeUtteranceId.equals(utteranceId) || synthesizedAudio != audio) return;

        MediaPlayer nextPlayer = new MediaPlayer();
        mediaPlayer = nextPlayer;
        try {
            nextPlayer.setAudioAttributes(speechAudioAttributes());
            nextPlayer.setDataSource(audio.getAbsolutePath());
            nextPlayer.setVolume(1f, 1f);
            nextPlayer.setOnPreparedListener(player -> startPreparedPlayback(utteranceId, player));
            nextPlayer.setOnCompletionListener(player -> finishPlayback(utteranceId, player));
            nextPlayer.setOnErrorListener((player, what, extra) -> {
                finishPlayback(utteranceId, player);
                return true;
            });
            nextPlayer.prepareAsync();
        } catch (IOException | RuntimeException error) {
            finish(utteranceId);
        }
    }

    private synchronized void startPreparedPlayback(String utteranceId, MediaPlayer player) {
        if (!activeUtteranceId.equals(utteranceId) || mediaPlayer != player) {
            releasePlayer(player);
            return;
        }
        int durationMs = Math.max(0, player.getDuration());
        if (playbackListener != null) {
            playbackListener.onPrepare(
                utteranceId,
                durationMs,
                new ArrayList<>(synthesizedSpeechRanges)
            );
        }
        if (playbackStartLeadMs > 0) {
            mainHandler.postDelayed(
                () -> startPreparedAudio(utteranceId, player, durationMs),
                playbackStartLeadMs
            );
            return;
        }
        startPreparedAudio(utteranceId, player, durationMs);
    }

    private synchronized void startPreparedAudio(
        String utteranceId,
        MediaPlayer player,
        int durationMs
    ) {
        if (!activeUtteranceId.equals(utteranceId) || mediaPlayer != player) return;
        if (amplificationEnabled) attachLoudnessEnhancer();
        audioFocusLease = TransientAudioFocus.acquire(context, speechAudioAttributes());
        try {
            player.start();
            if (playbackListener != null) {
                playbackListener.onStart(
                    utteranceId,
                    durationMs,
                    new ArrayList<>(synthesizedSpeechRanges)
                );
            }
        } catch (RuntimeException error) {
            finish(utteranceId);
        }
    }

    private synchronized void finishPlayback(String utteranceId, MediaPlayer player) {
        if (!activeUtteranceId.equals(utteranceId) || mediaPlayer != player) {
            releasePlayer(player);
            return;
        }
        clearPlayback();
    }

    private void attachLoudnessEnhancer() {
        if (mediaPlayer == null || loudnessEnhancer != null) return;
        try {
            loudnessEnhancer = new LoudnessEnhancer(mediaPlayer.getAudioSessionId());
            loudnessEnhancer.setTargetGain(AMPLIFICATION_GAIN_MILLIBELS);
            loudnessEnhancer.setEnabled(true);
        } catch (RuntimeException error) {
            releaseLoudnessEnhancer();
        }
    }

    private static AudioAttributes speechAudioAttributes() {
        return new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();
    }

    private void clearPlayback() {
        String finishedUtteranceId = activeUtteranceId;
        activeUtteranceId = "";
        synthesizedSpeechRanges = Collections.emptyList();
        mainHandler.removeCallbacksAndMessages(null);
        releaseLoudnessEnhancer();
        if (mediaPlayer != null) {
            MediaPlayer currentPlayer = mediaPlayer;
            mediaPlayer = null;
            releasePlayer(currentPlayer);
        }
        if (audioFocusLease != null) {
            audioFocusLease.release();
            audioFocusLease = null;
        }
        if (synthesizedAudio != null) {
            //noinspection ResultOfMethodCallIgnored
            synthesizedAudio.delete();
            synthesizedAudio = null;
        }
        if (!finishedUtteranceId.isEmpty() && playbackListener != null) {
            playbackListener.onDone(finishedUtteranceId);
        }
    }

    private void releaseLoudnessEnhancer() {
        if (loudnessEnhancer == null) return;
        try {
            loudnessEnhancer.setEnabled(false);
            loudnessEnhancer.release();
        } catch (RuntimeException ignored) {
            // The audio framework also releases the effect when its app-owned session ends.
        } finally {
            loudnessEnhancer = null;
        }
    }

    private void releasePlayer(MediaPlayer player) {
        try {
            player.setOnPreparedListener(null);
            player.setOnCompletionListener(null);
            player.setOnErrorListener(null);
            player.release();
        } catch (RuntimeException ignored) {
            // Releasing an already-ended player is safe to ignore.
        }
    }
}
