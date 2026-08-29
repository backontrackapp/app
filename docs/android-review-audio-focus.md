# Android Review set audio focus

Passive Review set speech requests transient, may-duck audio focus in both standalone sessions and mini interval sessions. Once requested, audio focus remains held while BackOnTrack is visible, including when the Review set, its parent Interval, or an eligible Interval step is paused. Minimizing BackOnTrack releases audio focus so other media returns to its normal volume; returning to the app reapplies the retained request. Playback scopes can still start and stop independently without changing foreground audio focus.
