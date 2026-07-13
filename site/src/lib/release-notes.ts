export type PublicReleaseNotes = {
  summary: string;
  changes: string[];
};

const releaseNotes: Record<string, PublicReleaseNotes> = {
  "0.1.0-beta.5": {
    summary: "Update checks now finish cleanly when the selected channel has no newer release.",
    changes: [
      "Settings reports when ReviewArc is up to date instead of leaving the update check spinning.",
      "The last successful check time is shown, and the Check now action becomes available again.",
      "Failed checks keep their error detail and offer a clear Try again action.",
    ],
  },
  "0.1.0-beta.6": {
    summary: "Release information is now available publicly without access to the ReviewArc source repository.",
    changes: [
      "Release notes use versioned pages on reviewarc.dev.",
      "The desktop app opens only validated ReviewArc release-note links.",
      "Signed download details and checksums are visible on each public release page.",
    ],
  },
};

export function releaseNotesFor(version: string): PublicReleaseNotes | null {
  return releaseNotes[version] ?? null;
}
