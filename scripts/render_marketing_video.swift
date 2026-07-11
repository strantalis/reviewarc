import AppKit
import AVFoundation
import CoreVideo

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let output = root.appendingPathComponent("demo/reviewarc-premium-demo.mp4")

struct Scene {
    let image: String?
    let eyebrow: String
    let title: String
    let subtitle: String
    let duration: Double
}

let scenes = [
    Scene(image: nil, eyebrow: "LOCAL-FIRST PULL REQUEST REVIEW", title: "See the whole arc\nof every change.", subtitle: "ReviewArc turns real pull requests into focused, evidence-backed walkthroughs.", duration: 3.2),
    Scene(image: "demo/frames/01-inbox.jpg", eyebrow: "UNIFIED INBOX", title: "Every pull request. One calm queue.", subtitle: "Review-requested, assigned, and authored work—across repositories.", duration: 3.2),
    Scene(image: "demo/frames/02-sources.jpg", eyebrow: "REAL GITHUB DATA", title: "Choose the repositories that matter.", subtitle: "No local checkout required. ReviewArc manages isolated Git caches for you.", duration: 3.0),
    Scene(image: "demo/frames/03-overview.jpg", eyebrow: "STRUCTURED ANALYSIS", title: "Understand the change before reading every line.", subtitle: "Codex maps the pull request into affected areas, chapters, risks, and evidence.", duration: 3.4),
    Scene(image: "demo/frames/04-risk-overview.jpg", eyebrow: "REVIEW THE CONSEQUENCES", title: "Risks and unknowns stay visible.", subtitle: "Unsupported claims are labeled unverified—not quietly trusted.", duration: 3.2),
    Scene(image: "demo/frames/05-guided-review.jpg", eyebrow: "THREE-PANEL WORKSPACE", title: "Chapters. Code. Context.", subtitle: "Move through the review with a clear objective and the evidence beside it.", duration: 3.8),
    Scene(image: "demo/frames/06-split-diff.jpg", eyebrow: "REAL DIFFS", title: "Review both sides of the change.", subtitle: "Navigate changed files, unified or split diffs, and revision-aware line targets.", duration: 3.0),
    Scene(image: "demo/frames/07-evidence.jpg", eyebrow: "VALIDATED EVIDENCE", title: "Every claim traces back to code.", subtitle: "ReviewArc validates AI-provided paths and line ranges before showing them.", duration: 3.6),
    Scene(image: "demo/frames/08-private-notes.jpg", eyebrow: "PRIVATE BY DEFAULT", title: "Your working notes stay yours.", subtitle: "Capture concerns and decisions locally without sending them to GitHub.", duration: 2.8),
    Scene(image: "demo/frames/09-review-drafts.jpg", eyebrow: "EXPLICIT PUBLISHING", title: "Draft locally. Publish deliberately.", subtitle: "GitHub review comments are sent only after a separate confirmation.", duration: 3.2),
    Scene(image: nil, eyebrow: "REVIEWARC", title: "Review pull requests\nwith the whole story.", subtitle: "Local-first  •  GitHub-native  •  Codex-powered", duration: 4.0),
]

let width = 1920
let height = 1200
let fps: Int32 = 30
let transition = 0.5

func color(_ hex: UInt32, alpha: CGFloat = 1) -> NSColor {
    NSColor(
        calibratedRed: CGFloat((hex >> 16) & 0xff) / 255,
        green: CGFloat((hex >> 8) & 0xff) / 255,
        blue: CGFloat(hex & 0xff) / 255,
        alpha: alpha
    )
}

func ease(_ value: Double) -> CGFloat {
    let t = max(0, min(1, value))
    return CGFloat(1 - pow(1 - t, 3))
}

func drawText(_ value: String, in rect: NSRect, font: NSFont, color textColor: NSColor, alignment: NSTextAlignment = .left, lineSpacing: CGFloat = 0) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.alignment = alignment
    paragraph.lineSpacing = lineSpacing
    paragraph.lineBreakMode = .byWordWrapping
    let attributes: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: textColor,
        .paragraphStyle: paragraph,
    ]
    NSAttributedString(string: value, attributes: attributes).draw(in: rect)
}

func roundedFill(_ rect: NSRect, radius: CGFloat, fill: NSColor, stroke: NSColor? = nil, lineWidth: CGFloat = 1) {
    let path = NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius)
    fill.setFill()
    path.fill()
    if let stroke {
        stroke.setStroke()
        path.lineWidth = lineWidth
        path.stroke()
    }
}

