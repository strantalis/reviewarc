type ReleaseManifest = {
  schemaVersion: 1;
  channel: "beta" | "stable";
  version: string;
  releaseNotesUrl: string;
  macOS: {
    minimumVersion: string;
    sizeBytes: number;
    sha256: string;
    downloadUrl: string;
    notarization: { status: "accepted" };
  };
};

const releaseActions = Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-release-action]"));
const releaseMeta = document.querySelector<HTMLElement>("#release-meta");
const releaseStatus = document.querySelector<HTMLElement>("#release-status");
const retryRelease = document.querySelector<HTMLButtonElement>("#retry-release");
const releaseDetails = document.querySelector<HTMLAnchorElement>("#release-details");
const releaseSecondary = document.querySelector<HTMLAnchorElement>("[data-release-secondary]");

const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

type ReleaseActionState = "loading" | "ready" | "recovery";

const updateReleaseActions = ({
  titleCopy,
  detailCopy,
  compactCopy,
  state,
  href,
  accessibleLabel,
}: {
  titleCopy: string;
  detailCopy: string;
  compactCopy: string;
  state: ReleaseActionState;
  href?: string;
  accessibleLabel: string;
}) => {
  for (const action of releaseActions) {
    const title = action.querySelector<HTMLElement>("[data-release-title]");
    const detail = action.querySelector<HTMLElement>("[data-release-detail]");
    if (title) title.textContent = titleCopy;
    if (detail) detail.textContent = detailCopy;
    if (!title) action.textContent = compactCopy;

    action.classList.toggle("is-loading", state === "loading");
    action.classList.toggle("is-recovery", state === "recovery");
    action.setAttribute("aria-label", accessibleLabel);

    if (href) {
      action.href = href;
      action.removeAttribute("aria-disabled");
    } else {
      action.removeAttribute("href");
      action.setAttribute("aria-disabled", "true");
    }
  }
  if (releaseSecondary) releaseSecondary.hidden = state === "recovery";
};

const setStatus = (state: "loading" | "ready" | "empty" | "error", message: string) => {
  if (releaseStatus) {
    releaseStatus.dataset.state = state;
    releaseStatus.setAttribute("aria-busy", state === "loading" ? "true" : "false");
  }
  if (releaseMeta) releaseMeta.textContent = message;
};

const renderRelease = (release: ReleaseManifest) => {
  const artifact = release.macOS;
  updateReleaseActions({
    titleCopy: `Download ReviewArc ${release.version}`,
    detailCopy: `Signed macOS build · ${formatBytes(artifact.sizeBytes)}`,
    compactCopy: "Download",
    state: "ready",
    href: artifact.downloadUrl,
    accessibleLabel: `Download ReviewArc ${release.version} for macOS`,
  });
  setStatus("ready", `Signed and verified · SHA-256 ${artifact.sha256.slice(0, 12)}…`);
  if (releaseDetails) {
    releaseDetails.href = `/releases/v${release.version}/`;
    releaseDetails.textContent = "Release notes and checksum";
    releaseDetails.hidden = false;
  }
  if (retryRelease) retryRelease.hidden = true;
};

const renderNoRelease = () => {
  updateReleaseActions({
    titleCopy: "View setup requirements",
    detailCopy: "Public release coming soon",
    compactCopy: "Setup",
    state: "recovery",
    href: "/docs/getting-started/",
    accessibleLabel: "View ReviewArc setup requirements",
  });
  setStatus("empty", "A public build isn’t available yet.");
  if (releaseDetails) releaseDetails.hidden = true;
  if (retryRelease) retryRelease.hidden = true;
};

const renderReleaseError = () => {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  updateReleaseActions({
    titleCopy: "View setup requirements",
    detailCopy: "Download temporarily unavailable",
    compactCopy: "Setup",
    state: "recovery",
    href: "/docs/getting-started/",
    accessibleLabel: "View ReviewArc setup requirements",
  });
  setStatus(
    "error",
    offline
      ? "You appear to be offline. Reconnect, then try again."
      : "The latest signed build couldn’t be verified."
  );
  if (releaseDetails) releaseDetails.hidden = true;
  if (retryRelease) retryRelease.hidden = false;
};

let activeRequest: AbortController | null = null;

const loadRelease = async () => {
  activeRequest?.abort();
  activeRequest = new AbortController();
  updateReleaseActions({
    titleCopy: "Checking signed release",
    detailCopy: "Signed macOS build",
    compactCopy: "Checking…",
    state: "loading",
    accessibleLabel: "Checking ReviewArc release availability",
  });
  setStatus("loading", "Checking the latest signed build…");
  if (releaseDetails) releaseDetails.hidden = true;
  if (retryRelease) retryRelease.hidden = true;

  try {
    const response = await fetch("/api/release.json", { cache: "no-store", signal: activeRequest.signal });
    if (response.status === 404) {
      renderNoRelease();
      return;
    }
    if (!response.ok) throw new Error(`release endpoint returned ${response.status}`);
    renderRelease(await response.json() as ReleaseManifest);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    renderReleaseError();
  }
};

retryRelease?.addEventListener("click", loadRelease);
void loadRelease();
