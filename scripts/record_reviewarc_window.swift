import AppKit
import AVFoundation
import CoreMedia
import ScreenCaptureKit

final class WindowRecorder: NSObject, SCStreamOutput, @unchecked Sendable {
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private let lock = NSLock()
    private var sessionStarted = false
    private var finished = false

    init(outputURL: URL, width: Int, height: Int) throws {
        try? FileManager.default.removeItem(at: outputURL)
        writer = try AVAssetWriter(outputURL: outputURL, fileType: .mov)
        input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: width,
            AVVideoHeightKey: height,
            AVVideoCompressionPropertiesKey: [
                AVVideoAverageBitRateKey: 10_000_000,
                AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
            ],
        ])
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else { throw NSError(domain: "ReviewArcRecorder", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot add video input"]) }
        writer.add(input)
        guard writer.startWriting() else { throw writer.error ?? NSError(domain: "ReviewArcRecorder", code: 2) }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, sampleBuffer.isValid, CMSampleBufferDataIsReady(sampleBuffer) else { return }
        lock.lock()
        defer { lock.unlock() }
        guard !finished else { return }
        if !sessionStarted {
            writer.startSession(atSourceTime: sampleBuffer.presentationTimeStamp)
            sessionStarted = true
        }
        if input.isReadyForMoreMediaData {
            _ = input.append(sampleBuffer)
        }
    }

    func finish() async throws {
        lock.lock()
        finished = true
        let started = sessionStarted
        lock.unlock()
        guard started else { throw NSError(domain: "ReviewArcRecorder", code: 3, userInfo: [NSLocalizedDescriptionKey: "No ReviewArc frames were captured"]) }
        input.markAsFinished()
        await withCheckedContinuation { continuation in
            writer.finishWriting { continuation.resume() }
        }
        guard writer.status == .completed else { throw writer.error ?? NSError(domain: "ReviewArcRecorder", code: 4) }
    }
}

@main
struct ReviewArcWindowCapture {
    static func main() async throws {
        let arguments = CommandLine.arguments
        let duration = arguments.count > 1 ? Double(arguments[1]) ?? 38 : 38
        let outputPath = arguments.count > 2 ? arguments[2] : "demo/reviewarc-window-take.mov"
        let outputURL = URL(fileURLWithPath: outputPath, relativeTo: URL(fileURLWithPath: FileManager.default.currentDirectoryPath)).standardizedFileURL

        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let window = content.windows.first(where: {
            $0.owningApplication?.applicationName == "ReviewArc" && $0.title == "ReviewArc"
        }) ?? content.windows.first(where: { $0.owningApplication?.applicationName == "ReviewArc" }) else {
            throw NSError(domain: "ReviewArcRecorder", code: 5, userInfo: [NSLocalizedDescriptionKey: "ReviewArc window was not found"])
        }

        let scale = NSScreen.main?.backingScaleFactor ?? 2
        let captureWidth = max(2, Int(window.frame.width * scale) / 2 * 2)
        let captureHeight = max(2, Int(window.frame.height * scale) / 2 * 2)
        let configuration = SCStreamConfiguration()
        configuration.width = captureWidth
        configuration.height = captureHeight
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        configuration.queueDepth = 6
        configuration.pixelFormat = kCVPixelFormatType_32BGRA
        configuration.showsCursor = true
        configuration.capturesAudio = false
        configuration.scalesToFit = true
        configuration.backgroundColor = NSColor.windowBackgroundColor.cgColor

        let filter = SCContentFilter(desktopIndependentWindow: window)
        let stream = SCStream(filter: filter, configuration: configuration, delegate: nil)
        let recorder = try WindowRecorder(outputURL: outputURL, width: captureWidth, height: captureHeight)
        try stream.addStreamOutput(recorder, type: .screen, sampleHandlerQueue: DispatchQueue(label: "reviewarc.window.capture", qos: .userInteractive))

        try await stream.startCapture()
        print("RECORDING \(window.frame.width)x\(window.frame.height) -> \(outputURL.path)")
        try await Task.sleep(for: .seconds(duration))
        try await stream.stopCapture()
        try await recorder.finish()
        print("COMPLETE \(outputURL.path)")
    }
}
