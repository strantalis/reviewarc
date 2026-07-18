export namespace domain {

	export class EvidenceReference {
	    id: string;
	    path: string;
	    revision: string;
	    startLine: number;
	    endLine: number;
	    symbol?: string;
	    validationStatus: string;
	    validationMessage?: string;

	    static createFrom(source: any = {}) {
	        return new EvidenceReference(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.path = source["path"];
	        this.revision = source["revision"];
	        this.startLine = source["startLine"];
	        this.endLine = source["endLine"];
	        this.symbol = source["symbol"];
	        this.validationStatus = source["validationStatus"];
	        this.validationMessage = source["validationMessage"];
	    }
	}
	export class AffectedArea {
	    name: string;
	    description: string;
	    evidence: EvidenceReference[];
	    validationStatus: string;
	    validationMessage?: string;

	    static createFrom(source: any = {}) {
	        return new AffectedArea(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.description = source["description"];
	        this.evidence = this.convertValues(source["evidence"], EvidenceReference);
	        this.validationStatus = source["validationStatus"];
	        this.validationMessage = source["validationMessage"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ContextAccess {
	    kind: string;
	    path?: string;
	    revision?: string;
	    startLine?: number;
	    endLine?: number;
	    bytes?: number;
	    // Go type: time
	    at: any;

	    static createFrom(source: any = {}) {
	        return new ContextAccess(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.path = source["path"];
	        this.revision = source["revision"];
	        this.startLine = source["startLine"];
	        this.endLine = source["endLine"];
	        this.bytes = source["bytes"];
	        this.at = this.convertValues(source["at"], null);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DiffOmissionDecision {
	    path: string;
	    category: string;
	    reason: string;

	    static createFrom(source: any = {}) {
	        return new DiffOmissionDecision(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.category = source["category"];
	        this.reason = source["reason"];
	    }
	}
	export class AnalysisCoverage {
	    changedFilesTotal: number;
	    diffFilesFullyRead: number;
	    diffFilesPartiallyRead: number;
	    diffFilesPreviewed: number;
	    diffFilesUnseen: number;
	    diffFilesUnread: number;
	    diffBytesTotal: number;
	    diffBytesRead: number;
	    segments: number;
	    omittedPaths: string[];
	    previewedPaths: string[];
	    unseenPaths: string[];
	    previewDecisions?: DiffOmissionDecision[];
	    accesses: ContextAccess[];

	    static createFrom(source: any = {}) {
	        return new AnalysisCoverage(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.changedFilesTotal = source["changedFilesTotal"];
	        this.diffFilesFullyRead = source["diffFilesFullyRead"];
	        this.diffFilesPartiallyRead = source["diffFilesPartiallyRead"];
	        this.diffFilesPreviewed = source["diffFilesPreviewed"];
	        this.diffFilesUnseen = source["diffFilesUnseen"];
	        this.diffFilesUnread = source["diffFilesUnread"];
	        this.diffBytesTotal = source["diffBytesTotal"];
	        this.diffBytesRead = source["diffBytesRead"];
	        this.segments = source["segments"];
	        this.omittedPaths = source["omittedPaths"];
	        this.previewedPaths = source["previewedPaths"];
	        this.unseenPaths = source["unseenPaths"];
	        this.previewDecisions = this.convertValues(source["previewDecisions"], DiffOmissionDecision);
	        this.accesses = this.convertValues(source["accesses"], ContextAccess);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AnalysisFailure {
	    code: string;
	    title: string;
	    message: string;
	    action: string;
	    retryable: boolean;
	    technicalDetails?: string;

	    static createFrom(source: any = {}) {
	        return new AnalysisFailure(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.code = source["code"];
	        this.title = source["title"];
	        this.message = source["message"];
	        this.action = source["action"];
	        this.retryable = source["retryable"];
	        this.technicalDetails = source["technicalDetails"];
	    }
	}
	export class AnalysisProfile {
	    harness: string;
	    model: string;
	    reasoning: string;

	    static createFrom(source: any = {}) {
	        return new AnalysisProfile(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.harness = source["harness"];
	        this.model = source["model"];
	        this.reasoning = source["reasoning"];
	    }
	}
	export class AnalysisRun {
	    id: string;
	    sessionId: string;
	    profile: AnalysisProfile;
	    harnessVersion?: string;
	    contextTransport: string;
	    schemaVersion: number;
	    inputFingerprint: string;
	    coverage: AnalysisCoverage;
	    status: string;
	    failure?: AnalysisFailure;
	    // Go type: time
	    startedAt: any;
	    // Go type: time
	    completedAt?: any;
	    // Go type: time
	    updatedAt: any;

	    static createFrom(source: any = {}) {
	        return new AnalysisRun(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.sessionId = source["sessionId"];
	        this.profile = this.convertValues(source["profile"], AnalysisProfile);
	        this.harnessVersion = source["harnessVersion"];
	        this.contextTransport = source["contextTransport"];
	        this.schemaVersion = source["schemaVersion"];
	        this.inputFingerprint = source["inputFingerprint"];
	        this.coverage = this.convertValues(source["coverage"], AnalysisCoverage);
	        this.status = source["status"];
	        this.failure = this.convertValues(source["failure"], AnalysisFailure);
	        this.startedAt = this.convertValues(source["startedAt"], null);
	        this.completedAt = this.convertValues(source["completedAt"], null);
	        this.updatedAt = this.convertValues(source["updatedAt"], null);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AppPaths {
	    root: string;
	    repositories: string;
	    worktrees: string;
	    database: string;
	    logs: string;
	    cache: string;

	    static createFrom(source: any = {}) {
	        return new AppPaths(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.root = source["root"];
	        this.repositories = source["repositories"];
	        this.worktrees = source["worktrees"];
	        this.database = source["database"];
	        this.logs = source["logs"];
	        this.cache = source["cache"];
	    }
	}
	export class BehavioralChange {
	    id: string;
	    summary: string;
	    before: string;
	    after: string;
	    evidence: EvidenceReference[];
	    validationStatus: string;
	    validationMessage?: string;

	    static createFrom(source: any = {}) {
	        return new BehavioralChange(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.summary = source["summary"];
	        this.before = source["before"];
	        this.after = source["after"];
	        this.evidence = this.convertValues(source["evidence"], EvidenceReference);
	        this.validationStatus = source["validationStatus"];
	        this.validationMessage = source["validationMessage"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ReviewProgress {
	    total: number;
	    reviewed: number;
	    blocked: number;
	    clarify: number;
	    percent: number;

	    static createFrom(source: any = {}) {
	        return new ReviewProgress(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.total = source["total"];
	        this.reviewed = source["reviewed"];
	        this.blocked = source["blocked"];
	        this.clarify = source["clarify"];
	        this.percent = source["percent"];
	    }
	}
	export class RepositoryRef {
	    host: string;
	    owner: string;
	    name: string;
	    cloneUrl: string;
	    databaseId: string;

	    static createFrom(source: any = {}) {
	        return new RepositoryRef(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = source["host"];
	        this.owner = source["owner"];
	        this.name = source["name"];
	        this.cloneUrl = source["cloneUrl"];
	        this.databaseId = source["databaseId"];
	    }
	}
	export class PullRequestRef {
	    repository: RepositoryRef;
	    number: number;

	    static createFrom(source: any = {}) {
	        return new PullRequestRef(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.repository = this.convertValues(source["repository"], RepositoryRef);
	        this.number = source["number"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PullRequestSummary {
	    ref: PullRequestRef;
	    title: string;
	    url: string;
	    author: GitHubUser;
	    // Go type: time
	    updatedAt: any;
	    isDraft: boolean;
	    additions: number;
	    deletions: number;
	    changedFiles: number;
	    relationships: string[];
	    labels: string[];
	    analysisStatus: string;
	    progress: ReviewProgress;
	    riskLevel: string;
	    reviewDecision?: string;
	    baseSha?: string;
	    headSha?: string;
	    sessionId?: string;

	    static createFrom(source: any = {}) {
	        return new PullRequestSummary(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ref = this.convertValues(source["ref"], PullRequestRef);
	        this.title = source["title"];
	        this.url = source["url"];
	        this.author = this.convertValues(source["author"], GitHubUser);
	        this.updatedAt = this.convertValues(source["updatedAt"], null);
	        this.isDraft = source["isDraft"];
	        this.additions = source["additions"];
	        this.deletions = source["deletions"];
	        this.changedFiles = source["changedFiles"];
	        this.relationships = source["relationships"];
	        this.labels = source["labels"];
	        this.analysisStatus = source["analysisStatus"];
	        this.progress = this.convertValues(source["progress"], ReviewProgress);
	        this.riskLevel = source["riskLevel"];
	        this.reviewDecision = source["reviewDecision"];
	        this.baseSha = source["baseSha"];
	        this.headSha = source["headSha"];
	        this.sessionId = source["sessionId"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SourceSelection {
	    kind: string;
	    key: string;
	    enabled: boolean;

	    static createFrom(source: any = {}) {
	        return new SourceSelection(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.key = source["key"];
	        this.enabled = source["enabled"];
	    }
	}
	export class GitHubUser {
	    login: string;
	    name: string;
	    avatarUrl: string;

	    static createFrom(source: any = {}) {
	        return new GitHubUser(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.login = source["login"];
	        this.name = source["name"];
	        this.avatarUrl = source["avatarUrl"];
	    }
	}
	export class DependencyStatus {
	    name: string;
	    state: string;
	    path?: string;
	    version?: string;
	    message?: string;

	    static createFrom(source: any = {}) {
	        return new DependencyStatus(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.state = source["state"];
	        this.path = source["path"];
	        this.version = source["version"];
	        this.message = source["message"];
	    }
	}
	export class BootstrapState {
	    dependencies: DependencyStatus[];
	    paths: AppPaths;
	    account?: GitHubUser;
	    gitProtocol: string;
	    selections: SourceSelection[];
	    inbox: PullRequestSummary[];
	    environmentCached: boolean;

	    static createFrom(source: any = {}) {
	        return new BootstrapState(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dependencies = this.convertValues(source["dependencies"], DependencyStatus);
	        this.paths = this.convertValues(source["paths"], AppPaths);
	        this.account = this.convertValues(source["account"], GitHubUser);
	        this.gitProtocol = source["gitProtocol"];
	        this.selections = this.convertValues(source["selections"], SourceSelection);
	        this.inbox = this.convertValues(source["inbox"], PullRequestSummary);
	        this.environmentCached = source["environmentCached"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ChangedFile {
	    path: string;
	    previousPath: string;
	    status: string;
	    additions: number;
	    deletions: number;
	    isBinary: boolean;

	    static createFrom(source: any = {}) {
	        return new ChangedFile(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.previousPath = source["previousPath"];
	        this.status = source["status"];
	        this.additions = source["additions"];
	        this.deletions = source["deletions"];
	        this.isBinary = source["isBinary"];
	    }
	}
	export class ChapterProgress {
	    chapterId: string;
	    status: string;
	    // Go type: time
	    updatedAt: any;

	    static createFrom(source: any = {}) {
	        return new ChapterProgress(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.chapterId = source["chapterId"];
	        this.status = source["status"];
	        this.updatedAt = this.convertValues(source["updatedAt"], null);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CheckRun {
	    id: number;
	    name: string;
	    status: string;
	    conclusion?: string;
	    appName?: string;
	    url: string;
	    detailsUrl?: string;
	    // Go type: time
	    startedAt: any;
	    // Go type: time
	    completedAt: any;

	    static createFrom(source: any = {}) {
	        return new CheckRun(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.status = source["status"];
	        this.conclusion = source["conclusion"];
	        this.appName = source["appName"];
	        this.url = source["url"];
	        this.detailsUrl = source["detailsUrl"];
	        this.startedAt = this.convertValues(source["startedAt"], null);
	        this.completedAt = this.convertValues(source["completedAt"], null);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Claim {
	    id: string;
	    kind: string;
	    text: string;
	    evidence: EvidenceReference[];
	    validationStatus: string;
	    validationMessage?: string;

	    static createFrom(source: any = {}) {
	        return new Claim(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.kind = source["kind"];
	        this.text = source["text"];
	        this.evidence = this.convertValues(source["evidence"], EvidenceReference);
	        this.validationStatus = source["validationStatus"];
	        this.validationMessage = source["validationMessage"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Commit {
	    sha: string;
	    message: string;
	    author: GitHubUser;
	    // Go type: time
	    authoredAt: any;

	    static createFrom(source: any = {}) {
	        return new Commit(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sha = source["sha"];
	        this.message = source["message"];
	        this.author = this.convertValues(source["author"], GitHubUser);
	        this.authoredAt = this.convertValues(source["authoredAt"], null);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}


	export class DiffLine {
	    kind: string;
	    content: string;
	    oldLine?: number;
	    newLine?: number;

	    static createFrom(source: any = {}) {
	        return new DiffLine(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.content = source["content"];
	        this.oldLine = source["oldLine"];
	        this.newLine = source["newLine"];
	    }
	}
	export class DiffHunk {
	    header: string;
	    oldStart: number;
	    oldLines: number;
	    newStart: number;
	    newLines: number;
	    lines: DiffLine[];

	    static createFrom(source: any = {}) {
	        return new DiffHunk(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.header = source["header"];
	        this.oldStart = source["oldStart"];
	        this.oldLines = source["oldLines"];
	        this.newStart = source["newStart"];
	        this.newLines = source["newLines"];
	        this.lines = this.convertValues(source["lines"], DiffLine);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DiffFile {
	    file: ChangedFile;
	    hunks: DiffHunk[];
	    patch: string;

	    static createFrom(source: any = {}) {
	        return new DiffFile(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.file = this.convertValues(source["file"], ChangedFile);
	        this.hunks = this.convertValues(source["hunks"], DiffHunk);
	        this.patch = source["patch"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}



	export class EnvironmentState {
	    dependencies: DependencyStatus[];
	    account?: GitHubUser;
	    gitProtocol: string;
	    // Go type: time
	    refreshedAt: any;

	    static createFrom(source: any = {}) {
	        return new EnvironmentState(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dependencies = this.convertValues(source["dependencies"], DependencyStatus);
	        this.account = this.convertValues(source["account"], GitHubUser);
	        this.gitProtocol = source["gitProtocol"];
	        this.refreshedAt = this.convertValues(source["refreshedAt"], null);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

	export class FileContent {
	    path: string;
	    revision: string;
	    sha: string;
	    content: string;
	    isBinary: boolean;
	    lineCount: number;

	    static createFrom(source: any = {}) {
	        return new FileContent(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.revision = source["revision"];
	        this.sha = source["sha"];
	        this.content = source["content"];
	        this.isBinary = source["isBinary"];
	        this.lineCount = source["lineCount"];
	    }
	}
	export class FileReference {
	    path: string;
	    description: string;
	    validationStatus: string;
	    validationMessage?: string;

	    static createFrom(source: any = {}) {
	        return new FileReference(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.description = source["description"];
	        this.validationStatus = source["validationStatus"];
	        this.validationMessage = source["validationMessage"];
	    }
	}

	export class Organization {
	    login: string;
	    name: string;
	    avatarUrl: string;
	    accessStatus: string;
	    ssoUrl?: string;

	    static createFrom(source: any = {}) {
	        return new Organization(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.login = source["login"];
	        this.name = source["name"];
	        this.avatarUrl = source["avatarUrl"];
	        this.accessStatus = source["accessStatus"];
	        this.ssoUrl = source["ssoUrl"];
	    }
	}
	export class PullRequestReviewComment {
	    id: number;
	    reviewId: number;
	    replyToId?: number;
	    author: GitHubUser;
	    body: string;
	    path: string;
	    startLine?: number;
	    line?: number;
	    originalStartLine?: number;
	    originalLine?: number;
	    startSide?: string;
	    side?: string;
	    commitSha: string;
	    // Go type: time
	    createdAt: any;
	    // Go type: time
	    updatedAt: any;
	    url: string;

	    static createFrom(source: any = {}) {
	        return new PullRequestReviewComment(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.reviewId = source["reviewId"];
	        this.replyToId = source["replyToId"];
	        this.author = this.convertValues(source["author"], GitHubUser);
	        this.body = source["body"];
	        this.path = source["path"];
	        this.startLine = source["startLine"];
	        this.line = source["line"];
	        this.originalStartLine = source["originalStartLine"];
	        this.originalLine = source["originalLine"];
	        this.startSide = source["startSide"];
	        this.side = source["side"];
	        this.commitSha = source["commitSha"];
	        this.createdAt = this.convertValues(source["createdAt"], null);
	        this.updatedAt = this.convertValues(source["updatedAt"], null);
	        this.url = source["url"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PullRequestReview {
	    id: number;
	    author: GitHubUser;
	    state: string;
	    body: string;
	    commitSha: string;
	    // Go type: time
	    submittedAt: any;
	    url: string;

	    static createFrom(source: any = {}) {
	        return new PullRequestReview(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.author = this.convertValues(source["author"], GitHubUser);
	        this.state = source["state"];
	        this.body = source["body"];
	        this.commitSha = source["commitSha"];
	        this.submittedAt = this.convertValues(source["submittedAt"], null);
	        this.url = source["url"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PullRequest {
	    ref: PullRequestRef;
	    title: string;
	    url: string;
	    author: GitHubUser;
	    // Go type: time
	    updatedAt: any;
	    isDraft: boolean;
	    additions: number;
	    deletions: number;
	    changedFiles: number;
	    relationships: string[];
	    labels: string[];
	    analysisStatus: string;
	    progress: ReviewProgress;
	    riskLevel: string;
	    reviewDecision?: string;
	    baseSha?: string;
	    headSha?: string;
	    sessionId?: string;
	    body: string;
	    baseRef: string;
	    headRef: string;
	    headRepository: RepositoryRef;
	    commits: Commit[];
	    requestedReviewers: GitHubUser[];
	    assignees: GitHubUser[];
	    reviews: PullRequestReview[];
	    reviewComments: PullRequestReviewComment[];
	    checkRuns: CheckRun[];
	    reviewState: string;

	    static createFrom(source: any = {}) {
	        return new PullRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ref = this.convertValues(source["ref"], PullRequestRef);
	        this.title = source["title"];
	        this.url = source["url"];
	        this.author = this.convertValues(source["author"], GitHubUser);
	        this.updatedAt = this.convertValues(source["updatedAt"], null);
	        this.isDraft = source["isDraft"];
	        this.additions = source["additions"];
	        this.deletions = source["deletions"];
	        this.changedFiles = source["changedFiles"];
	        this.relationships = source["relationships"];
	        this.labels = source["labels"];
	        this.analysisStatus = source["analysisStatus"];
	        this.progress = this.convertValues(source["progress"], ReviewProgress);
	        this.riskLevel = source["riskLevel"];
	        this.reviewDecision = source["reviewDecision"];
	        this.baseSha = source["baseSha"];
	        this.headSha = source["headSha"];
	        this.sessionId = source["sessionId"];
	        this.body = source["body"];
	        this.baseRef = source["baseRef"];
	        this.headRef = source["headRef"];
	        this.headRepository = this.convertValues(source["headRepository"], RepositoryRef);
	        this.commits = this.convertValues(source["commits"], Commit);
	        this.requestedReviewers = this.convertValues(source["requestedReviewers"], GitHubUser);
	        this.assignees = this.convertValues(source["assignees"], GitHubUser);
	        this.reviews = this.convertValues(source["reviews"], PullRequestReview);
	        this.reviewComments = this.convertValues(source["reviewComments"], PullRequestReviewComment);
	        this.checkRuns = this.convertValues(source["checkRuns"], CheckRun);
	        this.reviewState = source["reviewState"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}




	export class Repository {
	    ref: RepositoryRef;
	    description: string;
	    isPrivate: boolean;
	    isArchived: boolean;
	    // Go type: time
	    updatedAt: any;

	    static createFrom(source: any = {}) {
	        return new Repository(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ref = this.convertValues(source["ref"], RepositoryRef);
	        this.description = source["description"];
	        this.isPrivate = source["isPrivate"];
	        this.isArchived = source["isArchived"];
	        this.updatedAt = this.convertValues(source["updatedAt"], null);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

	export class ValidationIssue {
	    code: string;
	    message: string;
	    evidenceId?: string;

	    static createFrom(source: any = {}) {
	        return new ValidationIssue(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.code = source["code"];
	        this.message = source["message"];
	        this.evidenceId = source["evidenceId"];
	    }
	}
	export class ReviewObservation {
	    id: string;
	    title: string;
	    description: string;
	    evidence: EvidenceReference[];

	    static createFrom(source: any = {}) {
	        return new ReviewObservation(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.description = source["description"];
	        this.evidence = this.convertValues(source["evidence"], EvidenceReference);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ReviewJudgment {
	    id: string;
	    title: string;
	    description: string;
	    kind: string;
	    level: string;
	    groupingRationale: string;
	    observations: ReviewObservation[];

	    static createFrom(source: any = {}) {
	        return new ReviewJudgment(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.description = source["description"];
	        this.kind = source["kind"];
	        this.level = source["level"];
	        this.groupingRationale = source["groupingRationale"];
	        this.observations = this.convertValues(source["observations"], ReviewObservation);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SuggestedQuestion {
	    id: string;
	    text: string;
	    rationale: string;
	    evidence: EvidenceReference[];

	    static createFrom(source: any = {}) {
	        return new SuggestedQuestion(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.text = source["text"];
	        this.rationale = source["rationale"];
	        this.evidence = this.convertValues(source["evidence"], EvidenceReference);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TestReference {
	    id: string;
	    path: string;
	    description: string;
	    evidence: EvidenceReference[];
	    relationship: string;

	    static createFrom(source: any = {}) {
	        return new TestReference(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.path = source["path"];
	        this.description = source["description"];
	        this.evidence = this.convertValues(source["evidence"], EvidenceReference);
	        this.relationship = source["relationship"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ReviewRisk {
	    id: string;
	    title: string;
	    description: string;
	    level: string;
	    evidence: EvidenceReference[];
	    validationStatus: string;
	    validationMessage?: string;

	    static createFrom(source: any = {}) {
	        return new ReviewRisk(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.description = source["description"];
	        this.level = source["level"];
	        this.evidence = this.convertValues(source["evidence"], EvidenceReference);
	        this.validationStatus = source["validationStatus"];
	        this.validationMessage = source["validationMessage"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SymbolReference {
	    path: string;
	    name: string;
	    evidence: EvidenceReference[];

	    static createFrom(source: any = {}) {
	        return new SymbolReference(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.name = source["name"];
	        this.evidence = this.convertValues(source["evidence"], EvidenceReference);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ReviewChapter {
	    id: string;
	    order: number;
	    title: string;
	    description: string;
	    purpose: string;
	    status: string;
	    evidence: EvidenceReference[];
	    files: FileReference[];
	    symbols: SymbolReference[];
	    behavioralChanges: BehavioralChange[];
	    risks: ReviewRisk[];
	    facts: Claim[];
	    inferences: Claim[];
	    unknowns: Claim[];
	    relatedTests: TestReference[];
	    suggestedQuestions: SuggestedQuestion[];

	    static createFrom(source: any = {}) {
	        return new ReviewChapter(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.order = source["order"];
	        this.title = source["title"];
	        this.description = source["description"];
	        this.purpose = source["purpose"];
	        this.status = source["status"];
	        this.evidence = this.convertValues(source["evidence"], EvidenceReference);
	        this.files = this.convertValues(source["files"], FileReference);
	        this.symbols = this.convertValues(source["symbols"], SymbolReference);
	        this.behavioralChanges = this.convertValues(source["behavioralChanges"], BehavioralChange);
	        this.risks = this.convertValues(source["risks"], ReviewRisk);
	        this.facts = this.convertValues(source["facts"], Claim);
	        this.inferences = this.convertValues(source["inferences"], Claim);
	        this.unknowns = this.convertValues(source["unknowns"], Claim);
	        this.relatedTests = this.convertValues(source["relatedTests"], TestReference);
	        this.suggestedQuestions = this.convertValues(source["suggestedQuestions"], SuggestedQuestion);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ReviewAnalysis {
	    schemaVersion: number;
	    baseSha: string;
	    headSha: string;
	    summary: string;
	    summaryEvidence: EvidenceReference[];
	    summaryValidation: string;
	    summaryMessage?: string;
	    affectedAreas: AffectedArea[];
	    chapters: ReviewChapter[];
	    behavioralChanges: BehavioralChange[];
	    risks: ReviewRisk[];
	    facts: Claim[];
	    inferences: Claim[];
	    unknowns: Claim[];
	    judgments?: ReviewJudgment[];
	    // Go type: time
	    createdAt: any;
	    validationIssues: ValidationIssue[];

	    static createFrom(source: any = {}) {
	        return new ReviewAnalysis(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.schemaVersion = source["schemaVersion"];
	        this.baseSha = source["baseSha"];
	        this.headSha = source["headSha"];
	        this.summary = source["summary"];
	        this.summaryEvidence = this.convertValues(source["summaryEvidence"], EvidenceReference);
	        this.summaryValidation = source["summaryValidation"];
	        this.summaryMessage = source["summaryMessage"];
	        this.affectedAreas = this.convertValues(source["affectedAreas"], AffectedArea);
	        this.chapters = this.convertValues(source["chapters"], ReviewChapter);
	        this.behavioralChanges = this.convertValues(source["behavioralChanges"], BehavioralChange);
	        this.risks = this.convertValues(source["risks"], ReviewRisk);
	        this.facts = this.convertValues(source["facts"], Claim);
	        this.inferences = this.convertValues(source["inferences"], Claim);
	        this.unknowns = this.convertValues(source["unknowns"], Claim);
	        this.judgments = this.convertValues(source["judgments"], ReviewJudgment);
	        this.createdAt = this.convertValues(source["createdAt"], null);
	        this.validationIssues = this.convertValues(source["validationIssues"], ValidationIssue);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

	export class ReviewComment {
	    id: string;
	    sessionId: string;
	    chapterId?: string;
	    kind: string;
	    body: string;
	    path?: string;
	    startLine?: number;
	    startSide?: string;
	    line?: number;
	    side?: string;
	    status: string;
	    githubId?: string;
	    githubUrl?: string;
	    // Go type: time
	    createdAt: any;
	    // Go type: time
	    updatedAt: any;

	    static createFrom(source: any = {}) {
	        return new ReviewComment(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.sessionId = source["sessionId"];
	        this.chapterId = source["chapterId"];
	        this.kind = source["kind"];
	        this.body = source["body"];
	        this.path = source["path"];
	        this.startLine = source["startLine"];
	        this.startSide = source["startSide"];
	        this.line = source["line"];
	        this.side = source["side"];
	        this.status = source["status"];
	        this.githubId = source["githubId"];
	        this.githubUrl = source["githubUrl"];
	        this.createdAt = this.convertValues(source["createdAt"], null);
	        this.updatedAt = this.convertValues(source["updatedAt"], null);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

	export class ReviewNote {
	    id: string;
	    sessionId: string;
	    chapterId?: string;
	    body: string;
	    // Go type: time
	    createdAt: any;
	    // Go type: time
	    updatedAt: any;

	    static createFrom(source: any = {}) {
	        return new ReviewNote(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.sessionId = source["sessionId"];
	        this.chapterId = source["chapterId"];
	        this.body = source["body"];
	        this.createdAt = this.convertValues(source["createdAt"], null);
	        this.updatedAt = this.convertValues(source["updatedAt"], null);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}



	export class ReviewSession {
	    id: string;
	    pullRequest: PullRequest;
	    baseSha: string;
	    headSha: string;
	    status: string;
	    analysisStatus: string;
	    analysis?: ReviewAnalysis;
	    latestAnalysisRun?: AnalysisRun;
	    chapters: ChapterProgress[];
	    notes: ReviewNote[];
	    comments: ReviewComment[];
	    progress: ReviewProgress;
	    isStale: boolean;
	    staleReason?: string;
	    // Go type: time
	    createdAt: any;
	    // Go type: time
	    updatedAt: any;

	    static createFrom(source: any = {}) {
	        return new ReviewSession(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.pullRequest = this.convertValues(source["pullRequest"], PullRequest);
	        this.baseSha = source["baseSha"];
	        this.headSha = source["headSha"];
	        this.status = source["status"];
	        this.analysisStatus = source["analysisStatus"];
	        this.analysis = this.convertValues(source["analysis"], ReviewAnalysis);
	        this.latestAnalysisRun = this.convertValues(source["latestAnalysisRun"], AnalysisRun);
	        this.chapters = this.convertValues(source["chapters"], ChapterProgress);
	        this.notes = this.convertValues(source["notes"], ReviewNote);
	        this.comments = this.convertValues(source["comments"], ReviewComment);
	        this.progress = this.convertValues(source["progress"], ReviewProgress);
	        this.isStale = source["isStale"];
	        this.staleReason = source["staleReason"];
	        this.createdAt = this.convertValues(source["createdAt"], null);
	        this.updatedAt = this.convertValues(source["updatedAt"], null);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}





}

export namespace main {

	export class AccessibleRepositoryRefresh {
	    syncId: string;
	    processed: number;
	    totalCount: number;
	    endCursor?: string;
	    hasNextPage: boolean;
	    completedAt?: string;

	    static createFrom(source: any = {}) {
	        return new AccessibleRepositoryRefresh(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.syncId = source["syncId"];
	        this.processed = source["processed"];
	        this.totalCount = source["totalCount"];
	        this.endCursor = source["endCursor"];
	        this.hasNextPage = source["hasNextPage"];
	        this.completedAt = source["completedAt"];
	    }
	}
	export class AccessibleRepositoryRefreshInput {
	    account: string;
	    syncId: string;
	    cursor: string;

	    static createFrom(source: any = {}) {
	        return new AccessibleRepositoryRefreshInput(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.account = source["account"];
	        this.syncId = source["syncId"];
	        this.cursor = source["cursor"];
	    }
	}
	export class AccessibleRepositorySearchInput {
	    account: string;
	    query: string;
	    offset: number;

	    static createFrom(source: any = {}) {
	        return new AccessibleRepositorySearchInput(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.account = source["account"];
	        this.query = source["query"];
	        this.offset = source["offset"];
	    }
	}
	export class AccountState {
	    status: string;
	    user?: domain.GitHubUser;
	    message?: string;

	    static createFrom(source: any = {}) {
	        return new AccountState(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.user = this.convertValues(source["user"], domain.GitHubUser);
	        this.message = source["message"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ReasoningLevelDescriptor {
	    id: string;
	    label: string;
	    recommended: boolean;

	    static createFrom(source: any = {}) {
	        return new ReasoningLevelDescriptor(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.recommended = source["recommended"];
	    }
	}
	export class HarnessModelDescriptor {
	    id: string;
	    label: string;
	    reasoningLevels: ReasoningLevelDescriptor[];
	    recommended: boolean;

	    static createFrom(source: any = {}) {
	        return new HarnessModelDescriptor(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.reasoningLevels = this.convertValues(source["reasoningLevels"], ReasoningLevelDescriptor);
	        this.recommended = source["recommended"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class HarnessCapabilitySummary {
	    jsonSchema: boolean;
	    readOnly: boolean;
	    progress: boolean;
	    contextTransport: string[];

	    static createFrom(source: any = {}) {
	        return new HarnessCapabilitySummary(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.jsonSchema = source["jsonSchema"];
	        this.readOnly = source["readOnly"];
	        this.progress = source["progress"];
	        this.contextTransport = source["contextTransport"];
	    }
	}
	export class HarnessDescriptor {
	    id: string;
	    label: string;
	    availability: string;
	    path?: string;
	    version?: string;
	    message?: string;
	    eligible: boolean;
	    capabilities: HarnessCapabilitySummary;
	    models: HarnessModelDescriptor[];
	    customModel?: HarnessModelDescriptor;

	    static createFrom(source: any = {}) {
	        return new HarnessDescriptor(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.availability = source["availability"];
	        this.path = source["path"];
	        this.version = source["version"];
	        this.message = source["message"];
	        this.eligible = source["eligible"];
	        this.capabilities = this.convertValues(source["capabilities"], HarnessCapabilitySummary);
	        this.models = this.convertValues(source["models"], HarnessModelDescriptor);
	        this.customModel = this.convertValues(source["customModel"], HarnessModelDescriptor);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AnalysisConfiguration {
	    defaultProfile?: domain.AnalysisProfile;
	    harnesses: HarnessDescriptor[];
	    // Go type: time
	    refreshedAt: any;

	    static createFrom(source: any = {}) {
	        return new AnalysisConfiguration(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.defaultProfile = this.convertValues(source["defaultProfile"], domain.AnalysisProfile);
	        this.harnesses = this.convertValues(source["harnesses"], HarnessDescriptor);
	        this.refreshedAt = this.convertValues(source["refreshedAt"], null);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class AnalysisRequest {
	    profile?: domain.AnalysisProfile;
	    saveAsDefault: boolean;

	    static createFrom(source: any = {}) {
	        return new AnalysisRequest(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.profile = this.convertValues(source["profile"], domain.AnalysisProfile);
	        this.saveAsDefault = source["saveAsDefault"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CommentInput {
	    id: string;
	    sessionId: string;
	    chapterId: string;
	    kind: string;
	    body: string;
	    path: string;
	    startLine?: number;
	    startSide: string;
	    line?: number;
	    side: string;

	    static createFrom(source: any = {}) {
	        return new CommentInput(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.sessionId = source["sessionId"];
	        this.chapterId = source["chapterId"];
	        this.kind = source["kind"];
	        this.body = source["body"];
	        this.path = source["path"];
	        this.startLine = source["startLine"];
	        this.startSide = source["startSide"];
	        this.line = source["line"];
	        this.side = source["side"];
	    }
	}



	export class Operation {
	    id: string;
	    sessionId?: string;
	    kind: string;
	    stage: string;
	    state: string;
	    message: string;
	    progress?: number;
	    runId?: string;
	    failure?: domain.AnalysisFailure;
	    // Go type: time
	    updatedAt: any;

	    static createFrom(source: any = {}) {
	        return new Operation(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.sessionId = source["sessionId"];
	        this.kind = source["kind"];
	        this.stage = source["stage"];
	        this.state = source["state"];
	        this.message = source["message"];
	        this.progress = source["progress"];
	        this.runId = source["runId"];
	        this.failure = this.convertValues(source["failure"], domain.AnalysisFailure);
	        this.updatedAt = this.convertValues(source["updatedAt"], null);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class InboxAnalysis {
	    session: domain.ReviewSession;
	    operation: Operation;

	    static createFrom(source: any = {}) {
	        return new InboxAnalysis(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.session = this.convertValues(source["session"], domain.ReviewSession);
	        this.operation = this.convertValues(source["operation"], Operation);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class InboxState {
	    items: domain.PullRequestSummary[];
	    errors: Record<string, string>;
	    partial: boolean;

	    static createFrom(source: any = {}) {
	        return new InboxState(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.items = this.convertValues(source["items"], domain.PullRequestSummary);
	        this.errors = source["errors"];
	        this.partial = source["partial"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class NoteInput {
	    id: string;
	    sessionId: string;
	    chapterId: string;
	    body: string;

	    static createFrom(source: any = {}) {
	        return new NoteInput(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.sessionId = source["sessionId"];
	        this.chapterId = source["chapterId"];
	        this.body = source["body"];
	    }
	}

	export class OperationSnapshot {
	    operation: Operation;
	    events: Operation[];

	    static createFrom(source: any = {}) {
	        return new OperationSnapshot(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.operation = this.convertValues(source["operation"], Operation);
	        this.events = this.convertValues(source["events"], Operation);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PublishItem {
	    draftId: string;
	    kind: string;
	    body: string;
	    path?: string;
	    startLine?: number;
	    startSide?: string;
	    line?: number;
	    side?: string;

	    static createFrom(source: any = {}) {
	        return new PublishItem(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.draftId = source["draftId"];
	        this.kind = source["kind"];
	        this.body = source["body"];
	        this.path = source["path"];
	        this.startLine = source["startLine"];
	        this.startSide = source["startSide"];
	        this.line = source["line"];
	        this.side = source["side"];
	    }
	}
	export class PublishPreview {
	    token: string;
	    digest: string;
	    repository: string;
	    number: number;
	    headSha: string;
	    items: PublishItem[];
	    event: string;
	    // Go type: time
	    expiresAt: any;

	    static createFrom(source: any = {}) {
	        return new PublishPreview(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.token = source["token"];
	        this.digest = source["digest"];
	        this.repository = source["repository"];
	        this.number = source["number"];
	        this.headSha = source["headSha"];
	        this.items = this.convertValues(source["items"], PublishItem);
	        this.event = source["event"];
	        this.expiresAt = this.convertValues(source["expiresAt"], null);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

	export class RepositoryPage {
	    items: domain.Repository[];
	    totalCount: number;
	    endCursor?: string;
	    hasNextPage: boolean;
	    cached: boolean;
	    refreshRequired?: boolean;
	    lastSyncedAt?: string;

	    static createFrom(source: any = {}) {
	        return new RepositoryPage(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.items = this.convertValues(source["items"], domain.Repository);
	        this.totalCount = source["totalCount"];
	        this.endCursor = source["endCursor"];
	        this.hasNextPage = source["hasNextPage"];
	        this.cached = source["cached"];
	        this.refreshRequired = source["refreshRequired"];
	        this.lastSyncedAt = source["lastSyncedAt"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class RepositoryPageInput {
	    owner: string;
	    cursor: string;

	    static createFrom(source: any = {}) {
	        return new RepositoryPageInput(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.owner = source["owner"];
	        this.cursor = source["cursor"];
	    }
	}
	export class RepositorySearchInput {
	    owner: string;
	    query: string;
	    cursor: string;
	    organization: boolean;

	    static createFrom(source: any = {}) {
	        return new RepositorySearchInput(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.owner = source["owner"];
	        this.query = source["query"];
	        this.cursor = source["cursor"];
	        this.organization = source["organization"];
	    }
	}
	export class SelectedRepositoryRefresh {
	    repositories: domain.Repository[];
	    archivedKeys: string[];
	    errors: Record<string, string>;

	    static createFrom(source: any = {}) {
	        return new SelectedRepositoryRefresh(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.repositories = this.convertValues(source["repositories"], domain.Repository);
	        this.archivedKeys = source["archivedKeys"];
	        this.errors = source["errors"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SoftwareUpdateStatus {
	    state: string;
	    channel: string;
	    // Go type: update
	    release?: any;
	    downloadedBytes: number;
	    totalBytes: number;
	    // Go type: time
	    lastCheckedAt?: any;
	    checkMode?: string;
	    error: string;
	    errorVisible: boolean;
	    currentVersion: string;
	    currentBuild: string;

	    static createFrom(source: any = {}) {
	        return new SoftwareUpdateStatus(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.state = source["state"];
	        this.channel = source["channel"];
	        this.release = this.convertValues(source["release"], null);
	        this.downloadedBytes = source["downloadedBytes"];
	        this.totalBytes = source["totalBytes"];
	        this.lastCheckedAt = this.convertValues(source["lastCheckedAt"], null);
	        this.checkMode = source["checkMode"];
	        this.error = source["error"];
	        this.errorVisible = source["errorVisible"];
	        this.currentVersion = source["currentVersion"];
	        this.currentBuild = source["currentBuild"];
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SourceState {
	    organizations: domain.Organization[];
	    repositories: domain.Repository[];
	    selections: domain.SourceSelection[];

	    static createFrom(source: any = {}) {
	        return new SourceState(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.organizations = this.convertValues(source["organizations"], domain.Organization);
	        this.repositories = this.convertValues(source["repositories"], domain.Repository);
	        this.selections = this.convertValues(source["selections"], domain.SourceSelection);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ThreadReplyPreview {
	    token: string;
	    digest: string;
	    repository: string;
	    number: number;
	    headSha: string;
	    rootCommentId: number;
	    rootAuthor: string;
	    path: string;
	    body: string;
	    // Go type: time
	    expiresAt: any;

	    static createFrom(source: any = {}) {
	        return new ThreadReplyPreview(source);
	    }

	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.token = source["token"];
	        this.digest = source["digest"];
	        this.repository = source["repository"];
	        this.number = source["number"];
	        this.headSha = source["headSha"];
	        this.rootCommentId = source["rootCommentId"];
	        this.rootAuthor = source["rootAuthor"];
	        this.path = source["path"];
	        this.body = source["body"];
	        this.expiresAt = this.convertValues(source["expiresAt"], null);
	    }

		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}
