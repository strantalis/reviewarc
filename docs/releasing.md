# ReviewArc release setup

ReviewArc releases are built from version tags by `.github/workflows/release.yml`. The workflow is deliberately fail-closed: it does not publish an unsigned or unnotarized fallback.

## Apple Developer inputs

Prepare these items in the LLC's Apple Developer team. Do not paste private keys, certificate archives, passwords, or tokens into an issue, commit, or chat.

1. Use the stable bundle identifier `com.silkcitylabs.reviewarc`. This is the `APPLE_BUNDLE_ID` GitHub environment variable and must not change after distribution begins.
2. Copy the 10-character Apple Developer Team ID. This is the `APPLE_TEAM_ID` environment variable.
3. Create a **Developer ID Application** certificate for distribution outside the Mac App Store. Install it on the Mac where its private key was created, then export the certificate and private key together from Keychain Access as a password-protected `.p12` file.
4. In App Store Connect, create a **team** API key for notarization and download its `.p8` file once. Record the Key ID and Issuer ID. Individual API keys cannot authenticate `notarytool`.
5. Decide the legal copyright string and copy the exact certificate identity shown by:

   ```sh
   security find-identity -v -p codesigning
   ```

   The identity should look like `Developer ID Application: Legal LLC Name (TEAMID)`.

The DMG workflow does not need a Developer ID Installer certificate or a Mac App Store provisioning profile.

## GitHub environment

Create a protected environment named `release`. Limit deployment branches/tags and add required reviewers when the repository plan supports them before loading release credentials. The same environment protects beta and stable releases. Add these environment variables:

- `APPLE_BUNDLE_ID`
- `APPLE_COPYRIGHT`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_TEAM_ID`
- `SPARKLE_PUBLIC_ED_KEY`: the base64 public key printed by Sparkle's `generate_keys`
- `SPARKLE_FEED_URL`: the production HTTPS feed URL, `https://www.reviewarc.dev/api/appcast.xml`

Add these environment secrets:

- `APPLE_DEVELOPER_ID_P12_BASE64`: base64 encoding of the `.p12` archive
- `APPLE_DEVELOPER_ID_P12_PASSWORD`: password used when the `.p12` was exported
- `APPLE_NOTARY_KEY_P8_BASE64`: base64 encoding of the App Store Connect `.p8` key
- `APPLE_NOTARY_KEY_ID`
- `APPLE_NOTARY_ISSUER_ID`
- `BLOB_READ_WRITE_TOKEN`
- `SPARKLE_ED25519_PRIVATE_KEY_BASE64`: base64 encoding of the private key file exported by Sparkle's `generate_keys`

Load file-backed secrets without printing their contents:

```sh
base64 -i /path/to/developer-id.p12 | gh secret set APPLE_DEVELOPER_ID_P12_BASE64 --env release --repo strantalis/reviewarc
base64 -i /path/to/AuthKey_KEYID.p8 | gh secret set APPLE_NOTARY_KEY_P8_BASE64 --env release --repo strantalis/reviewarc
```

Run the remaining `gh secret set` commands interactively so secret values are read from the terminal, not shell history.

## Sparkle signing key

ReviewArc uses Sparkle's Ed25519 signature in addition to Apple code signing and notarization. The signature authenticates the exact final DMG that the updater downloads. Generate the key once from the pinned Sparkle distribution and keep its private half out of the repository and Blob store:

```sh
./bin/generate_keys --account reviewarc
./bin/generate_keys --account reviewarc -x /secure/path/reviewarc-sparkle-private-key
base64 -i /secure/path/reviewarc-sparkle-private-key | gh secret set SPARKLE_ED25519_PRIVATE_KEY_BASE64 --env release --repo strantalis/reviewarc
```

Copy the public value printed by `generate_keys` to the protected environment variable `SPARKLE_PUBLIC_ED_KEY`. Back up the exported private key in the LLC's credential vault; losing it requires a carefully staged key rotation.

