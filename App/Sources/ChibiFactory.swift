import Foundation
import UIKit
import FightEngine

/// Builds and caches the chibi frames per fighter (P6-3). Official photos are downloaded on the phone only
/// (never in the repo); the head sprite and the rendered frames are cached under Application Support.
actor ChibiFactory {
    static let shared = ChibiFactory()

    struct Output: Sendable {
        var frames: [ChibiPose: ChibiBitmap]
        /// False when no photo head could be made and the stand-in oval head was used (nothing is cached then).
        var headOK: Bool
        var style: ChibiStyle
    }

    private var headMemory: [String: ChibiBitmap] = [:]
    private var frameMemory: [String: Output] = [:]
    private let supportDir: URL
    private let photoDir: URL

    init() {
        let fm = FileManager.default
        let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        supportDir = base.appendingPathComponent("ChibiCache_v1", isDirectory: true)
        let caches = fm.urls(for: .cachesDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        photoDir = caches.appendingPathComponent("ChibiPhotos_v1", isDirectory: true)
        try? fm.createDirectory(at: supportDir, withIntermediateDirectories: true)
        try? fm.createDirectory(at: photoDir, withIntermediateDirectories: true)
        var dir = supportDir
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? dir.setResourceValues(values)
    }

    // MARK: Public

    func frames(for fighter: Fighter) async -> Output {
        let head = await headSprite(for: fighter)
        let style = Self.resolveStyle(fighterId: fighter.id, head: head)
        let signature = Self.signature(style: style, hasHead: head != nil)
        if let hit = frameMemory[signature] { return hit }

        if head != nil, let disk = loadFrames(fighterId: fighter.id, signature: signature) {
            let result = Output(frames: disk, headOK: true, style: style)
            frameMemory[signature] = result
            return result
        }

        var frames: [ChibiPose: ChibiBitmap] = [:]
        for pose in ChibiPose.allCases {
            frames[pose] = ChibiBodyRenderer.render(pose: pose, style: style, head: head)
        }
        let result = Output(frames: frames, headOK: head != nil, style: style)
        if head != nil {
            saveFrames(frames, fighterId: fighter.id, signature: signature)
            frameMemory[signature] = result
        }
        return result
    }

    /// Drops the cached head and frames of one fighter so the next call rebuilds everything from the photo.
    func purge(fighterId: String) {
        headMemory[fighterId] = nil
        frameMemory = frameMemory.filter { !$0.key.hasPrefix("\(fighterId)|") }
        let fm = FileManager.default
        try? fm.removeItem(at: headURL(fighterId))
        try? fm.removeItem(at: photoURL(fighterId))
        if let files = try? fm.contentsOfDirectory(at: supportDir, includingPropertiesForKeys: nil) {
            for f in files where f.lastPathComponent.hasPrefix("frame_\(fighterId)_") { try? fm.removeItem(at: f) }
        }
    }

    // MARK: Style

    nonisolated static func resolveStyle(fighterId: String, head: ChibiBitmap?) -> ChibiStyle {
        let look = ChibiLooks.look(for: fighterId)
        let skin: ChibiRGB
        if let hex = look?.skin, let c = ChibiRGB(hex: hex) {
            skin = c
        } else if let head {
            skin = ChibiHeadExtractor.faceSkin(of: head)
        } else {
            skin = ChibiRGB(200, 150, 120)
        }
        return ChibiStyle(
            fighterId: fighterId,
            skin: skin,
            build: (look?.build ?? .normal).scale,
            ink: look?.ink ?? ChibiInk(),
            inkTint: look?.inkTint.flatMap { ChibiRGB(hex: $0) },
            shorts: look?.shorts.flatMap { ChibiRGB(hex: $0) } ?? ChibiStyle.defaultShorts
        )
    }

    /// Everything that changes the picture: renderer version, head presence and every style field.
    private nonisolated static func signature(style: ChibiStyle, hasHead: Bool) -> String {
        let s = style
        let tint = s.inkTint.map { "\($0.r),\($0.g),\($0.b)" } ?? "-"
        let ink = "\(s.ink.chest)\(s.ink.belly)\(s.ink.upperL)\(s.ink.foreL)\(s.ink.upperR)\(s.ink.foreR)"
        return "\(s.fighterId)|v\(ChibiBodyRenderer.version)|\(hasHead ? "H" : "n")|\(s.skin.r),\(s.skin.g),\(s.skin.b)|\(s.build)|\(ink)|\(tint)|\(s.shorts.r),\(s.shorts.g),\(s.shorts.b)"
    }

    private nonisolated static func shortHash(_ signature: String) -> String {
        String(format: "%08x", ChibiHash.fnv1a(signature))
    }

    // MARK: Head

    private func headSprite(for fighter: Fighter) async -> ChibiBitmap? {
        if let m = headMemory[fighter.id] { return m }
        if let data = try? Data(contentsOf: headURL(fighter.id)), let bmp = ChibiBitmap(pngData: data) {
            headMemory[fighter.id] = bmp
            return bmp
        }
        guard let urlString = fighter.fullBodyImageUrl,
              let photo = await photoData(id: fighter.id, urlString: urlString),
              let head = ChibiHeadExtractor.extract(photoData: photo)
        else { return nil }
        if let png = head.pngData() { try? png.write(to: headURL(fighter.id), options: .atomic) }
        headMemory[fighter.id] = head
        return head
    }

    private func headURL(_ id: String) -> URL {
        supportDir.appendingPathComponent("head_\(id).png")
    }

    private func photoURL(_ id: String) -> URL {
        photoDir.appendingPathComponent("\(id).png")
    }

    private func photoData(id: String, urlString: String) async -> Data? {
        let file = photoURL(id)
        if let cached = try? Data(contentsOf: file), !cached.isEmpty { return cached }
        guard let url = URL(string: urlString) else { return nil }
        var request = URLRequest(url: url, cachePolicy: .returnCacheDataElseLoad, timeoutInterval: 20)
        request.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", forHTTPHeaderField: "User-Agent")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
              UIImage(data: data) != nil
        else { return nil }
        try? data.write(to: file, options: .atomic)
        return data
    }

    // MARK: Frame cache

    private func frameURL(fighterId: String, pose: ChibiPose, hash: String) -> URL {
        supportDir.appendingPathComponent("frame_\(fighterId)_\(pose.rawValue)_\(hash).png")
    }

    private func loadFrames(fighterId: String, signature: String) -> [ChibiPose: ChibiBitmap]? {
        let hash = Self.shortHash(signature)
        var out: [ChibiPose: ChibiBitmap] = [:]
        for pose in ChibiPose.allCases {
            guard let data = try? Data(contentsOf: frameURL(fighterId: fighterId, pose: pose, hash: hash)),
                  let bmp = ChibiBitmap(pngData: data),
                  bmp.width == ChibiBodyRenderer.canvasWidth, bmp.height == ChibiBodyRenderer.canvasHeight
            else { return nil }
            out[pose] = bmp
        }
        return out
    }

    private func saveFrames(_ frames: [ChibiPose: ChibiBitmap], fighterId: String, signature: String) {
        let fm = FileManager.default
        let hash = Self.shortHash(signature)
        // Remove frames of older looks / renderer versions for this fighter.
        if let files = try? fm.contentsOfDirectory(at: supportDir, includingPropertiesForKeys: nil) {
            for f in files where f.lastPathComponent.hasPrefix("frame_\(fighterId)_") && !f.lastPathComponent.hasSuffix("_\(hash).png") {
                try? fm.removeItem(at: f)
            }
        }
        for (pose, bmp) in frames {
            if let png = bmp.pngData() {
                try? png.write(to: frameURL(fighterId: fighterId, pose: pose, hash: hash), options: .atomic)
            }
        }
    }
}
