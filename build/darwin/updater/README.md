# Sparkle build support

ReviewArc pins the official Sparkle 2 binary distribution rather than checking
the framework into Git. `fetch_sparkle.sh` verifies the release archive before
making the framework and `sign_update` tool available under `.deps/`.

The native Go adapter is guarded by the `sparkle` build tag. A macOS release
build must:

1. Populate `dist/sparkle/Sparkle.framework` from the pinned official archive.
   `fetch_sparkle.sh` is available as a local-development fallback.
2. Build with `-tags sparkle`; the cgo adapter links against the downloaded
   framework.
3. Run `build/darwin/updater/embed_sparkle.sh <ReviewArc.app>
   dist/sparkle/Sparkle.framework` before signing. The embed step also adds
   `@executable_path/../Frameworks` to the executable's runtime search paths;
   it must therefore run before code signing.
4. Run `build/darwin/updater/sign_sparkle.sh <ReviewArc.app> <identity>`, then
   sign the ReviewArc executable and outer app last. Do not use `codesign
   --deep` for signing.
5. Run `build/darwin/updater/verify_sparkle.sh <ReviewArc.app>`.

The framework and release tools remain in `.deps/`, which is ignored. Preserve
framework symlinks whenever the app bundle is copied or packaged.