The workflow downloads Sparkle 2.9.2 from its official GitHub release and verifies SHA-256 `1cb340cbbef04c6c0d162078610c25e2221031d794a3449d89f2f56f4df77c95` before using either the framework or `sign_update`. Update the version, URL, and checksum together in `build/darwin/updater/sparkle.env`; both developer and release fetchers read that file.

The app embeds `SUPublicEDKey`, `SUFeedURL`, and verification settings in its final `Info.plist`. `SUVerifyUpdateBeforeExtraction` is enabled. `SURequireSignedFeed` is intentionally not enabled: the DMG enclosure is signed, but the dynamically assembled appcast itself is not. See Sparkle's [security setup](https://sparkle-project.org/documentation/) and [publishing guide](https://sparkle-project.org/documentation/publishing/).

## Vercel project and Blob store

Create the site project under the intended Vercel team with `site/` as its Root Directory, connect the GitHub repository, and use `main` as the production branch. Connect a public Blob store dedicated to ReviewArc releases and upgrade the project connection to OIDC. Vercel then injects short-lived workload identity and `BLOB_STORE_ID` into the site's release endpoint; the site does not need a long-lived Blob token.

The release workflow still needs the Blob store's read-write token as `BLOB_READ_WRITE_TOKEN` because GitHub Actions is outside Vercel's workload identity boundary. It uploads immutable versioned DMGs and manifests, verifies the downloaded DMG checksum, then promotes either `channels/beta/latest.json` or `channels/stable/latest.json`. The Astro site's existing `/api/release.json` endpoint continues to read stable first and fall back to beta only when no stable manifest exists, so release publication does not redeploy the site and GitHub Actions needs no Vercel deployment token.

The updater reads `/api/appcast.xml`. That feed validates both current channel manifests and includes:

- the monotonic GitHub run number as `sparkle:version`;
- the full SemVer, including any prerelease suffix, as `sparkle:shortVersionString`;
- the DMG byte length and Sparkle Ed25519 signature;
- stable releases on Sparkle's default channel;
- beta releases on the `beta` Sparkle channel.

A Stable client therefore ignores beta items. A Beta client is allowed to consider beta and default-channel items, which lets it move forward to a newer GA release. ReviewArc has no downgrade path.

The Blob store is public because the DMG is a public download. Configure Vercel spend alerts before sharing releases broadly.

## Publishing

Before creating a version tag, add user-facing notes for that version to `site/src/lib/release-notes.ts` and let the `main` deployment complete. Every release manifest points to `https://www.reviewarc.dev/releases/v<version>`, where the site reads the immutable signed release metadata and combines it with those notes. The appcast canonicalizes older GitHub release links to the public ReviewArc page during the migration away from private repository URLs.

After all environment protection and credentials are configured, create a signed version tag on a commit already present on `origin/main`. Use a prerelease suffix for beta builds and omit it for stable releases:

```sh
git tag -s v0.1.0-beta.1 -m "ReviewArc 0.1.0 beta 1"
git push origin v0.1.0-beta.1
```

The first job builds, signs, notarizes, staples, verifies, Sparkle-signs, and preserves the exact candidate as a private Actions artifact. Sparkle signing reads but does not modify the final DMG. The second job publishes that preserved candidate. If publication fails, rerun only the failed job so the exact notarized bytes are reused.

## Pausing an update channel

If a release is unsafe, run the **Release macOS** workflow manually, choose `stable` or `beta`, and select `pause`. Supply a short, non-sensitive reason. The protected `release` environment applies its normal reviewer controls before the workflow writes `channels/<channel>/policy.json`.

The appcast omits every paused channel. `/api/release.json` is deliberately unaffected so the public website's current download behavior does not change. Pausing does not delete immutable artifacts, alter installed apps, or roll users backward. Publish a higher fixed build, then run the workflow with `resume` after validating it. A malformed or unreadable policy makes the appcast fail closed with no update.

Before calling any release distributable, download the DMG through the public site on a clean Mac, confirm Gatekeeper accepts it, drag ReviewArc to Applications, launch it, and exercise dependency detection plus GitHub authentication. Test on both Apple Silicon and Intel hardware before claiming both architectures are supported end to end.
