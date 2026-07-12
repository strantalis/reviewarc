const download = document.querySelector("#download");
const releaseMeta = document.querySelector("#release-meta");

const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

fetch("/release.json", { cache: "no-store" })
  .then((response) => {
    if (!response.ok) throw new Error(`release manifest returned ${response.status}`);
    return response.json();
  })
  .then((release) => {
    const artifact = release.macOS;
    const validHash = /^[a-f0-9]{64}$/.test(artifact?.sha256 ?? "");
    const validUrl = artifact?.downloadUrl?.startsWith("https://");
    if (release.schemaVersion !== 1 || artifact?.notarization?.status !== "accepted" || !validHash || !validUrl) {
      throw new Error("release manifest is not publishable");
    }
    download.href = artifact.downloadUrl;
    download.removeAttribute("aria-disabled");
    download.classList.remove("is-loading");
    download.querySelector("span").textContent = `Download beta ${release.version}`;
    download.querySelector("small").textContent = `Universal macOS · ${formatBytes(artifact.sizeBytes)}`;
    releaseMeta.textContent = `Apple notarized · SHA-256 ${artifact.sha256.slice(0, 12)}…`;
  })
  .catch(() => {
    releaseMeta.textContent = "The first notarized beta is being prepared.";
  });
