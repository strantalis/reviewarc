type ReleaseManifest = {
  schemaVersion: 1;
  channel: "beta" | "stable";
  version: string;
  macOS: {
    sizeBytes: number;
    sha256: string;
    downloadUrl: string;
    notarization: { status: "accepted" };
  };
};

const download = document.querySelector<HTMLAnchorElement>("#download");
const releaseMeta = document.querySelector<HTMLElement>("#release-meta");
const channelCopy = document.querySelector<HTMLElement>("#channel-copy");

const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const renderRelease = (release: ReleaseManifest) => {
  if (!download || !releaseMeta || !channelCopy) return;
  const artifact = release.macOS;
  const isBeta = release.channel === "beta";
  download.href = artifact.downloadUrl;
  download.removeAttribute("aria-disabled");
  download.classList.remove("is-loading");
  const title = download.querySelector("span");
  const detail = download.querySelector("small");
  if (title) title.textContent = isBeta ? `Download beta ${release.version}` : `Download ReviewArc ${release.version}`;
  if (detail) detail.textContent = `Universal macOS · ${formatBytes(artifact.sizeBytes)}`;
  channelCopy.textContent = isBeta ? "Private macOS beta" : "Notarized macOS release";
  releaseMeta.textContent = `Apple notarized · SHA-256 ${artifact.sha256.slice(0, 12)}…`;
};

const renderUnavailable = () => {
  if (releaseMeta) releaseMeta.textContent = "The first notarized release is being prepared.";
};

fetch("/api/release.json", { cache: "no-store" })
  .then((response) => {
    if (!response.ok) throw new Error(`release endpoint returned ${response.status}`);
    return response.json() as Promise<ReleaseManifest>;
  })
  .then(renderRelease)
  .catch(renderUnavailable);
