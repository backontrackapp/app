package app.backontrack.android;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.Locale;

@CapacitorPlugin(
    name = "PhoneSpeechRecognition",
    permissions = @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
)
public class PhoneSpeechRecognitionPlugin extends Plugin implements RecognitionListener {

    private static final long MAX_LISTENING_MS = 60_000L;
    private static final long COMPLETE_SILENCE_MS = 5_000L;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final Runnable listeningTimeout = () -> finishListening(false);
    private SpeechRecognizer recognizer;
    private PluginCall listeningCall;
    private String listeningLocale = "";
    private boolean stopping;

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(statusResult());
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            call.resolve(statusResult());
            return;
        }
        requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
    }

    @PermissionCallback
    private void microphonePermissionCallback(PluginCall call) {
        call.resolve(statusResult());
    }

    @PluginMethod
    public void startListening(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("Microphone access is required.", "SPEECH_PERMISSION_DENIED");
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.unavailable("Phone speech recognition is unavailable.");
            return;
        }
        if (listeningCall != null) {
            call.reject("Another voice request is already listening.", "SPEECH_BUSY");
            return;
        }

        String requestedLocale = call.getString("locale", Locale.getDefault().toLanguageTag()).trim();
        listeningLocale = requestedLocale.isEmpty() ? Locale.getDefault().toLanguageTag() : requestedLocale;
        listeningCall = call;
        stopping = false;
        mainHandler.post(() -> {
            try {
                destroyRecognizer();
                recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                recognizer.setRecognitionListener(this);
                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, listeningLocale);
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                intent.putExtra(
                    RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS,
                    COMPLETE_SILENCE_MS
                );
                intent.putExtra(
                    RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS,
                    COMPLETE_SILENCE_MS
                );
                recognizer.startListening(intent);
                mainHandler.postDelayed(listeningTimeout, MAX_LISTENING_MS);
            } catch (RuntimeException error) {
                rejectListening("Phone speech recognition could not start.", "SPEECH_START_FAILED", error);
            }
        });
    }

    @PluginMethod
    public void stopListening(PluginCall call) {
        mainHandler.post(() -> {
            if (recognizer != null && listeningCall != null) {
                stopping = true;
                recognizer.stopListening();
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void cancelListening(PluginCall call) {
        mainHandler.post(() -> {
            cancelActiveCall();
            call.resolve();
        });
    }

    @Override
    public void onPartialResults(Bundle partialResults) {
        String transcript = firstResult(partialResults);
        if (transcript.isEmpty()) return;
        JSObject result = new JSObject();
        result.put("transcript", transcript);
        notifyListeners("partialResult", result);
    }

    @Override
    public void onResults(Bundle results) {
        String transcript = firstResult(results);
        if (transcript.isEmpty()) {
            rejectListening("No speech was recognized.", "SPEECH_NO_MATCH", null);
            return;
        }
        PluginCall call = takeListeningCall();
        if (call == null) return;
        JSObject result = new JSObject();
        result.put("transcript", transcript);
        result.put("locale", listeningLocale);
        call.resolve(result);
    }

    @Override
    public void onError(int error) {
        if (listeningCall == null) return;
        if (error == SpeechRecognizer.ERROR_CLIENT && stopping) {
            rejectListening("No speech was recognized.", "SPEECH_NO_MATCH", null);
            return;
        }
        String message;
        String code;
        switch (error) {
            case SpeechRecognizer.ERROR_NO_MATCH:
            case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                message = "No speech was recognized.";
                code = "SPEECH_NO_MATCH";
                break;
            case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                message = "Microphone access is required.";
                code = "SPEECH_PERMISSION_DENIED";
                break;
            case SpeechRecognizer.ERROR_NETWORK:
            case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                message = "Phone speech recognition needs a network connection on this device.";
                code = "SPEECH_NETWORK";
                break;
            case SpeechRecognizer.ERROR_RECOGNIZER_BUSY:
                message = "Phone speech recognition is busy. Try again.";
                code = "SPEECH_BUSY";
                break;
            default:
                message = "Phone speech recognition could not finish.";
                code = "SPEECH_FAILED";
        }
        rejectListening(message, code, null);
    }

    private JSObject statusResult() {
        JSObject result = new JSObject();
        result.put("available", SpeechRecognizer.isRecognitionAvailable(getContext()));
        PermissionState state = getPermissionState("microphone");
        String permission = state == PermissionState.GRANTED
            ? "granted"
            : state == PermissionState.DENIED ? "denied" : "prompt";
        result.put("permission", permission);
        return result;
    }

    private String firstResult(Bundle bundle) {
        if (bundle == null) return "";
        ArrayList<String> matches = bundle.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return matches == null || matches.isEmpty() ? "" : matches.get(0).trim();
    }

    private void finishListening(boolean cancel) {
        if (recognizer == null || listeningCall == null) return;
        stopping = true;
        if (cancel) recognizer.cancel();
        else recognizer.stopListening();
    }

    private void cancelActiveCall() {
        PluginCall call = takeListeningCall();
        if (recognizer != null) recognizer.cancel();
        if (call != null) call.reject("Voice recognition was cancelled.", "SPEECH_CANCELLED");
    }

    private PluginCall takeListeningCall() {
        PluginCall call = listeningCall;
        listeningCall = null;
        mainHandler.removeCallbacks(listeningTimeout);
        destroyRecognizer();
        stopping = false;
        return call;
    }

    private void rejectListening(String message, String code, Exception error) {
        PluginCall call = takeListeningCall();
        if (call == null) return;
        if (error == null) call.reject(message, code);
        else call.reject(message, code, error);
    }

    private void destroyRecognizer() {
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
    }

    @Override public void onReadyForSpeech(Bundle params) {}
    @Override public void onBeginningOfSpeech() {}
    @Override public void onRmsChanged(float rmsdB) {}
    @Override public void onBufferReceived(byte[] buffer) {}
    @Override public void onEndOfSpeech() {}
    @Override public void onEvent(int eventType, Bundle params) {}

    @Override
    protected void handleOnDestroy() {
        mainHandler.removeCallbacks(listeningTimeout);
        mainHandler.post(this::cancelActiveCall);
        super.handleOnDestroy();
    }
}
