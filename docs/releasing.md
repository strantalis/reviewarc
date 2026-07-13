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

Add these environment secrets:

- `APPLE_DEVELOPER_ID_P12_BASE64`: base64 encoding of the `.p12` archive
- `APPLE_DEVELOPER_ID_P12_PASSWORD`: password used when the `.p12` was exported
- `APPLE_NOTARY_KEY_P8_BASE64`: base64 encoding of the App Store Connect `.p8` key
- `APPLE_NOTARY_KEY_ID`
- `APPLE_NOTARY_ISSUER_ID`
- `BLOB_READ_WRITE_TOKEN`

Load file-backed secrets without printing their contents:

```sh
base64 -i /path/to/developer-id.p12 | gh secret set APPLE_DEVELOPER_ID_P12_BASE64 --env release --repo strantalis/reviewarc
base64 -i /path/to/AuthKey_KEYID.p8 | gh secret set APPLE_NOTARY_KEY_P8_BASE64 --env release --repo strantalis/reviewarc
```

Run the remaining `gh secret set` commands interactively so secret values are read from the terminal, not shell history.

## Vercel project and Blob store

Create the site project under the intended Vercel team with `site/` as its Root Directory, connect the GitHub repository, and use `main` as the production branch. Connect a public Blob store dedicated to ReviewArc releases and upgrade the project connection to OIDC. Vercel then injects short-lived workload identity and `BLOB_STORE_ID` into the site's release endpoint; the site does not need a long-lived Blob token.

The release workflow still needs the Blob store's read-write token as `BLOB_READ_WRITE_TOKEN` because GitHub Actions is outside Vercel's workload identity boundary. It uploads immutable versioned DMGs and manifests, verifies the downloaded DMG checksum, then promotes either `channels/beta/latest.json` or `channels/stable/latest.json`. The Astro site reads stable first and falls back to beta only when no stable manifest exists, so release publication does not redeploy the site and GitHub Actions needs no Vercel deployment token.

The Blob store is public because the DMG is a public download. Configure Vercel spend alerts before sharing releases broadly.

## Publishing

After all environment protection and credentials are configured, create a signed version tag on a commit already present on `origin/main`. Use a prerelease suffix for beta builds and omit it for stable releases:

```sh
git tag -s v0.1.0-beta.1 -m "ReviewArc 0.1.0 beta 1"
git push origin v0.1.0-beta.1
```

The first job builds, signs, notarizes, verifies, and preserves the exact candidate as a private Actions artifact. The second job publishes that preserved candidate. If publication fails, rerun only the failed job so the exact notarized bytes are reused.

Before calling any release distributable, download the DMG through the public site on a clean Mac, confirm Gatekeeper accepts it, drag ReviewArc to Applications, launch it, and exercise dependency detection plus GitHub authentication. Test on both Apple Silicon and Intel hardware before claiming both architectures are supported end to end.
