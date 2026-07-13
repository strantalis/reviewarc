//go:build darwin && cgo

package main

/*
#cgo CFLAGS: -x objective-c -fblocks
#cgo LDFLAGS: -framework Cocoa

#import <Cocoa/Cocoa.h>

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

static void configureReviewArcNativeWindowChrome(void) {
	if ([NSThread isMainThread]) {
		configureReviewArcNativeWindowChromeOnMain();
		return;
	}
	dispatch_async(dispatch_get_main_queue(), ^{
		configureReviewArcNativeWindowChromeOnMain();
	});
}
*/
import "C"

import "context"

func configureNativeWindowChrome(context.Context) {
	C.configureReviewArcNativeWindowChrome()
}
