package app.backontrack.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
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

public class BackgroundFlashcardService extends Service {

    public static final String ACTION_START = "app.backontrack.android.flashcards.START";
    public static final String PREFERENCES = "backontrack_flashcard_speech";
    public static final String KEY_CONFIG = "background_config";
    public static final String KEY_STATE = "background_state";

    private static final String CHANNEL_ID = "backontrack_flashcard_review";
    private static final int NOTIFICATION_ID = 4207;
    private static final long TICK_MS = 200L;
    private static volatile BackgroundFlashcardService activeInstance;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<Card> cards = new ArrayList<>();
    private SharedPreferences preferences;
    private PowerManager.WakeLock wakeLock;
    private TextToSpeech speech;
    private TtsVolumeBoost volumeBoost;
    private FlashcardRecordingPlayer recordingPlayer;
    private ReviewSetAudioFocus reviewSetAudioFocus;
    private boolean speechReady;
    private boolean speechOverAmplified;
    private float backSpeechRate = 1.0f;
    private boolean running;
    private boolean finished;
    private boolean indefinite;
    private long timeLimitMs;
    private String sessionId = "";
    private String sessionName = "Review";
    private String cardSides = "both";
    private boolean invertFaces = false;
    private String side = "front";
    private String frontDisplay = "front";
    private String backDisplay = "back";
    private String frontLanguage = "";
    private String backLanguage = "";
    private long frontDurationMs = 5000L;
    private long baseBackDurationMs = 5000L;
    private long backDurationMs = 5000L;
    private long currentFaceDurationMs = 5000L;
    private int backSpeechRepeatCount = 1;
    private int lastBackSpeechRepeatIndex = -1;
    private final List<Long> backSpeechDurationMs = new ArrayList<>();
    private long deadlineElapsedMs;
    private long configuredElapsedMs;
    private long baseElapsedMs;
    private int cardIndex;
    private int completedCards;
    private String pendingSpeechText = "";
    private String pendingSpeechLanguage = "";
    private String pendingRecordingUrl = "";
    private long lastNotificationSecond = -1L;
    private long lastTickElapsedMs;
    private long appliedSpeechDurationMs;

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            if (!running) return;
            long now = SystemClock.elapsedRealtime();
            lastTickElapsedMs = now;
            if (timeLimitMs > 0L && currentElapsedMs(now) >= timeLimitMs) {
                finishReview(now);
                return;
            }
            // The foreground runner already spoke the current side. Preserve its remaining
            // duration during handoff and speak only when advance() reaches the next side.
            advance(now);
            if (!running) return;
            repeatBackSpeechWhenDue(now);
            long notificationSecond = Math.max(0L, deadlineElapsedMs - now) / 1000L;
            if (notificationSecond != lastNotificationSecond) {
                lastNotificationSecond = notificationSecond;
                persistState();
                updateNotification(false);
            }
            handler.postDelayed(this, TICK_MS);
        }
    };

    private static final class Card {
        final String front;
        final String back;
        final String ttsFront;
        final String ttsBack;
        final String transliteration;
        final String note;
        final String frontAudio;
        final String backAudio;

        Card(
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

    @Override
    public void onCreate() {
        super.onCreate();
        activeInstance = this;
        preferences = getSharedPreferences(PREFERENCES, MODE_PRIVATE);
        createNotificationChannel();
        reviewSetAudioFocus = new ReviewSetAudioFocus(this);
        volumeBoost = new TtsVolumeBoost(this);
        volumeBoost.setPlaybackListener(new TtsVolumeBoost.PlaybackListener() {
            @Override
            public void onStart(
                String utteranceId,
                int durationMs,
                List<TtsVolumeBoost.SpeechRange> speechRanges
            ) {
                if (durationMs > 0) applyCurrentSpeechDuration(durationMs);
            }

            @Override
            public void onDone(String utteranceId) {}
        });
        recordingPlayer = new FlashcardRecordingPlayer(this);
        speech = new TextToSpeech(this, status -> {
            speechReady = status == TextToSpeech.SUCCESS;
            if (speechReady) {
                speech.setAudioAttributes(ReviewSetAudioFocus.speechAudioAttributes());
                speech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
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
                speakPendingSide();
            }
        });
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || !ACTION_START.equals(intent.getAction())) return START_NOT_STICKY;
        try {
            configure(new JSONObject(preferences.getString(KEY_CONFIG, "")));
            startAsForeground();
            acquireWakeLock();
            running = true;
            updateReviewSetAudioFocus();
            finished = false;
            handler.removeCallbacks(ticker);
            handler.post(ticker);
        } catch (JSONException | IllegalArgumentException error) {
            stopReview(false);
        }
        return START_NOT_STICKY;
    }

    private void configure(JSONObject config) throws JSONException {
        JSONArray encodedCards = config.getJSONArray("cards");
        cards.clear();
        for (int index = 0; index < encodedCards.length(); index += 1) {
            JSONObject encoded = encodedCards.getJSONObject(index);
            cards.add(new Card(
                encoded.optString("front", ""),
                encoded.optString("back", ""),
                encoded.optString("ttsFront", ""),
                encoded.optString("ttsBack", ""),
                encoded.optString("transliteration", ""),
                encoded.optString("note", ""),
                encoded.optString("frontAudio", ""),
                encoded.optString("backAudio", "")
            ));
        }
        if (cards.isEmpty()) throw new IllegalArgumentException("The review queue is empty.");

        sessionId = config.optString("sessionId", "").trim();
        if (sessionId.isEmpty()) throw new IllegalArgumentException("A session ID is required.");
        sessionName = config.optString("sessionName", "Review").trim();
        if (sessionName.isEmpty()) sessionName = "Review";
        indefinite = config.optBoolean("indefinite", false);
        timeLimitMs = Math.max(0L, config.optLong("timeLimitSeconds", 0L) * 1000L);
        String configuredCardSides = config.optString("cardSides", "both");
        cardSides = "front".equals(configuredCardSides) || "back".equals(configuredCardSides)
            ? configuredCardSides
            : "both";
        invertFaces = "both".equals(cardSides) && config.optBoolean("invertFaces", false);
        side = "back".equals(config.optString("side")) ? "back" : "front";
        if (!"both".equals(cardSides)) side = cardSides;
        frontDisplay = reviewFaceValue(config.optString("frontDisplay", "front"), "front");
        backDisplay = reviewFaceValue(config.optString("backDisplay", "back"), "back");
        frontDurationMs = Math.max(1000L, Math.min(10000L, config.optLong("frontSeconds", 5L) * 1000L));
        baseBackDurationMs = Math.max(1000L, Math.min(10000L, config.optLong("backSeconds", 5L) * 1000L));
        backSpeechRepeatCount = Math.max(1, Math.min(5, config.optInt("backSpeechRepeatCount", 1)));
        backDurationMs = baseBackDurationMs * backSpeechRepeatCount;
        backSpeechDurationMs.clear();
        frontLanguage = config.optString("frontLanguage", "").trim();
        backLanguage = config.optString("backLanguage", "").trim();
        speechOverAmplified = config.optBoolean("overAmplified", false);
        backSpeechRate = (float) Math.max(
            0.25,
            Math.min(1.0, config.optDouble("backSpeechRate", 1.0))
        );
        baseElapsedMs = Math.max(0L, config.optLong("elapsedMs", 0L));
        configuredElapsedMs = SystemClock.elapsedRealtime();
        lastTickElapsedMs = configuredElapsedMs;
        long remainingMs = Math.max(1L, config.optLong("remainingMs", 1L));
        deadlineElapsedMs = configuredElapsedMs + remainingMs;
        currentFaceDurationMs = "back".equals(side) ? backDurationMs : frontDurationMs;
        lastBackSpeechRepeatIndex = "back".equals(side)
            ? Math.min(
                backSpeechRepeatCount - 1,
                (int) (Math.max(0L, backDurationMs - remainingMs) / baseBackDurationMs)
            )
            : -1;
        cardIndex = 0;
        completedCards = 0;
        lastNotificationSecond = -1L;
        pendingSpeechText = "";
        pendingSpeechLanguage = "";
        pendingRecordingUrl = "";
        appliedSpeechDurationMs = 0L;
        stopSpeechPlayback();
        persistState();
    }

    private void advance(long now) {
        while (running && now >= deadlineElapsedMs) {
            String firstSide = invertFaces ? "back" : "front";
            if (firstSide.equals(side) && "both".equals(cardSides)) {
                side = "front".equals(side) ? "back" : "front";
                deadlineElapsedMs += "back".equals(side) ? backDurationMs : frontDurationMs;
                lastBackSpeechRepeatIndex = "back".equals(side) ? 0 : -1;
                currentFaceDurationMs = "back".equals(side) ? backDurationMs : frontDurationMs;
                if ("back".equals(side)) backSpeechDurationMs.clear();
                appliedSpeechDurationMs = 0L;
                speakCurrentSide();
            } else {
                completedCards += 1;
                cardIndex += 1;
                if (cardIndex >= cards.size()) {
                    if (indefinite) {
                        cardIndex = 0;
                    } else {
                        finishReview();
                        return;
                    }
                }
                side = "back".equals(cardSides) || ("both".equals(cardSides) && invertFaces)
                    ? "back"
                    : "front";
                lastBackSpeechRepeatIndex = -1;
                deadlineElapsedMs += "back".equals(side) ? backDurationMs : frontDurationMs;
                if ("back".equals(side)) lastBackSpeechRepeatIndex = 0;
                currentFaceDurationMs = "back".equals(side) ? backDurationMs : frontDurationMs;
                if ("back".equals(side)) backSpeechDurationMs.clear();
                appliedSpeechDurationMs = 0L;
                speakCurrentSide();
            }
            persistState();
        }
    }

    private void repeatBackSpeechWhenDue(long now) {
        if (!"back".equals(side) || backSpeechRepeatCount <= 1) return;
        int repeatIndex = backSpeechRepeatIndex(now);
        if (repeatIndex <= lastBackSpeechRepeatIndex) return;
        lastBackSpeechRepeatIndex = repeatIndex;
        appliedSpeechDurationMs = 0L;
        speakCurrentSide();
    }

    private int backSpeechRepeatIndex(long now) {
        long elapsedMs = Math.max(0L, now - (deadlineElapsedMs - currentFaceDurationMs));
        for (int index = 0; index < backSpeechRepeatCount - 1; index += 1) {
            long speechDurationMs = index < backSpeechDurationMs.size()
                ? backSpeechDurationMs.get(index)
                : 0L;
            long repeatDurationMs = baseBackDurationMs + speechDurationMs;
            if (elapsedMs < repeatDurationMs) return index;
            elapsedMs -= repeatDurationMs;
        }
        return backSpeechRepeatCount - 1;
    }

    private void speakCurrentSide() {
        if (MainActivity.isAppVisible() || cardIndex >= cards.size()) return;
        stopSpeechPlayback();
        Card card = cards.get(cardIndex);
        String displayedValue = "front".equals(side) ? frontDisplay : backDisplay;
        String faceValue = speechFaceValue(side, displayedValue);
        pendingSpeechText = faceText(card, faceValue);
        pendingSpeechLanguage = "front".equals(side) ? frontLanguage : backLanguage;
        pendingRecordingUrl = faceRecording(card, faceValue);
        speakPendingSide();
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

    private static String faceText(Card card, String value) {
        if ("front".equals(value)) return card.ttsFront.isEmpty() ? card.front : card.ttsFront;
        if ("back".equals(value)) return card.ttsBack.isEmpty() ? card.back : card.ttsBack;
        if ("transliteration".equals(value)) return card.transliteration;
        if ("note".equals(value)) return card.note;
        return "";
    }

    private static String faceRecording(Card card, String value) {
        if ("front".equals(value)) return card.frontAudio;
        if ("back".equals(value)) return card.backAudio;
        return "";
    }

    private void speakPendingSide() {
        if (
            MainActivity.isAppVisible()
            || (pendingRecordingUrl.isEmpty()
                && (pendingSpeechText.isEmpty() || pendingSpeechLanguage.isEmpty()))
        ) return;

        String recordingUrl = pendingRecordingUrl;
        String text = pendingSpeechText;
        String language = pendingSpeechLanguage;
        pendingRecordingUrl = "";
        if (!recordingUrl.isEmpty()) {
            pendingSpeechText = "";
            pendingSpeechLanguage = "";
            if (speech != null) speech.stop();
            if (volumeBoost != null) volumeBoost.stop();
            recordingPlayer.play(
                recordingUrl,
                () -> applyCurrentSpeechDuration(recordingPlayer.durationMs()),
                () -> speakSynthesized(text, language),
                () -> {},
                () -> running && !MainActivity.isAppVisible()
            );
            return;
        }
        speakSynthesized(text, language);
    }

    private void speakSynthesized(String text, String language) {
        if (!speechReady || speech == null) {
            pendingSpeechText = text;
            pendingSpeechLanguage = language;
            return;
        }
        if (text.isEmpty() || language.isEmpty() || MainActivity.isAppVisible()) return;
        pendingSpeechText = "";
        pendingSpeechLanguage = "";
        int availability = speech.setLanguage(Locale.forLanguageTag(language));
        if (
            availability == TextToSpeech.LANG_MISSING_DATA
            || availability == TextToSpeech.LANG_NOT_SUPPORTED
        ) return;
        float speechRate = "back".equals(side) ? backSpeechRate : 1.0f;
        if (speech.setSpeechRate(speechRate) == TextToSpeech.ERROR) return;
        applyCurrentSpeechDuration(estimatedSpeechDurationMs(text, language, speechRate));
        String utteranceId = "backontrack-background-flashcard-" + System.nanoTime();
        int result = volumeBoost.speak(
            speech,
            text,
            utteranceId,
            speechOverAmplified
        );
        if (result == TextToSpeech.ERROR) {
            applyCurrentSpeechDuration(0L);
            volumeBoost.finish(utteranceId);
        }
    }

    private long estimatedSpeechDurationMs(String text, String language, float speechRate) {
        String content = text == null ? "" : text.trim();
        if (content.isEmpty()) return 0L;
        int wordCount = language != null && language.toLowerCase(Locale.ROOT).startsWith("zh")
            ? content.codePointCount(0, content.length())
            : content.split("\\s+").length;
        double millisecondsPerWord = (language != null && language.toLowerCase(Locale.ROOT).startsWith("zh")
            ? 260d
            : 340d) / Math.max(0.25d, Math.min(1d, speechRate));
        return Math.max(0L, Math.round(wordCount * millisecondsPerWord));
    }

    private void applyCurrentSpeechDuration(long durationMs) {
        if (!running || MainActivity.isAppVisible()) return;
        long nextDurationMs = Math.max(0L, durationMs);
        long adjustmentMs = nextDurationMs - appliedSpeechDurationMs;
        deadlineElapsedMs += adjustmentMs;
        currentFaceDurationMs = Math.max(1L, currentFaceDurationMs + adjustmentMs);
        if ("back".equals(side) && lastBackSpeechRepeatIndex >= 0) {
            while (backSpeechDurationMs.size() <= lastBackSpeechRepeatIndex) {
                backSpeechDurationMs.add(0L);
            }
            backSpeechDurationMs.set(lastBackSpeechRepeatIndex, nextDurationMs);
        }
        appliedSpeechDurationMs = nextDurationMs;
    }

    private void stopSpeechPlayback() {
        if (recordingPlayer != null) recordingPlayer.stop();
        if (speech != null) speech.stop();
        if (volumeBoost != null) volumeBoost.stop();
    }

    private void updateReviewSetAudioFocus() {
        reviewSetAudioFocus.update(running, true, !cards.isEmpty());
    }

    private void releaseReviewSetAudioFocus() {
        if (reviewSetAudioFocus != null) reviewSetAudioFocus.release();
    }

    private void startAsForeground() {
        getSystemService(NotificationManager.class).cancel(NOTIFICATION_ID + 1);
        Notification notification = buildNotification(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private long currentElapsedMs(long now) {
        long elapsed = baseElapsedMs + Math.max(0L, now - configuredElapsedMs);
        return timeLimitMs > 0L ? Math.min(timeLimitMs, elapsed) : elapsed;
    }

    private void finishReview() {
        finishReview(SystemClock.elapsedRealtime());
    }

    private void finishReview(long now) {
        baseElapsedMs = currentElapsedMs(now);
        configuredElapsedMs = now;
        running = false;
        releaseReviewSetAudioFocus();
        finished = true;
        handler.removeCallbacks(ticker);
        stopSpeechPlayback();
        if (!MainActivity.isAppVisible()) IntervalCuePlayer.playComplete(this);
        persistState();
        releaseWakeLock();
        getSystemService(NotificationManager.class).notify(
            NOTIFICATION_ID + 1,
            buildNotification(true)
        );
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void stopReview(boolean clearState) {
        running = false;
        releaseReviewSetAudioFocus();
        handler.removeCallbacks(ticker);
        stopSpeechPlayback();
        releaseWakeLock();
        stopForeground(STOP_FOREGROUND_REMOVE);
        if (clearState && preferences != null) {
            preferences.edit().remove(KEY_CONFIG).remove(KEY_STATE).apply();
        }
        stopSelf();
    }

    private JSONObject state() {
        JSONObject state = new JSONObject();
        long now = SystemClock.elapsedRealtime();
        try {
            state.put("sessionId", sessionId);
            state.put("running", running);
            state.put("finished", finished);
            state.put("completedCards", completedCards);
            state.put("side", side);
            state.put("remainingMs", running ? Math.max(0L, deadlineElapsedMs - now) : 0L);
            state.put("durationMs", currentFaceDurationMs);
            state.put("elapsedMs", running ? currentElapsedMs(now) : baseElapsedMs);
        } catch (JSONException ignored) {
            // All values are JSON primitives.
        }
        return state;
    }

    private void persistState() {
        if (preferences != null) preferences.edit().putString(KEY_STATE, state().toString()).apply();
    }

    public static JSONObject currentState(Context context) throws JSONException {
        BackgroundFlashcardService instance = activeInstance;
        if (instance != null && !instance.sessionId.isEmpty()) return instance.state();
        String encoded = context
            .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            .getString(KEY_STATE, "");
        return encoded.isEmpty() ? new JSONObject() : new JSONObject(encoded);
    }

    public static boolean handoffForegroundSpeech() {
        BackgroundFlashcardService instance = activeInstance;
        return instance != null && instance.running && !instance.sessionId.isEmpty();
    }

    public static boolean isSpeechActive() {
        BackgroundFlashcardService instance = activeInstance;
        return instance != null && (
            (instance.volumeBoost != null && instance.volumeBoost.isActive())
            || (instance.recordingPlayer != null && instance.recordingPlayer.isActive())
        );
    }

    private void updateNotification(boolean complete) {
        getSystemService(NotificationManager.class).notify(
            NOTIFICATION_ID,
            buildNotification(complete)
        );
    }

    private Notification buildNotification(boolean complete) {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setAction(Intent.ACTION_VIEW);
        launchIntent.setData(
            new Uri.Builder()
                .scheme("backontrack")
                .authority("flashcards")
                .appendQueryParameter("sessionId", sessionId)
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
        if (complete || cardIndex >= cards.size()) {
            text = "Flashcard review complete";
        } else {
            long remainingMs = Math.max(0L, deadlineElapsedMs - SystemClock.elapsedRealtime());
            long seconds = (long) Math.ceil(remainingMs / 1000d);
            text = ("front".equals(side) ? "Front" : "Back")
                + " · " + seconds + "s · Card " + (cardIndex + 1) + " of " + cards.size();
        }

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(contentIntent)
            .setOngoing(!complete)
            .setAutoCancel(complete)
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
            "BackOnTrack flashcard reviews",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Keeps passive flashcard speech and timing active in the background.");
        channel.setSound(null, null);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private void acquireWakeLock() {
        releaseWakeLock();
        PowerManager manager = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = manager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "backontrack:flashcard-review"
        );
        wakeLock.acquire();
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    @Override
    public void onDestroy() {
        running = false;
        releaseReviewSetAudioFocus();
        activeInstance = null;
        handler.removeCallbacksAndMessages(null);
        releaseWakeLock();
        if (recordingPlayer != null) recordingPlayer.stop();
        if (volumeBoost != null) volumeBoost.stop();
        if (speech != null) {
            speech.stop();
            speech.shutdown();
            speech = null;
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
