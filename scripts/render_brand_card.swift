import AppKit
import AVFoundation
import CoreVideo

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let output = root.appendingPathComponent("demo/reviewarc-brand-card.mp4")
let width = 1920
let height = 1200
let fps: Int32 = 30
let duration = 3.6

func color(_ hex: UInt32, alpha: CGFloat = 1) -> NSColor {
    NSColor(calibratedRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
}

func text(_ value: String, rect: NSRect, size: CGFloat, weight: NSFont.Weight, color: NSColor) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = .center
    NSAttributedString(string: value, attributes: [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color, .paragraphStyle: paragraph]).draw(in: rect)
}

func mark(at origin: NSPoint, alpha: CGFloat) {
    let path = NSBezierPath()
    path.move(to: NSPoint(x: origin.x, y: origin.y + 38))
    path.curve(to: NSPoint(x: origin.x + 42, y: origin.y), controlPoint1: NSPoint(x: origin.x - 4, y: origin.y + 10), controlPoint2: NSPoint(x: origin.x + 24, y: origin.y - 10))
    path.curve(to: NSPoint(x: origin.x + 50, y: origin.y + 42), controlPoint1: NSPoint(x: origin.x + 61, y: origin.y + 7), controlPoint2: NSPoint(x: origin.x + 65, y: origin.y + 35))
    path.lineWidth = 7
    path.lineCapStyle = .round
    color(0x63E6BE, alpha: alpha).setStroke()
    path.stroke()
    for (x, y, c) in [(0.0, 38.0, UInt32(0x7C6CFF)), (42.0, 0.0, UInt32(0x63E6BE)), (50.0, 42.0, UInt32(0x4EA8FF))] {
        color(c, alpha: alpha).setFill()
        NSBezierPath(ovalIn: NSRect(x: origin.x + CGFloat(x) - 6, y: origin.y + CGFloat(y) - 6, width: 12, height: 12)).fill()
    }
}

try? FileManager.default.removeItem(at: output)
let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height, AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 8_000_000]])
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height])
writer.add(input)
guard writer.startWriting() else { fatalError(writer.error?.localizedDescription ?? "Cannot encode") }
writer.startSession(atSourceTime: .zero)

for frame in 0..<Int(duration * Double(fps)) {
    while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.002) }
    autoreleasepool {
        var buffer: CVPixelBuffer?
        CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA, [kCVPixelBufferCGImageCompatibilityKey: true, kCVPixelBufferCGBitmapContextCompatibilityKey: true] as CFDictionary, &buffer)
        let pixelBuffer = buffer!
        CVPixelBufferLockBaseAddress(pixelBuffer, [])
        let context = CGContext(data: CVPixelBufferGetBaseAddress(pixelBuffer), width: width, height: height, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pixelBuffer), space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue)!
        context.translateBy(x: 0, y: CGFloat(height))
        context.scaleBy(x: 1, y: -1)
        let graphics = NSGraphicsContext(cgContext: context, flipped: true)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = graphics
        let canvas = NSRect(x: 0, y: 0, width: width, height: height)
        NSGradient(colors: [color(0x07131F), color(0x102D35), color(0x191936)])!.draw(in: canvas, angle: -24)
        NSGradient(starting: color(0x37D6B0, alpha: 0.17), ending: color(0x37D6B0, alpha: 0))!.draw(fromCenter: NSPoint(x: 340, y: 280), radius: 0, toCenter: NSPoint(x: 340, y: 280), radius: 650, options: [])
        NSGradient(starting: color(0x7167FF, alpha: 0.18), ending: color(0x7167FF, alpha: 0))!.draw(fromCenter: NSPoint(x: 1590, y: 930), radius: 0, toCenter: NSPoint(x: 1590, y: 930), radius: 700, options: [])
        let seconds = Double(frame) / Double(fps)
        let fadeIn = min(1, seconds / 0.45)
        let fadeOut = min(1, (duration - seconds) / 0.45)
        let alpha = CGFloat(min(fadeIn, fadeOut))
        mark(at: NSPoint(x: 935, y: 360), alpha: alpha)
        text("ReviewArc", rect: NSRect(x: 0, y: 455, width: width, height: 80), size: 62, weight: .bold, color: .white.withAlphaComponent(alpha))
        text("Understand the change, not just the diff.", rect: NSRect(x: 300, y: 560, width: 1320, height: 70), size: 34, weight: .medium, color: color(0xD8E3EA, alpha: alpha))
        NSGraphicsContext.restoreGraphicsState()
        CVPixelBufferUnlockBaseAddress(pixelBuffer, [])
        guard adaptor.append(pixelBuffer, withPresentationTime: CMTime(value: Int64(frame), timescale: fps)) else { fatalError(writer.error?.localizedDescription ?? "Cannot append") }
    }
}
input.markAsFinished()
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
guard writer.status == .completed else { fatalError(writer.error?.localizedDescription ?? "Export failed") }
print(output.path)
