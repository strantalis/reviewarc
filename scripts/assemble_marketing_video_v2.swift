import AVFoundation
import CoreGraphics

struct EditSegment {
    let asset: AVURLAsset
    let sourceStart: Double
    let duration: Double
}

@main
struct AssembleReviewArcV2 {
    static func main() async throws {
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let brand = AVURLAsset(url: root.appendingPathComponent("demo/reviewarc-brand-card.mp4"))
        let take = AVURLAsset(url: root.appendingPathComponent("demo/reviewarc-continuous-take-v4.mov"))
        let output = root.appendingPathComponent("demo/reviewarc-premium-demo-v2.mp4")
        let segments = [
            EditSegment(asset: brand, sourceStart: 0.0, duration: 2.1),
            EditSegment(asset: take, sourceStart: 2.0, duration: 11.0),
            EditSegment(asset: take, sourceStart: 21.0, duration: 8.0),
            EditSegment(asset: take, sourceStart: 40.0, duration: 9.0),
            EditSegment(asset: take, sourceStart: 56.0, duration: 4.0),
            EditSegment(asset: brand, sourceStart: 0.4, duration: 2.6),
        ]

        let composition = AVMutableComposition()
        guard let compositionTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            fatalError("Unable to create composition track")
        }
        var cursor = CMTime.zero
        var instructions: [AVVideoCompositionInstructionProtocol] = []
        let renderSize = CGSize(width: 1920, height: 1200)

        for segment in segments {
            guard let sourceTrack = try await segment.asset.loadTracks(withMediaType: .video).first else {
                fatalError("Missing source video track")
            }
            let sourceRange = CMTimeRange(start: CMTime(seconds: segment.sourceStart, preferredTimescale: 600), duration: CMTime(seconds: segment.duration, preferredTimescale: 600))
            try compositionTrack.insertTimeRange(sourceRange, of: sourceTrack, at: cursor)
            let naturalSize = try await sourceTrack.load(.naturalSize)
            let scale = min(renderSize.width / naturalSize.width, renderSize.height / naturalSize.height)
            let offsetX = (renderSize.width - naturalSize.width * scale) / 2
            let offsetY = (renderSize.height - naturalSize.height * scale) / 2
            let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: compositionTrack)
            layer.setTransform(CGAffineTransform(a: scale, b: 0, c: 0, d: scale, tx: offsetX, ty: offsetY), at: cursor)
            let instruction = AVMutableVideoCompositionInstruction()
            instruction.timeRange = CMTimeRange(start: cursor, duration: sourceRange.duration)
            instruction.backgroundColor = CGColor(red: 7 / 255, green: 19 / 255, blue: 31 / 255, alpha: 1)
            instruction.layerInstructions = [layer]
            instructions.append(instruction)
            cursor = cursor + sourceRange.duration
        }

        let videoComposition = AVMutableVideoComposition()
        videoComposition.renderSize = renderSize
        videoComposition.frameDuration = CMTime(value: 1, timescale: 30)
        videoComposition.instructions = instructions

        try? FileManager.default.removeItem(at: output)
        guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
            fatalError("Unable to create export session")
        }
        exporter.outputURL = output
        exporter.outputFileType = .mp4
        exporter.shouldOptimizeForNetworkUse = true
        exporter.videoComposition = videoComposition
        await withCheckedContinuation { continuation in
            exporter.exportAsynchronously { continuation.resume() }
        }
        guard exporter.status == .completed else {
            throw exporter.error ?? NSError(domain: "ReviewArcMarketingVideo", code: 1)
        }
        print(output.path)
    }
}
