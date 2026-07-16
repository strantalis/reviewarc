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
  "0.1.0-beta.8": {
    summary: "ReviewArc now opens large organizations and pull requests faster while keeping the app responsive.",
    changes: [
      "Startup restores the last inbox and environment immediately while fresh GitHub data loads in the background.",
      "Repository and pull-request discovery is bounded and paginated so large organizations do not stall the app.",
      "Pull requests open before secondary files, comments, reviews, and checks finish loading.",
      "Guided reviews surface the review brief, highest-risk starting point, and stale-analysis recovery more clearly.",
    ],
  },
  "0.1.0-beta.9": {
    summary: "Guided analysis is now configurable, artifact-first, and available through Codex or Claude Code.",
    changes: [
      "Choose an available analysis harness, model, and reasoning level without adding complexity to the normal review flow.",
      "Large pull requests stay in bounded local artifacts instead of being embedded wholesale in the initial model prompt.",
      "Analysis progress, context coverage, provenance, and failures are persisted and surfaced more clearly.",
      "ReviewArc remains usable for inbox and existing-review workflows when no compatible AI harness is installed.",
    ],
  },
  "0.1.0-beta.10": {
    summary: "Pull-request analysis is now safer to start, queue, monitor, and act on from the inbox.",
    changes: [
      "Start or rerun analysis directly from any inbox row, with compact actions and clear queued, running, and stale states.",
      "Multiple pull requests can wait in a durable local queue while ReviewArc limits concurrent AI work and recovers pending jobs after a restart.",
      "Canceling active analysis stops its local AI process, while queued work can be removed before it starts.",
      "Stale analysis must be refreshed before approving a pull request or requesting changes.",
      "Live model activity, progress, coverage, and Claude harness compatibility are clearer and more reliable.",
    ],
  },
};

export function releaseNotesFor(version: string): PublicReleaseNotes | null {
  return releaseNotes[version] ?? null;
}

export function releaseNoteVersions(): string[] {
  return Object.keys(releaseNotes);
}
