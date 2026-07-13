//go:build darwin && cgo && sparkle

#import "bridge.h"

#import <Cocoa/Cocoa.h>
#import <Sparkle/Sparkle.h>
#include <stdlib.h>
#include <string.h>

static NSString *const RAStateIdle = @"idle";
static NSString *const RAStateAvailable = @"available";
static NSString *const RAStateDownloading = @"downloading";
static NSString *const RAStateReady = @"ready";
static NSString *const RAStateFailed = @"failed";

@interface RAUpdaterBridge : NSObject <SPUUpdaterDelegate, SPUUserDriver>

@property(nonatomic, strong) SPUUpdater *updater;
@property(nonatomic, copy) NSString *feedURL;
@property(nonatomic) BOOL allowsBeta;
@property(nonatomic, copy) NSString *state;
@property(nonatomic, copy) NSString *version;
@property(nonatomic, copy) NSString *build;
@property(nonatomic, copy) NSString *releaseNotesURL;
@property(nonatomic, copy) NSString *failure;
@property(nonatomic) uint64_t receivedBytes;
@property(nonatomic) uint64_t totalBytes;
@property(nonatomic) uint64_t revision;
@property(nonatomic, copy) void (^readyReply)(SPUUserUpdateChoice);
@property(nonatomic, copy) void (^installOnQuit)(void);

- (BOOL)start:(NSError **)error;
- (void)recordState:(NSString *)state;
- (void)recordNoUpdate;
- (void)recordFailure:(NSError *)error;
- (void)recordRelease:(SUAppcastItem *)item;
- (NSDictionary<NSString *, id> *)status;
- (BOOL)installAndRestart:(NSError **)error;

@end

@implementation RAUpdaterBridge

- (instancetype)initWithFeedURL:(NSString *)feedURL allowsBeta:(BOOL)allowsBeta {
    self = [super init];
    if (self != nil) {
        _feedURL = [feedURL copy];
        _allowsBeta = allowsBeta;
        _state = RAStateIdle;
        _version = @"";
        _build = @"";
        _releaseNotesURL = @"";
        _failure = @"";
    }
    return self;
}

- (BOOL)start:(NSError **)error {
    NSBundle *bundle = [NSBundle mainBundle];
    self.updater = [[SPUUpdater alloc] initWithHostBundle:bundle
                                       applicationBundle:bundle
                                              userDriver:self
                                                delegate:self];
    if (![self.updater startUpdater:error]) {
        self.updater = nil;
        return NO;
    }

    // ReviewArc owns update scheduling and UI. Sparkle performs the requested
    // background downloads, while the retained installation handler below
    // keeps relaunch an explicit user action.
    self.updater.automaticallyChecksForUpdates = NO;
    self.updater.automaticallyDownloadsUpdates = YES;
    self.updater.sendsSystemProfile = NO;
    return YES;
}

- (void)recordState:(NSString *)state {
    self.state = state;
    if (![state isEqualToString:RAStateFailed]) {
        self.failure = @"";
    }
    self.revision += 1;
}

- (void)recordNoUpdate {
    self.version = @"";
    self.build = @"";
    self.releaseNotesURL = @"";
    self.receivedBytes = 0;
    self.totalBytes = 0;
    [self recordState:RAStateIdle];
}

- (void)recordFailure:(NSError *)error {
    self.failure = error.localizedDescription ?: @"Sparkle update failed";
    [self recordState:RAStateFailed];
}

- (void)recordRelease:(SUAppcastItem *)item {
    self.version = item.displayVersionString ?: @"";
    self.build = item.versionString ?: @"";
    self.releaseNotesURL = item.releaseNotesURL.absoluteString ?: @"";
}

- (NSDictionary<NSString *, id> *)status {
    return @{
        @"revision": @(self.revision),
        @"state": self.state,
        @"version": self.version,
        @"build": self.build,
        @"releaseNotesURL": self.releaseNotesURL,
        @"receivedBytes": @(self.receivedBytes),
        @"totalBytes": @(self.totalBytes),
        @"error": self.failure,
    };
}

- (BOOL)installAndRestart:(NSError **)error {
    if (self.readyReply != nil) {
        void (^reply)(SPUUserUpdateChoice) = self.readyReply;
        self.readyReply = nil;
        [self recordState:RAStateIdle];
        reply(SPUUserUpdateChoiceInstall);
        return YES;
    }
    if (self.installOnQuit != nil) {
        void (^install)(void) = self.installOnQuit;
        self.installOnQuit = nil;
        [self recordState:RAStateIdle];
        install();
        return YES;
    }

    if (error != NULL) {
        *error = [NSError errorWithDomain:@"com.silkcitylabs.reviewarc.updater"
                                    code:1
                                userInfo:@{NSLocalizedDescriptionKey: @"No update is ready to install"}];
    }
    return NO;
}

#pragma mark - SPUUpdaterDelegate

