package app.backontrack.android;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;

/**
 * Holds transient audio focus after Review set playback first becomes active. Playback leases
 * identify the scopes that need focus, but pausing a scope does not restore other media while the
 * app remains visible. Activity visibility is the only lifecycle signal that abandons or reapplies
 * the focus request.
 */
final class TransientAudioFocus {

    // Keep per-sound focus wired in while it remains disabled. Review set sessions explicitly own
    // focus for their active playback scope through acquireReviewSet().
    private static final boolean PER_SOUND_AUDIO_FOCUS_ENABLED = false;

    static final class Lease {
        private TransientAudioFocus owner;

        private Lease(TransientAudioFocus owner) {
            this.owner = owner;
        }

        void release() {
            TransientAudioFocus currentOwner;
            synchronized (this) {
                currentOwner = owner;
                owner = null;
            }
            if (currentOwner != null) currentOwner.releaseLease();
        }
    }

    private static volatile TransientAudioFocus instance;

    private final AudioManager audioManager;
    private final AudioManager.OnAudioFocusChangeListener focusChangeListener =
        this::handleAudioFocusChange;
    private AudioFocusRequest focusRequest;
    private int activeLeases;
    private boolean focusGranted;
    private boolean appVisible;

    private TransientAudioFocus(Context context) {
        audioManager = context.getSystemService(AudioManager.class);
        appVisible = MainActivity.isAppVisible();
    }

    static Lease acquire(Context context, AudioAttributes audioAttributes) {
        if (!PER_SOUND_AUDIO_FOCUS_ENABLED) return new Lease(null);
        return get(context).acquireLease(audioAttributes);
    }

    static Lease acquireReviewSet(Context context, AudioAttributes audioAttributes) {
        return get(context).acquireLease(audioAttributes);
    }

    static void reapplyActiveFocusIfNecessary() {
        TransientAudioFocus focus = instance;
        if (focus != null) focus.reapplyFocusIfNecessary();
    }

    static void setAppVisible(boolean visible) {
        TransientAudioFocus focus = instance;
        if (focus != null) focus.updateAppVisibility(visible);
    }

    private static TransientAudioFocus get(Context context) {
        TransientAudioFocus focus = instance;
        if (focus != null) return focus;

        synchronized (TransientAudioFocus.class) {
            focus = instance;
            if (focus == null) {
                focus = new TransientAudioFocus(context.getApplicationContext());
                instance = focus;
            }
        }
        return focus;
    }

    private synchronized Lease acquireLease(AudioAttributes audioAttributes) {
        if (focusRequest == null) {
            focusRequest = new AudioFocusRequest.Builder(
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
            )
                .setAudioAttributes(audioAttributes)
                .setAcceptsDelayedFocusGain(false)
                .setOnAudioFocusChangeListener(focusChangeListener)
                .build();
        }
        if (!focusGranted && appVisible) {
            focusGranted = audioManager != null
                && audioManager.requestAudioFocus(focusRequest)
                    == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
        }
        activeLeases += 1;
        return new Lease(this);
    }

    private synchronized void updateAppVisibility(boolean visible) {
        appVisible = visible;
        if (visible) {
            reapplyFocusIfNecessary();
            return;
        }
        abandonFocus();
    }

    private synchronized void handleAudioFocusChange(int focusChange) {
        if (focusChange == AudioManager.AUDIOFOCUS_GAIN) {
            focusGranted = appVisible && focusRequest != null;
            return;
        }

        if (
            focusChange == AudioManager.AUDIOFOCUS_LOSS
                || focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT
                || focusChange == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK
        ) {
            focusGranted = false;
        }
    }

    private synchronized void reapplyFocusIfNecessary() {
        if (!appVisible || focusGranted || audioManager == null || focusRequest == null) return;
        focusGranted = audioManager.requestAudioFocus(focusRequest)
            == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
    }

    private synchronized void releaseLease() {
        activeLeases = Math.max(0, activeLeases - 1);
    }

    private void abandonFocus() {
        if (audioManager != null && focusRequest != null) {
            audioManager.abandonAudioFocusRequest(focusRequest);
        }
        focusGranted = false;
    }
}
