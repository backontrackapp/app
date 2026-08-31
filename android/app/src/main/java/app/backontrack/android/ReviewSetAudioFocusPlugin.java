package app.backontrack.android;

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