func drawMark(at origin: NSPoint, scale: CGFloat = 1) {
    let stroke = NSBezierPath()
    stroke.move(to: NSPoint(x: origin.x + 7 * scale, y: origin.y + 34 * scale))
    stroke.curve(to: NSPoint(x: origin.x + 41 * scale, y: origin.y + 8 * scale), controlPoint1: NSPoint(x: origin.x + 3 * scale, y: origin.y + 11 * scale), controlPoint2: NSPoint(x: origin.x + 26 * scale, y: origin.y + 1 * scale))
    stroke.curve(to: NSPoint(x: origin.x + 45 * scale, y: origin.y + 38 * scale), controlPoint1: NSPoint(x: origin.x + 53 * scale, y: origin.y + 14 * scale), controlPoint2: NSPoint(x: origin.x + 55 * scale, y: origin.y + 33 * scale))
    stroke.lineWidth = 6 * scale
    stroke.lineCapStyle = .round
    color(0x63E6BE).setStroke()
    stroke.stroke()
    for (x, y, c) in [(7.0, 34.0, UInt32(0x7C6CFF)), (41.0, 8.0, UInt32(0x63E6BE)), (45.0, 38.0, UInt32(0x4EA8FF))] {
        color(c).setFill()
        NSBezierPath(ovalIn: NSRect(x: origin.x + CGFloat(x) * scale - 5 * scale, y: origin.y + CGFloat(y) * scale - 5 * scale, width: 10 * scale, height: 10 * scale)).fill()
    }
}

let loadedImages: [String: NSImage] = Dictionary(uniqueKeysWithValues: scenes.compactMap { scene in
    guard let path = scene.image else { return nil }
    guard let image = NSImage(contentsOf: root.appendingPathComponent(path)) else {
        fatalError("Unable to load \(path)")
    }
    return (path, image)
})

try? FileManager.default.removeItem(at: output)
let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
let settings: [String: Any] = [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width,
    AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: 12_000_000,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
    ],
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height,
])
guard writer.canAdd(input) else { fatalError("Cannot add video input") }
writer.add(input)
guard writer.startWriting() else { fatalError(writer.error?.localizedDescription ?? "Unable to start video writer") }
writer.startSession(atSourceTime: .zero)

func makeBuffer() -> CVPixelBuffer {
    var buffer: CVPixelBuffer?
    let attrs: [CFString: Any] = [
        kCVPixelBufferCGImageCompatibilityKey: true,
        kCVPixelBufferCGBitmapContextCompatibilityKey: true,
    ]
    let status = CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA, attrs as CFDictionary, &buffer)
    guard status == kCVReturnSuccess, let buffer else { fatalError("Unable to create pixel buffer") }
    return buffer
}

