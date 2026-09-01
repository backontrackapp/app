package app.backontrack.android;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ReviewSetAudioFocus")
public class ReviewSetAudioFocusPlugin extends Plugin {

    private ReviewSetAudioFocus reviewSetAudioFocus;

    @Override
    public void load() {
        reviewSetAudioFocus = new ReviewSetAudioFocus(getContext());
    }

    @PluginMethod
    public void setActive(PluginCall call) {
        boolean active = Boolean.TRUE.equals(call.getBoolean("active", false));
        reviewSetAudioFocus.update(active, true, true);
        call.resolve();
    }

    @PluginMethod
    public void reapply(PluginCall call) {
        TransientAudioFocus.reapplyActiveFocusIfNecessary();
        call.resolve();
    }

    @PluginMethod
    @SuppressWarnings("deprecation")
    public void isBluetoothAudioActive(PluginCall call) {
        AudioManager audioManager = (AudioManager) getContext()
            .getSystemService(Context.AUDIO_SERVICE);
        boolean active = audioManager != null && (
            audioManager.isBluetoothA2dpOn()
                || audioManager.isBluetoothScoOn()
                || communicationDeviceUsesBluetooth(audioManager)
        );
        JSObject result = new JSObject();
        result.put("active", active);
        call.resolve(result);
    }

    private boolean communicationDeviceUsesBluetooth(AudioManager audioManager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false;
        AudioDeviceInfo device = audioManager.getCommunicationDevice();
        if (device == null) return false;
        int type = device.getType();
        return type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP
            || type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
            || type == AudioDeviceInfo.TYPE_BLE_HEADSET
            || type == AudioDeviceInfo.TYPE_BLE_SPEAKER;
    }

    @Override
    protected void handleOnResume() {
        TransientAudioFocus.reapplyActiveFocusIfNecessary();
    }

    @Override
    protected void handleOnDestroy() {
        if (reviewSetAudioFocus != null) reviewSetAudioFocus.release();
        super.handleOnDestroy();
    }
}
