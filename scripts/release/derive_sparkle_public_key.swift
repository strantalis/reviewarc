import CryptoKit
import Foundation

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(Data("private key file path required\n".utf8))
    exit(2)
}

do {
    let encodedSeed = try String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8)
        .trimmingCharacters(in: .whitespacesAndNewlines)
    guard let seed = Data(base64Encoded: encodedSeed), seed.count == 32 else {
        throw NSError(domain: "ReviewArcSparkleKey", code: 1, userInfo: [
            NSLocalizedDescriptionKey: "Sparkle private key must contain a base64-encoded 32-byte seed",
        ])
    }
    let privateKey = try Curve25519.Signing.PrivateKey(rawRepresentation: seed)
    print(privateKey.publicKey.rawRepresentation.base64EncodedString())
} catch {
    FileHandle.standardError.write(Data("Unable to derive Sparkle public key: \(error.localizedDescription)\n".utf8))
    exit(1)
}