- (NSSet<NSString *> *)allowedChannelsForUpdater:(SPUUpdater *)updater {
    (void)updater;
    return self.allowsBeta ? [NSSet setWithObject:@"beta"] : [NSSet set];
}

- (NSString *)feedURLStringForUpdater:(SPUUpdater *)updater {
    (void)updater;
    return self.feedURL;
}

- (BOOL)updaterShouldPromptForPermissionToCheckForUpdates:(SPUUpdater *)updater {
    (void)updater;
    return NO;
}

- (void)updater:(SPUUpdater *)updater didFindValidUpdate:(SUAppcastItem *)item {
    (void)updater;
    [self recordRelease:item];
    [self recordState:RAStateAvailable];
}

- (void)updaterDidNotFindUpdate:(SPUUpdater *)updater error:(NSError *)error {
    (void)updater;
    (void)error;
    [self recordNoUpdate];
}

- (BOOL)updater:(SPUUpdater *)updater
        willInstallUpdateOnQuit:(SUAppcastItem *)item
    immediateInstallationBlock:(void (^)(void))immediateInstallHandler {
    (void)updater;
    [self recordRelease:item];
    self.installOnQuit = immediateInstallHandler;
    [self recordState:RAStateReady];
    return YES;
}

- (void)updater:(SPUUpdater *)updater didAbortWithError:(NSError *)error {
    (void)updater;
    if (error.code == SUNoUpdateError) {
        [self recordNoUpdate];
    } else {
        [self recordFailure:error];
    }
}

- (void)updater:(SPUUpdater *)updater
    didFinishUpdateCycleForUpdateCheck:(SPUUpdateCheck)updateCheck
                                 error:(NSError *)error {
    (void)updater;
    (void)updateCheck;

    // This is Sparkle's definitive end-of-cycle callback. Keep the more
    // specific callbacks above for immediate progress, but use completion as
    // a safety net so a successful no-update check still reports a terminal
    // state when an earlier presentation callback is skipped.
    if ([self.state isEqualToString:RAStateAvailable] ||
        [self.state isEqualToString:RAStateDownloading] ||
        [self.state isEqualToString:RAStateReady] ||
        [self.state isEqualToString:RAStateFailed]) {
        return;
    }
    if (error != nil && error.code != SUNoUpdateError) {
        [self recordFailure:error];
        return;
    }
    [self recordNoUpdate];
}

#pragma mark - SPUUserDriver

- (void)showUpdatePermissionRequest:(SPUUpdatePermissionRequest *)request
                              reply:(void (^)(SUUpdatePermissionResponse *))reply {
    (void)request;
    reply([[SUUpdatePermissionResponse alloc]
        initWithAutomaticUpdateChecks:NO sendSystemProfile:NO]);
}

- (void)showUserInitiatedUpdateCheckWithCancellation:(void (^)(void))cancellation {
    (void)cancellation;
}

- (void)showUpdateFoundWithAppcastItem:(SUAppcastItem *)item
                                  state:(SPUUserUpdateState *)state
                                  reply:(void (^)(SPUUserUpdateChoice))reply {
    [self recordRelease:item];
    if (item.isInformationOnlyUpdate) {
        reply(SPUUserUpdateChoiceDismiss);
        [self recordState:RAStateIdle];
        return;
    }

    if (state.stage == SPUUserUpdateStageInstalling) {
        self.readyReply = reply;
        [self recordState:RAStateReady];
        return;
    }

    [self recordState:RAStateDownloading];
    reply(SPUUserUpdateChoiceInstall);
}

- (void)showUpdateReleaseNotesWithDownloadData:(SPUDownloadData *)downloadData {
    (void)downloadData;
}

- (void)showUpdateReleaseNotesFailedToDownloadWithError:(NSError *)error {
    (void)error;
}

- (void)showUpdateNotFoundWithError:(NSError *)error
                    acknowledgement:(void (^)(void))acknowledgement {
    (void)error;
    [self recordNoUpdate];
    acknowledgement();
}

- (void)showUpdaterError:(NSError *)error acknowledgement:(void (^)(void))acknowledgement {
    [self recordFailure:error];
    acknowledgement();
}

- (void)showDownloadInitiatedWithCancellation:(void (^)(void))cancellation {
    (void)cancellation;
    self.receivedBytes = 0;
    self.totalBytes = 0;
    [self recordState:RAStateDownloading];
}

- (void)showDownloadDidReceiveExpectedContentLength:(uint64_t)expectedContentLength {
    self.totalBytes = expectedContentLength;
    if (self.totalBytes > 0 && self.receivedBytes > self.totalBytes) {
        self.receivedBytes = self.totalBytes;
    }
    self.revision += 1;
}

- (void)showDownloadDidReceiveDataOfLength:(uint64_t)length {
    self.receivedBytes += length;
    if (self.totalBytes > 0 && self.receivedBytes > self.totalBytes) {
        self.receivedBytes = self.totalBytes;
    }
    self.revision += 1;
}

