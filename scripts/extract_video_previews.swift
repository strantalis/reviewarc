import AppKit
import AVFoundation

guard CommandLine.arguments.count >= 4 else {
    fatalError("usage: extract_video_previews <video> <output-dir> <seconds...>")
}
let video = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
let asset = AVURLAsset(url: video)
let generator = AVAssetImageGenerator(asset: asset)
generator.appliesPreferredTrackTransform = true
generator.requestedTimeToleranceBefore = .zero
generator.requestedTimeToleranceAfter = .zero
for raw in CommandLine.arguments.dropFirst(3) {
    guard let seconds = Double(raw) else { continue }
    let image = try generator.copyCGImage(at: CMTime(seconds: seconds, preferredTimescale: 600), actualTime: nil)
    let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])!
    try data.write(to: output.appendingPathComponent(String(format: "preview-%05.1f.png", seconds)))
}
