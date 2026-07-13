#import <Cocoa/Cocoa.h>

extern void reviewArcCheckForUpdates(void);

static const NSInteger ReviewArcCheckForUpdatesMenuTag = 0x52415550;

static NSWindow *reviewArcWindow(void) {
    NSWindow *window = [NSApp keyWindow];
    if (window != nil) {
        return window;
    }
    for (NSWindow *candidate in [NSApp windows]) {
        if ([candidate isVisible]) {
            return candidate;
        }
    }
    return nil;
}

static void configureReviewArcNativeWindowChromeOnMain(void) {
    NSWindow *window = reviewArcWindow();
    if (window == nil) {
        return;
    }
    NSArray<NSNumber *> *buttonTypes = @[
        @(NSWindowCloseButton),
        @(NSWindowMiniaturizeButton),
        @(NSWindowZoomButton)
    ];
    for (NSNumber *buttonType in buttonTypes) {
        NSButton *button = [window standardWindowButton:(NSWindowButton)[buttonType integerValue]];
        [button setEnabled:NO];
        [button setHidden:YES];
    }
}

void configureReviewArcNativeWindowChrome(void) {
    if ([NSThread isMainThread]) {
        configureReviewArcNativeWindowChromeOnMain();
        return;
    }
    dispatch_async(dispatch_get_main_queue(), ^{
        configureReviewArcNativeWindowChromeOnMain();
    });
}

@interface ReviewArcUpdateMenuTarget : NSObject
- (void)checkForUpdates:(id)sender;
@end

@implementation ReviewArcUpdateMenuTarget
- (void)checkForUpdates:(id)sender {
    (void)sender;
    reviewArcCheckForUpdates();
}
@end

static ReviewArcUpdateMenuTarget *reviewArcUpdateMenuTarget;

static void configureReviewArcApplicationMenuOnMain(void) {
    NSMenu *mainMenu = [NSApp mainMenu];
    NSMenu *applicationMenu = [[mainMenu itemAtIndex:0] submenu];
    if (applicationMenu == nil || [applicationMenu itemWithTag:ReviewArcCheckForUpdatesMenuTag] != nil) {
        return;
    }

    reviewArcUpdateMenuTarget = [[ReviewArcUpdateMenuTarget alloc] init];
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:@"Check for Updates…"
                                                  action:@selector(checkForUpdates:)
                                           keyEquivalent:@""];
    [item setTag:ReviewArcCheckForUpdatesMenuTag];
    [item setTarget:reviewArcUpdateMenuTarget];
    [applicationMenu insertItem:item atIndex:MIN(1, [applicationMenu numberOfItems])];
}

void configureReviewArcApplicationMenu(void) {
    if ([NSThread isMainThread]) {
        configureReviewArcApplicationMenuOnMain();
        return;
    }
    dispatch_async(dispatch_get_main_queue(), ^{
        configureReviewArcApplicationMenuOnMain();
    });
}