- (void)showDownloadDidStartExtractingUpdate {
    [self recordState:RAStateDownloading];
}

- (void)showExtractionReceivedProgress:(double)progress {
    (void)progress;
}

- (void)showReadyToInstallAndRelaunch:(void (^)(SPUUserUpdateChoice))reply {
    self.readyReply = reply;
    [self recordState:RAStateReady];
}

- (void)showInstallingUpdateWithApplicationTerminated:(BOOL)applicationTerminated
                           retryTerminatingApplication:(void (^)(void))retryTerminatingApplication {
    (void)applicationTerminated;
    (void)retryTerminatingApplication;
}

- (void)showUpdateInstalledAndRelaunched:(BOOL)relaunched acknowledgement:(void (^)(void))acknowledgement {
    (void)relaunched;
    acknowledgement();
}

- (void)dismissUpdateInstallation {
    if (![self.state isEqualToString:RAStateReady]) {
        [self recordState:RAStateIdle];
    }
}

@end

static RAUpdaterBridge *gUpdaterBridge;

static void RAOnMainSync(dispatch_block_t block) {
    if ([NSThread isMainThread]) {
        block();
    } else {
        dispatch_sync(dispatch_get_main_queue(), block);
    }
}

static char *RACopyString(NSString *value) {
    const char *utf8 = value.UTF8String;
    return utf8 == NULL ? NULL : strdup(utf8);
}

static void RASetError(char **errorOut, NSError *error) {
    if (errorOut != NULL) {
        *errorOut = RACopyString(error.localizedDescription ?: @"Unknown Sparkle error");
    }
}

int ra_sparkle_initialize(const char *feedURL, int allowsBeta, char **errorOut) {
    __block BOOL success = NO;
    __block NSError *failure = nil;
    NSString *feed = feedURL == NULL ? @"" : [NSString stringWithUTF8String:feedURL];
    RAOnMainSync(^{
        if (gUpdaterBridge != nil) {
            failure = [NSError errorWithDomain:@"com.silkcitylabs.reviewarc.updater"
                                          code:2
                                      userInfo:@{NSLocalizedDescriptionKey: @"Sparkle updater is already initialized"}];
            return;
        }
        gUpdaterBridge = [[RAUpdaterBridge alloc] initWithFeedURL:feed allowsBeta:allowsBeta != 0];
        success = [gUpdaterBridge start:&failure];
        if (!success) {
            gUpdaterBridge = nil;
        }
    });
    if (!success) {
        RASetError(errorOut, failure);
    }
    return success ? 1 : 0;
}

int ra_sparkle_set_allows_beta(int allowsBeta, char **errorOut) {
    __block BOOL success = NO;
    RAOnMainSync(^{
        if (gUpdaterBridge != nil) {
            gUpdaterBridge.allowsBeta = allowsBeta != 0;
            success = YES;
        }
    });
    if (!success) {
        RASetError(errorOut, [NSError errorWithDomain:@"com.silkcitylabs.reviewarc.updater"
                                                 code:3
                                             userInfo:@{NSLocalizedDescriptionKey: @"Sparkle updater is not initialized"}]);
    }
    return success ? 1 : 0;
}

int ra_sparkle_check(int interactive, char **errorOut) {
    __block BOOL success = NO;
    RAOnMainSync(^{
        if (gUpdaterBridge.updater.canCheckForUpdates) {
            if (interactive != 0) {
                [gUpdaterBridge.updater checkForUpdates];
            } else {
                [gUpdaterBridge.updater checkForUpdatesInBackground];
            }
            success = YES;
        }
    });
    if (!success) {
        RASetError(errorOut, [NSError errorWithDomain:@"com.silkcitylabs.reviewarc.updater"
                                                 code:4
                                             userInfo:@{NSLocalizedDescriptionKey: @"Sparkle cannot check for updates right now"}]);
    }
    return success ? 1 : 0;
}

int ra_sparkle_install_and_restart(char **errorOut) {
    __block BOOL success = NO;
    __block NSError *failure = nil;
    RAOnMainSync(^{
        success = [gUpdaterBridge installAndRestart:&failure];
    });
    if (!success) {
        RASetError(errorOut, failure);
    }
    return success ? 1 : 0;
}

char *ra_sparkle_status_json(void) {
    __block NSData *data = nil;
    RAOnMainSync(^{
        NSDictionary *status = gUpdaterBridge == nil
            ? @{@"revision": @0, @"state": RAStateIdle}
            : [gUpdaterBridge status];
        data = [NSJSONSerialization dataWithJSONObject:status options:0 error:NULL];
    });
    if (data == nil) {
        return NULL;
    }
    NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    return RACopyString(json);
}

void ra_sparkle_free_string(char *value) {
    free(value);
}