func render(sceneIndex: Int, localTime: Double, totalProgress: CGFloat, into buffer: CVPixelBuffer) {
    let scene = scenes[sceneIndex]
    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    guard let context = CGContext(
        data: CVPixelBufferGetBaseAddress(buffer),
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
    ) else { fatalError("Unable to create drawing context") }

    context.translateBy(x: 0, y: CGFloat(height))
    context.scaleBy(x: 1, y: -1)
    let graphics = NSGraphicsContext(cgContext: context, flipped: true)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = graphics
    defer { NSGraphicsContext.restoreGraphicsState() }

    let canvas = NSRect(x: 0, y: 0, width: width, height: height)
    NSGradient(colors: [color(0x07131F), color(0x102D35), color(0x191936)])!.draw(in: canvas, angle: -24)

    let glowShift = CGFloat(sin((Double(sceneIndex) + localTime * 0.35))) * 70
    NSGradient(starting: color(0x37D6B0, alpha: 0.20), ending: color(0x37D6B0, alpha: 0))!.draw(fromCenter: NSPoint(x: 270 + glowShift, y: 210), radius: 0, toCenter: NSPoint(x: 270 + glowShift, y: 210), radius: 520, options: [])
    NSGradient(starting: color(0x7167FF, alpha: 0.22), ending: color(0x7167FF, alpha: 0))!.draw(fromCenter: NSPoint(x: 1670 - glowShift, y: 930), radius: 0, toCenter: NSPoint(x: 1670 - glowShift, y: 930), radius: 600, options: [])

    if let imagePath = scene.image, let image = loadedImages[imagePath] {
        let intro = ease(localTime / 0.8)
        let scale = 0.972 + 0.028 * intro
        let baseWidth: CGFloat = 1500
        let baseHeight = baseWidth * image.size.height / image.size.width
        let rect = NSRect(
            x: (CGFloat(width) - baseWidth * scale) / 2,
            y: 155 + (1 - intro) * 26,
            width: baseWidth * scale,
            height: baseHeight * scale
        )

        NSGraphicsContext.saveGraphicsState()
        let shadow = NSShadow()
        shadow.shadowColor = NSColor.black.withAlphaComponent(0.46)
        shadow.shadowBlurRadius = 55
        shadow.shadowOffset = NSSize(width: 0, height: 22)
        shadow.set()
        roundedFill(rect, radius: 23, fill: color(0x050A0E), stroke: color(0xFFFFFF, alpha: 0.16), lineWidth: 1.2)
        NSGraphicsContext.restoreGraphicsState()

        NSGraphicsContext.saveGraphicsState()
        NSBezierPath(roundedRect: rect, xRadius: 22, yRadius: 22).addClip()
        context.translateBy(x: 0, y: rect.minY * 2 + rect.height)
        context.scaleBy(x: 1, y: -1)
        image.draw(in: rect, from: .zero, operation: .sourceOver, fraction: intro)
        NSGraphicsContext.restoreGraphicsState()

        let labelWidth = min(1500, max(660, CGFloat(scene.title.count) * 22))
        let label = NSRect(x: (CGFloat(width) - labelWidth) / 2, y: 47, width: labelWidth, height: 90)
        roundedFill(label, radius: 28, fill: color(0x07121D, alpha: 0.86), stroke: color(0xFFFFFF, alpha: 0.13))
        drawText(scene.eyebrow, in: NSRect(x: label.minX + 28, y: label.minY + 16, width: label.width - 56, height: 22), font: .systemFont(ofSize: 15, weight: .bold), color: color(0x63E6BE), alignment: .center)
        drawText(scene.title, in: NSRect(x: label.minX + 24, y: label.minY + 40, width: label.width - 48, height: 38), font: .systemFont(ofSize: 27, weight: .semibold), color: .white, alignment: .center)
    } else {
        let alpha = ease(localTime / 0.9)
        drawMark(at: NSPoint(x: 858, y: 235), scale: 2.2)
        drawText("ReviewArc", in: NSRect(x: 0, y: 350, width: width, height: 70), font: .systemFont(ofSize: 56, weight: .bold), color: .white.withAlphaComponent(alpha), alignment: .center)
        drawText(scene.eyebrow, in: NSRect(x: 0, y: 445, width: width, height: 30), font: .systemFont(ofSize: 17, weight: .bold), color: color(0x63E6BE).withAlphaComponent(alpha), alignment: .center)
        drawText(scene.title, in: NSRect(x: 260, y: 495, width: 1400, height: 235), font: .systemFont(ofSize: 78, weight: .bold), color: .white.withAlphaComponent(alpha), alignment: .center, lineSpacing: 6)
        drawText(scene.subtitle, in: NSRect(x: 410, y: 760, width: 1100, height: 90), font: .systemFont(ofSize: 27, weight: .regular), color: color(0xD8E3EA).withAlphaComponent(alpha), alignment: .center, lineSpacing: 4)
        if sceneIndex == 0 {
            let chips = ["LOCAL-FIRST", "GITHUB-NATIVE", "CODEX-POWERED"]
            let chipWidth: CGFloat = 220
            let total = CGFloat(chips.count) * chipWidth + CGFloat(chips.count - 1) * 18
            var x = (CGFloat(width) - total) / 2
            for chip in chips {
                roundedFill(NSRect(x: x, y: 900, width: chipWidth, height: 46), radius: 23, fill: color(0xFFFFFF, alpha: 0.07), stroke: color(0xFFFFFF, alpha: 0.15))
                drawText(chip, in: NSRect(x: x, y: 914, width: chipWidth, height: 22), font: .systemFont(ofSize: 13, weight: .bold), color: color(0xCFE7E4), alignment: .center)
                x += chipWidth + 18
            }
        }
    }

    roundedFill(NSRect(x: 150, y: 1164, width: CGFloat(width - 300), height: 3), radius: 1.5, fill: color(0xFFFFFF, alpha: 0.10))
    roundedFill(NSRect(x: 150, y: 1164, width: CGFloat(width - 300) * totalProgress, height: 3), radius: 1.5, fill: color(0x63E6BE, alpha: 0.9))
}

let totalDuration = scenes.reduce(0) { $0 + $1.duration }
var elapsed = 0.0
var frameNumber: Int64 = 0

for (sceneIndex, scene) in scenes.enumerated() {
    let frames = Int(scene.duration * Double(fps))
    for frame in 0..<frames {
        while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.002) }
        autoreleasepool {
            let local = Double(frame) / Double(fps)
            let buffer = makeBuffer()
            render(sceneIndex: sceneIndex, localTime: local, totalProgress: CGFloat((elapsed + local) / totalDuration), into: buffer)
            let time = CMTime(value: frameNumber, timescale: fps)
            guard adaptor.append(buffer, withPresentationTime: time) else {
                fatalError(writer.error?.localizedDescription ?? "Unable to append frame")
            }
            frameNumber += 1
        }
    }
    elapsed += scene.duration
}

input.markAsFinished()
let semaphore = DispatchSemaphore(value: 0)
writer.finishWriting { semaphore.signal() }
semaphore.wait()
guard writer.status == .completed else {
    fatalError(writer.error?.localizedDescription ?? "Video export failed")
}
print(output.path)
