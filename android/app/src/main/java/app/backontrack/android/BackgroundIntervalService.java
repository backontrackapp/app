package app.backontrack.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class BackgroundIntervalService extends Service {

    public static final String ACTION_START = "app.backontrack.android.interval.START";
    public static final String ACTION_STOP = "app.backontrack.android.interval.STOP";
    public static final String EXTRA_SESSION_ID = "sessionId";
    public static final String EXTRA_SESSION_NAME = "sessionName";
    public static final String EXTRA_STEPS = "steps";
    public static final String EXTRA_STEP_INDEX = "stepIndex";
    public static final String EXTRA_REMAINING_MS = "remainingMs";
    public static final String EXTRA_ELAPSED_MS = "elapsedMs";
    public static final String EXTRA_STEP_ELAPSED_MS = "stepElapsedMs";
    public static final String EXTRA_SOUND_ENABLED = "soundEnabled";
    public static final String EXTRA_VIBRATION_ENABLED = "vibrationEnabled";
    public static final String EXTRA_FLASHCARD_REVIEW = "flashcardReview";

    private static final String CHANNEL_ID = "backontrack_interval_timer";
    private static final int NOTIFICATION_ID = 4107;
    private static final long TICK_MS = 250L;
    static final long REVIEW_EDGE_PAUSE_MS = 4_000L;
    private static volatile BackgroundIntervalService activeInstance;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<IntervalStep> steps = new ArrayList<>();
    private final List<ReviewCard> reviewCards = new ArrayList<>();
    private PowerManager.WakeLock wakeLock;
    private TextToSpeech speech;
    private TextToSpeech intervalSpeech;
    private TtsVolumeBoost volumeBoost;
    private FlashcardRecordingPlayer recordingPlayer;
    private ReviewSetAudioFocus reviewSetAudioFocus;
    private boolean speechReady;
    private boolean intervalSpeechReady;
    private String pendingIntervalStepName = "";
    private String sessionId = "";
    private String sessionName = "Interval";
    private int stepIndex;
    private int lastCountdownSecond = -1;
    private long deadlineElapsedMs;
    private long stopwatchBaseElapsedMs;
    private long stopwatchStartedElapsedMs;
    private boolean soundEnabled;
    private boolean vibrationEnabled;
    private boolean running;
    private long reviewBaseElapsedMs;
    private long reviewConfiguredWindowElapsedMs;
    private long reviewFrontDurationMs = 5000L;
    private long reviewBaseBackDurationMs = 5000L;
    private int reviewBackSpeechRepeatCount = 1;
    private String reviewCardSides = "both";
    private boolean reviewInvertFaces;
    private String reviewFrontDisplay = "front";
    private String reviewBackDisplay = "back";
    private String reviewFrontLanguage = "";
    private String reviewBackLanguage = "";
    private String lastReviewSpeechKey = "";
    private String pendingReviewSpeechText = "";
    private String pendingReviewSpeechLanguage = "";
    private String pendingReviewRecordingUrl = "";
    private float pendingReviewSpeechRate = 1.0f;
    private boolean reviewSpeechOverAmplified;
    private float reviewBackSpeechRate = 1.0f;
    private boolean appWasVisible;

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            if (!running) return;
            long now = SystemClock.elapsedRealtime();
            playCountdown(now);
            advance(now);
            if (!running) return;
            updateReviewSpeech(now);
            updateNotification(false);
            if (steps.get(stepIndex).requiresConfirmation) {
                releaseWakeLock();
                return;
            }
            if (steps.get(stepIndex).stopwatch) {
                releaseWakeLock();
                handler.postDelayed(this, 1000L);
                return;
            }
            handler.postDelayed(this, TICK_MS);
        }
    };

    public static final class IntervalStep {
        final String name;
        final long durationMs;
        final boolean stopwatch;
        final boolean requiresConfirmation;
        final boolean flashcardReviewEnabled;
        final String cueSound;

        IntervalStep(
            String name,
            long durationMs,
            boolean stopwatch,
            boolean requiresConfirmation,
            boolean flashcardReviewEnabled,
            String cueSound
        ) {
            this.name = name;
            this.durationMs = durationMs;
            this.stopwatch = stopwatch;
            this.requiresConfirmation = requiresConfirmation;
            this.flashcardReviewEnabled = flashcardReviewEnabled;
            this.cueSound = cueSound;
        }
    }

    private static final class ReviewCard {
        final String front;
        final String back;
        final String ttsFront;
        final String ttsBack;
        final String transliteration;
        final String note;
        final String frontAudio;
        final String backAudio;

        ReviewCard(
            String front,
            String back,
            String ttsFront,
            String ttsBack,
            String transliteration,
            String note,
            String frontAudio,
            String backAudio
        ) {
            this.front = front;
            this.back = back;
            this.ttsFront = ttsFront;
            this.ttsBack = ttsBack;
            this.transliteration = transliteration;
            this.note = note;
            this.frontAudio = frontAudio;
            this.backAudio = backAudio;
        }
    }

    private static final class ReviewPhase {
        final int cardIndex;
        final String side;
        final String key;

        ReviewPhase(int cardIndex, String side, String key) {
            this.cardIndex = cardIndex;
            this.side = side;
            this.key = key;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        activeInstance = this;
        createNotificationChannel();
        reviewSetAudioFocus = new ReviewSetAudioFocus(this);
        volumeBoost = new TtsVolumeBoost(this);
        recordingPlayer = new FlashcardRecordingPlayer(this);
        speech = new TextToSpeech(this, status -> {
            speechReady = status == TextToSpeech.SUCCESS;
            TextToSpeech currentSpeech = speech;
            if (speechReady && currentSpeech != null) {
                currentSpeech.setAudioAttributes(ReviewSetAudioFocus.speechAudioAttributes());
                currentSpeech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override
                    public void onStart(String utteranceId) {}

                    @Override
                    public void onDone(String utteranceId) {
                        volumeBoost.playSynthesized(utteranceId);
                    }

                    @Override
                    public void onError(String utteranceId) {
                        volumeBoost.finish(utteranceId);
                    }

                    @Override
                    public void onStop(String utteranceId, boolean interrupted) {
                        volumeBoost.finish(utteranceId);
                    }
                });
                speakPendingReviewSide();
            }
        });
        intervalSpeech = new TextToSpeech(this, status -> {
            intervalSpeechReady = status == TextToSpeech.SUCCESS;
            TextToSpeech currentSpeech = intervalSpeech;
            if (intervalSpeechReady && currentSpeech != null) {
                currentSpeech.setAudioAttributes(ReviewSetAudioFocus.speechAudioAttributes());
                speakPendingIntervalStepName();
            }
        });
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;
        if (ACTION_STOP.equals(intent.getAction())) {
            stopTimer();
            return START_NOT_STICKY;
        }
        if (!ACTION_START.equals(intent.getAction())) return START_NOT_STICKY;

        try {
            configure(intent);
            startAsForeground();
            if (steps.get(stepIndex).requiresConfirmation) {
                releaseWakeLock();
            } else {
                acquireWakeLock();
            }
            running = true;
            updateReviewStepAudioFocus();
            handler.removeCallbacks(ticker);
            handler.post(ticker);
        } catch (JSONException | IllegalArgumentException error) {
            stopTimer();
        }
        return START_NOT_STICKY;
    }

    private void configure(Intent intent) throws JSONException {
        String previousSessionId = sessionId;
        JSONArray encodedSteps = new JSONArray(intent.getStringExtra(EXTRA_STEPS));
        steps.clear();
        for (int index = 0; index < encodedSteps.length(); index += 1) {
            JSONObject encoded = encodedSteps.getJSONObject(index);
            steps.add(new IntervalStep(
                encoded.optString("name", "Interval " + (index + 1)),
                Math.max(1L, encoded.optLong("durationMs", 1L)),
                encoded.optBoolean("stopwatch", false),
                encoded.optBoolean("requiresConfirmation", false),
                encoded.optBoolean("flashcardReviewEnabled", true),
                encoded.optString("cueSound", "go")
            ));
        }
        if (steps.isEmpty()) throw new IllegalArgumentException("Interval sequence is empty.");

        sessionId = intent.getStringExtra(EXTRA_SESSION_ID);
        if (sessionId == null || sessionId.trim().isEmpty()) {
            throw new IllegalArgumentException("An interval session ID is required.");
        }
        sessionId = sessionId.trim();
        sessionName = intent.getStringExtra(EXTRA_SESSION_NAME);
        if (sessionName == null || sessionName.trim().isEmpty()) sessionName = "Interval";
        stepIndex = Math.max(0, Math.min(intent.getIntExtra(EXTRA_STEP_INDEX, 0), steps.size() - 1));
        long remainingMs = Math.max(1L, intent.getLongExtra(EXTRA_REMAINING_MS, steps.get(stepIndex).durationMs));
        long configuredElapsedMs = SystemClock.elapsedRealtime();
        deadlineElapsedMs = configuredElapsedMs + remainingMs;
        stopwatchBaseElapsedMs = Math.max(0L, intent.getLongExtra(EXTRA_STEP_ELAPSED_MS, 0L));
        stopwatchStartedElapsedMs = configuredElapsedMs;
        lastCountdownSecond = -1;
        soundEnabled = intent.getBooleanExtra(EXTRA_SOUND_ENABLED, true);
        vibrationEnabled = intent.getBooleanExtra(EXTRA_VIBRATION_ENABLED, true);
        configureFlashcardReview(intent, previousSessionId);
    }

    private void configureFlashcardReview(Intent intent, String previousSessionId) throws JSONException {
        String encodedReview = intent.getStringExtra(EXTRA_FLASHCARD_REVIEW);
        reviewCards.clear();
        pendingReviewSpeechText = "";
        pendingReviewSpeechLanguage = "";
        pendingReviewRecordingUrl = "";
        reviewBaseElapsedMs = Math.max(0L, intent.getLongExtra(EXTRA_ELAPSED_MS, 0L));
        reviewConfiguredWindowElapsedMs = currentStepReviewWindowElapsedMs(
            SystemClock.elapsedRealtime()
        );
        appWasVisible = MainActivity.isAppVisible();

        if (encodedReview == null || encodedReview.trim().isEmpty()) {
            lastReviewSpeechKey = "";
            stopSpeechPlayback();
            return;
        }
        JSONObject review = new JSONObject(encodedReview);
        if (!review.optBoolean("speechEnabled", false)) {
            lastReviewSpeechKey = "";
            stopSpeechPlayback();
            return;
        }

        JSONArray cards = review.optJSONArray("cards");
        if (cards == null) return;
        for (int index = 0; index < cards.length(); index += 1) {
            JSONObject card = cards.getJSONObject(index);
            reviewCards.add(new ReviewCard(
                card.optString("front", ""),
                card.optString("back", ""),
                card.optString("ttsFront", ""),
                card.optString("ttsBack", ""),
                card.optString("transliteration", ""),
                card.optString("note", ""),
                card.optString("frontAudio", ""),
                card.optString("backAudio", "")
            ));
        }
        reviewFrontDurationMs = Math.max(1000L, Math.min(10000L, review.optLong("frontSeconds", 5L) * 1000L));
        reviewBaseBackDurationMs = Math.max(1000L, Math.min(10000L, review.optLong("backSeconds", 5L) * 1000L));
        reviewBackSpeechRepeatCount = Math.max(
            1,
            Math.min(5, review.optInt("backSpeechRepeatCount", 1))
        );
        reviewBackSpeechRate = (float) Math.max(
            0.25,
            Math.min(1.0, review.optDouble("backSpeechRate", 1.0))
        );
        String configuredCardSides = review.optString("cardSides", "both");
        reviewCardSides = "front".equals(configuredCardSides) || "back".equals(configuredCardSides)
            ? configuredCardSides
            : "both";
        reviewInvertFaces = "both".equals(reviewCardSides)
            && review.optBoolean("invertFaces", false);
        reviewFrontDisplay = reviewFaceValue(review.optString("frontDisplay", "front"), "front");
        reviewBackDisplay = reviewFaceValue(review.optString("backDisplay", "back"), "back");
        reviewFrontLanguage = review.optString("frontLanguage", "").trim();
        reviewBackLanguage = review.optString("backLanguage", "").trim();
        reviewSpeechOverAmplified = review.optBoolean("overAmplified", false);
        if (!previousSessionId.equals(sessionId)) lastReviewSpeechKey = "";
        if (!currentStepPlaysFlashcardReview(SystemClock.elapsedRealtime())) pauseReviewSpeech();
    }

    private boolean currentStepAllowsFlashcardReview() {
        return !steps.isEmpty()
            && stepIndex >= 0
            && stepIndex < steps.size()
            && !steps.get(stepIndex).stopwatch
            && steps.get(stepIndex).flashcardReviewEnabled;
    }

    static boolean stepShouldHoldReviewAudioFocus(
        boolean running,
        boolean requiresConfirmation,
        boolean flashcardReviewEnabled,
        boolean hasReviewCards
    ) {
        return ReviewSetAudioFocus.shouldHold(
            running,
            !requiresConfirmation && flashcardReviewEnabled,
            hasReviewCards
        );
    }

    private void updateReviewStepAudioFocus() {
        if (steps.isEmpty() || stepIndex < 0 || stepIndex >= steps.size()) {
            releaseReviewStepAudioFocus();
            return;
        }
        IntervalStep step = steps.get(stepIndex);
        reviewSetAudioFocus.update(
            running,
            !step.requiresConfirmation && step.flashcardReviewEnabled,
            !reviewCards.isEmpty()
        );
    }

    private void releaseReviewStepAudioFocus() {
        if (reviewSetAudioFocus != null) reviewSetAudioFocus.release();
    }

    static long reviewWindowElapsedMs(long durationMs, long remainingMs) {
        long safeDurationMs = Math.max(0L, durationMs);
        long safeRemainingMs = Math.min(safeDurationMs, Math.max(0L, remainingMs));
        long reviewDurationMs = Math.max(0L, safeDurationMs - (REVIEW_EDGE_PAUSE_MS * 2L));
        return Math.min(
            reviewDurationMs,
            Math.max(0L, safeDurationMs - safeRemainingMs - REVIEW_EDGE_PAUSE_MS)
        );
    }

    static boolean reviewWindowIsActive(long durationMs, long remainingMs) {
        long safeDurationMs = Math.max(0L, durationMs);
        long safeRemainingMs = Math.min(safeDurationMs, Math.max(0L, remainingMs));
        long elapsedMs = safeDurationMs - safeRemainingMs;
        return elapsedMs >= REVIEW_EDGE_PAUSE_MS
            && safeRemainingMs > REVIEW_EDGE_PAUSE_MS;
    }

    private long currentStepRemainingMs(long now) {
        return Math.max(0L, deadlineElapsedMs - now);
    }

    private long currentStepReviewWindowElapsedMs(long now) {
        if (!currentStepAllowsFlashcardReview()) return 0L;
        IntervalStep step = steps.get(stepIndex);
        return reviewWindowElapsedMs(step.durationMs, currentStepRemainingMs(now));
    }

    private boolean currentStepPlaysFlashcardReview(long now) {
        if (!currentStepAllowsFlashcardReview()) return false;
        IntervalStep step = steps.get(stepIndex);
        return reviewWindowIsActive(step.durationMs, currentStepRemainingMs(now));
    }

    private void pauseReviewSpeech() {
        lastReviewSpeechKey = "";
        pendingReviewSpeechText = "";
        pendingReviewSpeechLanguage = "";
        pendingReviewRecordingUrl = "";
        stopSpeechPlayback();
    }

    private long currentReviewElapsedMs(long now) {
        return reviewBaseElapsedMs + Math.max(
            0L,
            currentStepReviewWindowElapsedMs(now) - reviewConfiguredWindowElapsedMs
        );
    }

    private void settleReviewClock(long now) {
        long currentWindowElapsedMs = currentStepReviewWindowElapsedMs(now);
        reviewBaseElapsedMs += Math.max(
            0L,
            currentWindowElapsedMs - reviewConfiguredWindowElapsedMs
        );
        reviewConfiguredWindowElapsedMs = currentWindowElapsedMs;
    }

    private ReviewPhase currentReviewPhase(long now) {
        if (reviewCards.isEmpty()) return null;
        boolean showsFront = !"back".equals(reviewCardSides);
        boolean showsBack = !"front".equals(reviewCardSides);
        long elapsedMs = currentReviewElapsedMs(now);
        long cycleDurationMs = 0L;
        for (ReviewCard card : reviewCards) {
            cycleDurationMs += reviewCardDurationMs(card, showsFront, showsBack);
        }
        if (cycleDurationMs <= 0L) return null;

        long cycle = elapsedMs / cycleDurationMs;
        long elapsedInCycle = elapsedMs % cycleDurationMs;
        int cardIndex = 0;
        ReviewCard card = reviewCards.get(cardIndex);
        while (cardIndex < reviewCards.size() - 1) {
            long cardDurationMs = reviewCardDurationMs(card, showsFront, showsBack);
            if (elapsedInCycle < cardDurationMs) break;
            elapsedInCycle -= cardDurationMs;
            cardIndex += 1;
            card = reviewCards.get(cardIndex);
        }
        String firstSide = showsBack && (!showsFront || reviewInvertFaces) ? "back" : "front";
        long firstSideDurationMs = reviewFaceDurationMs(card, firstSide);
        String side = elapsedInCycle < firstSideDurationMs
            ? firstSide
            : ("front".equals(firstSide) ? "back" : "front");
        long elapsedInBack = "back".equals(side)
            ? ("back".equals(firstSide) ? elapsedInCycle : elapsedInCycle - firstSideDurationMs)
            : 0L;
        int backSpeechRepeatIndex = "back".equals(side)
            ? Math.min(
                reviewBackSpeechRepeatCount - 1,
                (int) (elapsedInBack / reviewBackRepeatDurationMs(card))
            )
            : 0;
        return new ReviewPhase(
            cardIndex,
            side,
            cycle + ":" + cardIndex + ":" + side + ":" + backSpeechRepeatIndex
        );
    }

    private long reviewCardDurationMs(ReviewCard card, boolean showsFront, boolean showsBack) {
        return (showsFront ? reviewFaceDurationMs(card, "front") : 0L)
            + (showsBack ? reviewFaceDurationMs(card, "back") : 0L);
    }

    private long reviewFaceDurationMs(ReviewCard card, String side) {
        long configuredDurationMs = "back".equals(side)
            ? reviewBaseBackDurationMs
            : reviewFrontDurationMs;
        int repetitions = "back".equals(side) ? reviewBackSpeechRepeatCount : 1;
        return repetitions * (configuredDurationMs + reviewSpeechDurationMs(card, side));
    }

    private long reviewBackRepeatDurationMs(ReviewCard card) {
        return reviewBaseBackDurationMs + reviewSpeechDurationMs(card, "back");
    }

    private long reviewSpeechDurationMs(ReviewCard card, String side) {
        String displayedValue = "front".equals(side) ? reviewFrontDisplay : reviewBackDisplay;
        String faceValue = speechFaceValue(side, displayedValue);
        String text = faceText(card, faceValue).trim();
        String language = "front".equals(side) ? reviewFrontLanguage : reviewBackLanguage;
        if (text.isEmpty() || language.isEmpty()) return 0L;

        boolean isChinese = language.toLowerCase(Locale.ROOT).startsWith("zh");
        int unitCount = isChinese
            ? text.codePointCount(0, text.length())
            : text.split("\\s+").length;
        float speechRate = "back".equals(side) ? reviewBackSpeechRate : 1.0f;
        double millisecondsPerUnit = (isChinese ? 260d : 340d)
            / Math.max(0.25d, Math.min(1d, speechRate));
        return Math.max(0L, Math.round(unitCount * millisecondsPerUnit));
    }

    private void updateReviewSpeech(long now) {
        updateReviewStepAudioFocus();
        boolean appVisible = MainActivity.isAppVisible();
        if (!currentStepPlaysFlashcardReview(now)) {
            pauseReviewSpeech();
            appWasVisible = appVisible;
            return;
        }
        if (appVisible) {
            lastReviewSpeechKey = "";
            pendingReviewSpeechText = "";
            pendingReviewSpeechLanguage = "";
            pendingReviewRecordingUrl = "";
        } else {
            speakCurrentReviewSide(now, appWasVisible);
        }
        appWasVisible = appVisible && !isReviewSpeechActive();
    }

    public static boolean handoffForegroundSpeech(String speechKey) {
        BackgroundIntervalService instance = activeInstance;
        return instance != null && instance.recordForegroundSpeech(speechKey);
    }

    public static boolean isSpeechActive() {
        BackgroundIntervalService instance = activeInstance;
        return instance != null && (
            instance.isReviewSpeechActive()
            || (instance.intervalSpeech != null && instance.intervalSpeech.isSpeaking())
        );
    }

    private boolean isReviewSpeechActive() {
        return (volumeBoost != null && volumeBoost.isActive())
            || (recordingPlayer != null && recordingPlayer.isActive());
    }

    private boolean recordForegroundSpeech(String speechKey) {
        String spokenKey = speechKey == null ? "" : speechKey.trim();
        long now = SystemClock.elapsedRealtime();
        if (spokenKey.isEmpty() || !currentStepPlaysFlashcardReview(now)) return false;
        ReviewPhase phase = currentReviewPhase(now);
        if (phase == null || !phase.key.equals(spokenKey)) return false;
        lastReviewSpeechKey = phase.key;
        pendingReviewSpeechText = "";
        pendingReviewSpeechLanguage = "";
        pendingReviewRecordingUrl = "";
        appWasVisible = false;
        return true;
    }

    private void speakCurrentReviewSide(long now, boolean force) {
        ReviewPhase phase = currentReviewPhase(now);
        if (phase == null || (!force && phase.key.equals(lastReviewSpeechKey))) return;
        stopSpeechPlayback();
        ReviewCard card = reviewCards.get(phase.cardIndex);
        lastReviewSpeechKey = phase.key;
        String displayedValue = "front".equals(phase.side) ? reviewFrontDisplay : reviewBackDisplay;
        String faceValue = speechFaceValue(phase.side, displayedValue);
        pendingReviewSpeechText = faceText(card, faceValue);
        pendingReviewSpeechLanguage = "front".equals(phase.side)
            ? reviewFrontLanguage
            : reviewBackLanguage;
        pendingReviewSpeechRate = "back".equals(phase.side) ? reviewBackSpeechRate : 1.0f;
        pendingReviewRecordingUrl = faceRecording(card, faceValue);
        speakPendingReviewSide();
    }

    private static String reviewFaceValue(String value, String fallback) {
        return "front".equals(value)
            || "back".equals(value)
            || "transliteration".equals(value)
            || "note".equals(value)
            || "image".equals(value)
                ? value
                : fallback;
    }

    private static String speechFaceValue(String side, String displayedValue) {
        return "back".equals(side) && "transliteration".equals(displayedValue)
            ? "back"
            : displayedValue;
    }

    private static String faceText(ReviewCard card, String value) {
        if ("front".equals(value)) return card.ttsFront.isEmpty() ? card.front : card.ttsFront;
        if ("back".equals(value)) return card.ttsBack.isEmpty() ? card.back : card.ttsBack;
        if ("transliteration".equals(value)) return card.transliteration;
        if ("note".equals(value)) return card.note;
        return "";
    }

    private static String faceRecording(ReviewCard card, String value) {
        if ("front".equals(value)) return card.frontAudio;
        if ("back".equals(value)) return card.backAudio;
        return "";
    }

    private void speakPendingReviewSide() {
        if (
            MainActivity.isAppVisible()
            || !currentStepPlaysFlashcardReview(SystemClock.elapsedRealtime())
            || (pendingReviewRecordingUrl.isEmpty()
                && (pendingReviewSpeechText.isEmpty() || pendingReviewSpeechLanguage.isEmpty()))
        ) return;

        String recordingUrl = pendingReviewRecordingUrl;
        String text = pendingReviewSpeechText;
        String language = pendingReviewSpeechLanguage;
        float speechRate = pendingReviewSpeechRate;
        pendingReviewRecordingUrl = "";
        if (!recordingUrl.isEmpty()) {
            pendingReviewSpeechText = "";
            pendingReviewSpeechLanguage = "";
            if (speech != null) speech.stop();
            if (volumeBoost != null) volumeBoost.stop();
            recordingPlayer.play(
                recordingUrl,
                () -> speakSynthesizedReview(text, language, speechRate),
                () -> running
                    && !MainActivity.isAppVisible()
                    && currentStepPlaysFlashcardReview(SystemClock.elapsedRealtime())
            );
            return;
        }
        speakSynthesizedReview(text, language, speechRate);
    }

    private void speakSynthesizedReview(String text, String language, float speechRate) {
        if (!speechReady || speech == null) {
            pendingReviewSpeechText = text;
            pendingReviewSpeechLanguage = language;
            return;
        }
        if (
            text.isEmpty()
            || language.isEmpty()
            || MainActivity.isAppVisible()
            || !currentStepPlaysFlashcardReview(SystemClock.elapsedRealtime())
        ) return;
        pendingReviewSpeechText = "";
        pendingReviewSpeechLanguage = "";
        int availability = speech.setLanguage(Locale.forLanguageTag(language));
        if (
            availability == TextToSpeech.LANG_MISSING_DATA
            || availability == TextToSpeech.LANG_NOT_SUPPORTED
        ) return;
        if (speech.setSpeechRate(speechRate) == TextToSpeech.ERROR) return;
        String utteranceId = "backontrack-background-interval-flashcard-" + System.nanoTime();
        int result = volumeBoost.speak(
            speech,
            text,
            utteranceId,
            reviewSpeechOverAmplified
        );
        if (result == TextToSpeech.ERROR) volumeBoost.finish(utteranceId);
    }

    private void stopSpeechPlayback() {
        if (recordingPlayer != null) recordingPlayer.stop();
        if (speech != null) speech.stop();
        if (volumeBoost != null) volumeBoost.stop();
    }

    private void startAsForeground() {
        Notification notification = buildNotification(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void advance(long now) {
        if (steps.get(stepIndex).requiresConfirmation || steps.get(stepIndex).stopwatch) return;
        while (running && now >= deadlineElapsedMs) {
            settleReviewClock(deadlineElapsedMs);
            stepIndex += 1;
            if (stepIndex >= steps.size()) {
                finishTimer();
                return;
            }
            lastCountdownSecond = -1;
            if (!MainActivity.isAppVisible()) playStepCue();
            if (steps.get(stepIndex).requiresConfirmation) {
                deadlineElapsedMs = now;
                reviewConfiguredWindowElapsedMs = 0L;
                return;
            }
            if (steps.get(stepIndex).stopwatch) {
                deadlineElapsedMs = now;
                stopwatchBaseElapsedMs = 0L;
                stopwatchStartedElapsedMs = now;
                reviewConfiguredWindowElapsedMs = 0L;
                releaseWakeLock();
                return;
            }
            deadlineElapsedMs += steps.get(stepIndex).durationMs;
            reviewConfiguredWindowElapsedMs = 0L;
        }
    }

    private void finishTimer() {
        if (!MainActivity.isAppVisible()) playCompleteCue();
        running = false;
        releaseReviewStepAudioFocus();
        handler.removeCallbacks(ticker);
        stopSpeechPlayback();
        releaseWakeLock();
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.notify(NOTIFICATION_ID + 1, buildNotification(true));
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void stopTimer() {
        running = false;
        releaseReviewStepAudioFocus();
        handler.removeCallbacks(ticker);
        stopSpeechPlayback();
        releaseWakeLock();
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void playCountdown(long now) {
        if (
            !soundEnabled
            || MainActivity.isAppVisible()
            || steps.get(stepIndex).requiresConfirmation
            || steps.get(stepIndex).stopwatch
        ) return;
        long remainingMs = Math.max(0L, deadlineElapsedMs - now);
        int remainingSeconds = (int) Math.ceil(remainingMs / 1000d);
        if (remainingSeconds >= 1 && remainingSeconds <= 3 && remainingSeconds != lastCountdownSecond) {
            lastCountdownSecond = remainingSeconds;
            IntervalCuePlayer.playCount(this);
        } else if (remainingSeconds > 3) {
            lastCountdownSecond = -1;
        }
    }

    private void playStepCue() {
        if (soundEnabled) {
            IntervalStep step = steps.get(stepIndex);
            if ("speech".equals(step.cueSound)) speakIntervalStepName(step.name);
            else IntervalCuePlayer.playSignal(this, step.cueSound);
        }
        if (vibrationEnabled) vibrate();
    }

    private void speakIntervalStepName(String name) {
        pendingIntervalStepName = name == null ? "" : name.trim();
        speakPendingIntervalStepName();
    }

    private void speakPendingIntervalStepName() {
        if (
            !intervalSpeechReady
            || intervalSpeech == null
            || pendingIntervalStepName.isEmpty()
            || MainActivity.isAppVisible()
        ) return;
        String stepName = pendingIntervalStepName;
        pendingIntervalStepName = "";
        intervalSpeech.speak(
            stepName,
            TextToSpeech.QUEUE_FLUSH,
            null,
            "backontrack-background-interval-step-" + System.nanoTime()
        );
    }

    private void playCompleteCue() {
        if (soundEnabled) IntervalCuePlayer.playComplete(this);
        if (vibrationEnabled) vibrate();
    }

    private void vibrate() {
        Vibrator vibrator;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = (VibratorManager) getSystemService(VIBRATOR_MANAGER_SERVICE);
            vibrator = manager.getDefaultVibrator();
        } else {
            vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
        }
        if (vibrator == null || !vibrator.hasVibrator()) return;

        long[] pattern = new long[] { 0L, 120L, 60L, 120L };
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(
                VibrationEffect.createWaveform(pattern, -1),
                new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build()
            );
        } else {
            vibrator.vibrate(pattern, -1);
        }
    }

    private void updateNotification(boolean complete) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.notify(NOTIFICATION_ID, buildNotification(complete));
    }

    private Notification buildNotification(boolean complete) {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setAction(Intent.ACTION_VIEW);
        launchIntent.setData(
            new Uri.Builder()
                .scheme("backontrack")
                .authority("interval")
                .appendQueryParameter(EXTRA_SESSION_ID, sessionId)
                .build()
        );
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String title = complete ? sessionName + " complete" : sessionName;
        String text;
        if (complete || stepIndex >= steps.size()) {
            text = "Interval session complete";
        } else if (steps.get(stepIndex).requiresConfirmation) {
            text = steps.get(stepIndex).name + " · Confirmation required";
        } else if (steps.get(stepIndex).stopwatch) {
            long totalSeconds = (stopwatchBaseElapsedMs + Math.max(
                0L,
                SystemClock.elapsedRealtime() - stopwatchStartedElapsedMs
            )) / 1000L;
            long hours = totalSeconds / 3600L;
            long minutes = (totalSeconds % 3600L) / 60L;
            long seconds = totalSeconds % 60L;
            String duration = hours > 0L
                ? String.format(Locale.getDefault(), "%02d:%02d:%02d", hours, minutes, seconds)
                : String.format(Locale.getDefault(), "%02d:%02d", minutes, seconds);
            text = steps.get(stepIndex).name + " · " + duration;
        } else {
            long remainingMs = Math.max(0L, deadlineElapsedMs - SystemClock.elapsedRealtime());
            long totalSeconds = (long) Math.ceil(remainingMs / 1000d);
            text = steps.get(stepIndex).name + " · " + String.format(
                Locale.getDefault(),
                "%02d:%02d",
                totalSeconds / 60,
                totalSeconds % 60
            );
        }

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(contentIntent)
            .setOngoing(!complete)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "BackOnTrack intervals",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Keeps interval sessions and cue sounds running in the background.");
        channel.setSound(null, null);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private void acquireWakeLock() {
        releaseWakeLock();
        PowerManager manager = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "backontrack:interval-timer");
        wakeLock.acquire();
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    @Override
    public void onDestroy() {
        running = false;
        releaseReviewStepAudioFocus();
        if (activeInstance == this) activeInstance = null;
        handler.removeCallbacksAndMessages(null);
        releaseWakeLock();
        if (recordingPlayer != null) recordingPlayer.stop();
        if (volumeBoost != null) volumeBoost.stop();
        if (speech != null) {
            speech.stop();
            speech.shutdown();
            speech = null;
        }
        if (intervalSpeech != null) {
            intervalSpeech.stop();
            intervalSpeech.shutdown();
            intervalSpeech = null;
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
