# Android branch builds

Android builds made from `main` or `master` use the normal `BackOnTrack` launcher name and `app.backontrack.android` package. Every other branch receives a normalized branch suffix in its launcher name and a deterministic, branch-specific Android application ID. The branch hash in the application ID prevents normalized names such as `feature/foo` and `feature-foo` from colliding.

This lets a branch APK install beside the main app and other branch APKs without overwriting their local app data. The standard Android build and push commands apply this automatically.
