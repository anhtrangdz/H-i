import Foundation
import CryptoKit
import LocalAuthentication
import Security
import CommonCrypto

final class SecureVault {
    static let shared = SecureVault()

    enum VaultError: LocalizedError {
        case notConfigured
        case alreadyConfigured
        case locked
        case invalidPassword
        case invalidInput(String)
        case corruptData
        case biometricUnavailable
        case biometricFailed
        case backupInvalid
        case io(String)

        var errorDescription: String? {
            switch self {
            case .notConfigured: return "Sổ chưa được thiết lập."
            case .alreadyConfigured: return "Sổ đã được thiết lập."
            case .locked: return "Sổ đang khóa."
            case .invalidPassword: return "Mật khẩu không đúng."
            case .invalidInput(let message): return message
            case .corruptData: return "Dữ liệu mã hóa bị lỗi hoặc không còn toàn vẹn."
            case .biometricUnavailable: return "Face ID/Touch ID không khả dụng trên thiết bị này."
            case .biometricFailed: return "Không thể mở Sổ bằng sinh trắc học."
            case .backupInvalid: return "Bản sao không hợp lệ hoặc mật khẩu bản sao không đúng."
            case .io(let message): return message
            }
        }
    }

    struct Status {
        let configured: Bool
        let unlocked: Bool
        let biometricAvailable: Bool
        let biometricEnabled: Bool

        var dictionary: [String: Any] {
            [
                "configured": configured,
                "unlocked": unlocked,
                "biometricAvailable": biometricAvailable,
                "biometricEnabled": biometricEnabled
            ]
        }
    }

    private struct AuthMetadata: Codable {
        var version: Int
        var salt: String
        var iterations: UInt32
        var wrappedMasterKey: String
        var biometricEnabled: Bool
        var createdAt: String
    }

    private let lock = NSLock()
    private var masterKey: SymmetricKey?

    private let authMagicAAD = Data("sorelax-master-v1".utf8)
    private let vaultAAD = Data("sorelax-vault-v1".utf8)
    private let vaultMagic = Data("SRVAULT1".utf8)
    private let mediaMagic = Data("SRMEDIA1".utf8)
    private let backupMagic = Data("SORELAX2".utf8)
    private let defaultIterations: UInt32 = 210_000
    private let maxMediaBytes = 25 * 1024 * 1024
    private let keychainService = "com.prix.sorelax.localvault"
    private let keychainAccount = "biometric-master-key"

    private init() {
        try? ensureDirectories()
    }

    private var rootURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return base.appendingPathComponent("SoreRelax", isDirectory: true)
    }
    private var authURL: URL { rootURL.appendingPathComponent("auth.json") }
    private var vaultURL: URL { rootURL.appendingPathComponent("vault.bin") }
    private var mediaURL: URL { rootURL.appendingPathComponent("Media", isDirectory: true) }

    func status() -> Status {
        let configured = FileManager.default.fileExists(atPath: authURL.path)
        let unlocked = withMasterKey { $0 != nil }
        let meta = try? readAuthMetadata()
        return Status(
            configured: configured,
            unlocked: unlocked,
            biometricAvailable: biometricAvailable(),
            biometricEnabled: meta?.biometricEnabled ?? false
        )
    }

    func setup(password: String, initialStateJSON: String) throws {
        guard !FileManager.default.fileExists(atPath: authURL.path) else { throw VaultError.alreadyConfigured }
        try validatePassword(password, minimum: 10)
        guard let stateData = initialStateJSON.data(using: .utf8), stateData.count <= 20 * 1024 * 1024 else {
            throw VaultError.invalidInput("Dữ liệu khởi tạo không hợp lệ.")
        }
        _ = try validateStateJSON(stateData)
        try ensureDirectories()
        deleteBiometricKey()

        let salt = try randomData(count: 16)
        let passKey = try deriveKey(password: password, salt: salt, iterations: defaultIterations)
        let master = SymmetricKey(size: .bits256)
        let masterData = master.withUnsafeBytes { Data($0) }
        let sealed = try AES.GCM.seal(masterData, using: passKey, authenticating: authMagicAAD)
        guard let combined = sealed.combined else { throw VaultError.corruptData }

        let metadata = AuthMetadata(
            version: 1,
            salt: salt.base64EncodedString(),
            iterations: defaultIterations,
            wrappedMasterKey: combined.base64EncodedString(),
            biometricEnabled: false,
            createdAt: ISO8601DateFormatter().string(from: Date())
        )

        // First setup is transactional: auth metadata is never committed unless the
        // initial encrypted state has also been written successfully.
        setMasterKey(master)
        do {
            let encrypted = try encryptVaultData(stateData)
            try encrypted.write(to: vaultURL, options: .atomic)
            applyProtection(to: vaultURL)
            try writeAuthMetadata(metadata)
        } catch {
            setMasterKey(nil)
            try? FileManager.default.removeItem(at: vaultURL)
            try? FileManager.default.removeItem(at: authURL)
            throw error
        }
    }

    func unlock(password: String) throws {
        let metadata = try readAuthMetadata()
        guard let salt = Data(base64Encoded: metadata.salt),
              let wrapped = Data(base64Encoded: metadata.wrappedMasterKey) else { throw VaultError.corruptData }
        let passKey = try deriveKey(password: password, salt: salt, iterations: metadata.iterations)
        do {
            let box = try AES.GCM.SealedBox(combined: wrapped)
            let masterData = try AES.GCM.open(box, using: passKey, authenticating: authMagicAAD)
            guard masterData.count == 32 else { throw VaultError.corruptData }
            setMasterKey(SymmetricKey(data: masterData))
        } catch {
            throw VaultError.invalidPassword
        }
    }

    func lockVault() {
        setMasterKey(nil)
    }

    func changePassword(current: String, next: String) throws {
        try validatePassword(next, minimum: 10)
        let metadata = try readAuthMetadata()
        guard let oldSalt = Data(base64Encoded: metadata.salt),
              let wrapped = Data(base64Encoded: metadata.wrappedMasterKey) else { throw VaultError.corruptData }
        let currentKey = try deriveKey(password: current, salt: oldSalt, iterations: metadata.iterations)
        let masterData: Data
        do {
            masterData = try AES.GCM.open(try AES.GCM.SealedBox(combined: wrapped), using: currentKey, authenticating: authMagicAAD)
        } catch {
            throw VaultError.invalidPassword
        }
        guard masterData.count == 32 else { throw VaultError.corruptData }

        let newSalt = try randomData(count: 16)
        let newKey = try deriveKey(password: next, salt: newSalt, iterations: defaultIterations)
        let newBox = try AES.GCM.seal(masterData, using: newKey, authenticating: authMagicAAD)
        guard let combined = newBox.combined else { throw VaultError.corruptData }
        var updated = metadata
        updated.salt = newSalt.base64EncodedString()
        updated.iterations = defaultIterations
        updated.wrappedMasterKey = combined.base64EncodedString()
        try writeAuthMetadata(updated)
        setMasterKey(SymmetricKey(data: masterData))
    }

    func loadStateJSON() throws -> String? {
        guard FileManager.default.fileExists(atPath: vaultURL.path) else { return nil }
        let data = try Data(contentsOf: vaultURL, options: [.mappedIfSafe])
        let plain = try decryptVaultData(data)
        guard let string = String(data: plain, encoding: .utf8) else { throw VaultError.corruptData }
        return string
    }

    func saveStateJSON(_ json: String) throws {
        guard let data = json.data(using: .utf8) else { throw VaultError.invalidInput("Dữ liệu trạng thái không hợp lệ.") }
        guard data.count <= 20 * 1024 * 1024 else { throw VaultError.invalidInput("Dữ liệu trạng thái quá lớn.") }
        _ = try validateStateJSON(data)
        let encrypted = try encryptVaultData(data)
        try encrypted.write(to: vaultURL, options: .atomic)
        applyProtection(to: vaultURL)
    }

    func saveMedia(id: String, mime: String, bytes: Data) throws {
        try validateMediaID(id)
        guard supportedMIME.contains(mime) else { throw VaultError.invalidInput("Định dạng ảnh không được hỗ trợ.") }
        guard bytes.count >= 16 && bytes.count <= maxMediaBytes else { throw VaultError.invalidInput("Mỗi ảnh tối đa 25 MB.") }
        let encrypted = try encryptMediaData(id: id, mime: mime, plain: bytes)
        let url = mediaURL.appendingPathComponent("\(id).bin")
        try encrypted.write(to: url, options: .atomic)
        applyProtection(to: url)
    }

    func readMedia(id: String) throws -> (data: Data, mime: String) {
        try validateMediaID(id)
        let url = mediaURL.appendingPathComponent("\(id).bin")
        let encrypted = try Data(contentsOf: url, options: [.mappedIfSafe])
        return try decryptMediaData(id: id, encrypted: encrypted)
    }

    func deleteMedia(id: String) throws {
        try validateMediaID(id)
        let url = mediaURL.appendingPathComponent("\(id).bin")
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }

    func setBiometricEnabled(_ enabled: Bool) throws {
        var metadata = try readAuthMetadata()
        if enabled {
            guard biometricAvailable() else { throw VaultError.biometricUnavailable }
            guard let master = withMasterKey({ $0 }) else { throw VaultError.locked }
            let masterData = master.withUnsafeBytes { Data($0) }
            try storeBiometricKey(masterData)
            metadata.biometricEnabled = true
            do {
                try writeAuthMetadata(metadata)
            } catch {
                deleteBiometricKey()
                throw error
            }
        } else {
            metadata.biometricEnabled = false
            try writeAuthMetadata(metadata)
            deleteBiometricKey()
        }
    }

    func unlockWithBiometrics() throws {
        let metadata = try readAuthMetadata()
        guard metadata.biometricEnabled else { throw VaultError.biometricUnavailable }
        guard biometricAvailable() else { throw VaultError.biometricUnavailable }
        let data = try retrieveBiometricKey()
        guard data.count == 32 else { throw VaultError.biometricFailed }
        setMasterKey(SymmetricKey(data: data))
    }

    func exportBackup(password: String) throws -> URL {
        try validatePassword(password, minimum: 8)
        let stateData = try loadRequiredStateData()
        let mediaList = try mediaListFromState(stateData)
        let salt = try randomData(count: 16)
        let backupKey = try deriveKey(password: password, salt: salt, iterations: defaultIterations)

        let filename = "so-relax-\(Self.dateStamp()).sobackup"
        let outURL = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        try? FileManager.default.removeItem(at: outURL)
        FileManager.default.createFile(atPath: outURL.path, contents: nil)
        let handle = try FileHandle(forWritingTo: outURL)
        defer { try? handle.close() }

        var header = Data()
        header.append(backupMagic)
        header.appendBE(defaultIterations)
        header.append(salt)
        header.appendBE(UInt32(mediaList.count + 1))
        try handle.write(contentsOf: header)

        try writeBackupRecord(handle: handle, type: 1, name: "state", mime: "application/json", plain: stateData, key: backupKey)
        for item in mediaList {
            let media = try readMedia(id: item.id)
            guard media.mime == item.mime else { throw VaultError.corruptData }
            try writeBackupRecord(handle: handle, type: 2, name: item.id, mime: media.mime, plain: media.data, key: backupKey)
        }
        return outURL
    }

    func restoreBackup(from url: URL, password: String) throws {
        try validatePassword(password, minimum: 8)
        let root = rootURL
        let stage = root.appendingPathComponent(".restore-staging-\(UUID().uuidString)", isDirectory: true)
        let stageMedia = stage.appendingPathComponent("Media", isDirectory: true)
        let stageVault = stage.appendingPathComponent("vault.bin")
        try FileManager.default.createDirectory(at: stageMedia, withIntermediateDirectories: true)
        applyProtection(to: stage)
        applyProtection(to: stageMedia)
        var shouldCleanStage = true
        defer { if shouldCleanStage { try? FileManager.default.removeItem(at: stage) } }

        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let reader = BinaryReader(handle: handle)
        guard try reader.readExact(8) == backupMagic else { throw VaultError.backupInvalid }
        let iterations: UInt32 = try reader.readBE()
        guard iterations >= 100_000 && iterations <= 1_000_000 else { throw VaultError.backupInvalid }
        let salt = try reader.readExact(16)
        let count: UInt32 = try reader.readBE()
        guard count >= 1 && count <= 20_000 else { throw VaultError.backupInvalid }
        let backupKey = try deriveKey(password: password, salt: salt, iterations: iterations)

        var stateData: Data?
        var stagedMedia = Set<String>()
        for _ in 0..<count {
            let type = try reader.readByte()
            let nameLen: UInt16 = try reader.readBE()
            let mimeLen: UInt16 = try reader.readBE()
            let sealedLen: UInt64 = try reader.readBE()
            guard nameLen > 0 && nameLen <= 200 && mimeLen <= 200 else { throw VaultError.backupInvalid }
            guard sealedLen >= 28 && sealedLen <= UInt64(maxMediaBytes + 1024 * 1024) else { throw VaultError.backupInvalid }
            let nameData = try reader.readExact(Int(nameLen))
            let mimeData = try reader.readExact(Int(mimeLen))
            guard let name = String(data: nameData, encoding: .utf8), let mime = String(data: mimeData, encoding: .utf8) else { throw VaultError.backupInvalid }
            let sealedData = try reader.readExact(Int(sealedLen))
            let aad = backupAAD(type: type, name: name, mime: mime)
            let plain: Data
            do {
                plain = try AES.GCM.open(try AES.GCM.SealedBox(combined: sealedData), using: backupKey, authenticating: aad)
            } catch {
                throw VaultError.backupInvalid
            }

            if type == 1 {
                guard name == "state", mime == "application/json", stateData == nil, plain.count <= 20 * 1024 * 1024 else { throw VaultError.backupInvalid }
                _ = try validateStateJSON(plain)
                stateData = plain
                let enc = try encryptVaultData(plain)
                try enc.write(to: stageVault, options: .atomic)
                applyProtection(to: stageVault)
            } else if type == 2 {
                try validateMediaID(name)
                guard supportedMIME.contains(mime), plain.count >= 16 && plain.count <= maxMediaBytes, !stagedMedia.contains(name) else { throw VaultError.backupInvalid }
                let enc = try encryptMediaData(id: name, mime: mime, plain: plain)
                let target = stageMedia.appendingPathComponent("\(name).bin")
                try enc.write(to: target, options: .atomic)
                applyProtection(to: target)
                stagedMedia.insert(name)
            } else {
                throw VaultError.backupInvalid
            }
        }
        guard try reader.isAtEnd() else { throw VaultError.backupInvalid }
        guard let finalState = stateData else { throw VaultError.backupInvalid }
        let expected = Set(try mediaListFromState(finalState).map(\.id))
        guard expected == stagedMedia else { throw VaultError.backupInvalid }

        try commitRestore(stage: stage)
        shouldCleanStage = false
    }

    // MARK: - Crypto and serialization

    private var supportedMIME: Set<String> { ["image/jpeg","image/png","image/webp","image/gif","image/avif"] }

    private func encryptVaultData(_ plain: Data) throws -> Data {
        guard let key = withMasterKey({ $0 }) else { throw VaultError.locked }
        let box = try AES.GCM.seal(plain, using: key, authenticating: vaultAAD)
        guard let combined = box.combined else { throw VaultError.corruptData }
        var out = Data(); out.append(vaultMagic); out.append(combined); return out
    }

    private func decryptVaultData(_ encrypted: Data) throws -> Data {
        guard let key = withMasterKey({ $0 }) else { throw VaultError.locked }
        guard encrypted.count > vaultMagic.count + 28, encrypted.prefix(vaultMagic.count) == vaultMagic else { throw VaultError.corruptData }
        do {
            let box = try AES.GCM.SealedBox(combined: Data(encrypted.dropFirst(vaultMagic.count)))
            return try AES.GCM.open(box, using: key, authenticating: vaultAAD)
        } catch { throw VaultError.corruptData }
    }

    private func encryptMediaData(id: String, mime: String, plain: Data) throws -> Data {
        guard let key = withMasterKey({ $0 }) else { throw VaultError.locked }
        let aad = Data("media:\(id):\(mime)".utf8)
        let box = try AES.GCM.seal(plain, using: key, authenticating: aad)
        guard let combined = box.combined, let mimeData = mime.data(using: .utf8), mimeData.count <= 255 else { throw VaultError.corruptData }
        var out = Data(); out.append(mediaMagic); out.appendBE(UInt16(mimeData.count)); out.append(mimeData); out.append(combined); return out
    }

    private func decryptMediaData(id: String, encrypted: Data) throws -> (data: Data, mime: String) {
        guard let key = withMasterKey({ $0 }) else { throw VaultError.locked }
        guard encrypted.count > mediaMagic.count + 2 + 28, encrypted.prefix(mediaMagic.count) == mediaMagic else { throw VaultError.corruptData }
        var offset = mediaMagic.count
        let mimeLen: UInt16 = try encrypted.readBE(at: &offset)
        guard mimeLen > 0 && mimeLen <= 200, offset + Int(mimeLen) < encrypted.count else { throw VaultError.corruptData }
        let mimeData = encrypted.subdata(in: offset..<(offset + Int(mimeLen))); offset += Int(mimeLen)
        guard let mime = String(data: mimeData, encoding: .utf8), supportedMIME.contains(mime) else { throw VaultError.corruptData }
        let combined = encrypted.subdata(in: offset..<encrypted.count)
        let aad = Data("media:\(id):\(mime)".utf8)
        do {
            let plain = try AES.GCM.open(try AES.GCM.SealedBox(combined: combined), using: key, authenticating: aad)
            return (plain, mime)
        } catch { throw VaultError.corruptData }
    }

    private func deriveKey(password: String, salt: Data, iterations: UInt32) throws -> SymmetricKey {
        guard !password.isEmpty else { throw VaultError.invalidPassword }
        guard iterations >= 100_000 && iterations <= 1_000_000 else { throw VaultError.corruptData }
        let passwordData = Data(password.utf8)
        var derived = [UInt8](repeating: 0, count: 32)
        let result: Int32 = passwordData.withUnsafeBytes { passRaw in
            salt.withUnsafeBytes { saltRaw in
                let passPtr = passRaw.baseAddress?.assumingMemoryBound(to: Int8.self)
                let saltPtr = saltRaw.baseAddress?.assumingMemoryBound(to: UInt8.self)
                return CCKeyDerivationPBKDF(
                    CCPBKDFAlgorithm(kCCPBKDF2), passPtr, passwordData.count,
                    saltPtr, salt.count, CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                    iterations, &derived, derived.count
                )
            }
        }
        guard result == kCCSuccess else { throw VaultError.corruptData }
        return SymmetricKey(data: Data(derived))
    }

    private func randomData(count: Int) throws -> Data {
        var bytes = [UInt8](repeating: 0, count: count)
        let result = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        guard result == errSecSuccess else { throw VaultError.io("Không tạo được khóa ngẫu nhiên an toàn.") }
        return Data(bytes)
    }

    private func validatePassword(_ password: String, minimum: Int) throws {
        guard password.count >= minimum && password.count <= 256 else { throw VaultError.invalidInput("Mật khẩu cần từ \(minimum) ký tự.") }
    }

    private func validateMediaID(_ id: String) throws {
        let pattern = "^[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}$"
        guard id.range(of: pattern, options: .regularExpression) != nil else { throw VaultError.invalidInput("ID ảnh không hợp lệ.") }
    }

    private func validateStateJSON(_ data: Data) throws -> [String: Any] {
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              object["settings"] is [String: Any], object["monthPlans"] is [String: Any] else { throw VaultError.backupInvalid }
        for key in ["accounts","transactions","budgets","dailyEntries","privateEntries","goals","media"] {
            guard object[key] is [Any] else { throw VaultError.backupInvalid }
        }
        return object
    }

    private struct MediaStateItem { let id: String; let mime: String }
    private func mediaListFromState(_ stateData: Data) throws -> [MediaStateItem] {
        let object = try validateStateJSON(stateData)
        guard let media = object["media"] as? [[String: Any]] else { throw VaultError.backupInvalid }
        var seen = Set<String>()
        return try media.map { item in
            guard let id = item["id"] as? String, let mime = item["mime"] as? String, supportedMIME.contains(mime), !seen.contains(id) else { throw VaultError.backupInvalid }
            try validateMediaID(id); seen.insert(id); return MediaStateItem(id: id, mime: mime)
        }
    }

    private func loadRequiredStateData() throws -> Data {
        guard FileManager.default.fileExists(atPath: vaultURL.path) else { throw VaultError.corruptData }
        return try decryptVaultData(Data(contentsOf: vaultURL, options: [.mappedIfSafe]))
    }

    // MARK: - Auth metadata / files

    private func ensureDirectories() throws {
        try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: mediaURL, withIntermediateDirectories: true)
        applyProtection(to: rootURL); applyProtection(to: mediaURL)
    }

    private func readAuthMetadata() throws -> AuthMetadata {
        guard FileManager.default.fileExists(atPath: authURL.path) else { throw VaultError.notConfigured }
        do {
            let data = try Data(contentsOf: authURL)
            let metadata = try JSONDecoder().decode(AuthMetadata.self, from: data)
            guard metadata.version == 1 else { throw VaultError.corruptData }
            return metadata
        } catch let error as VaultError { throw error }
        catch { throw VaultError.corruptData }
    }

    private func writeAuthMetadata(_ metadata: AuthMetadata) throws {
        try ensureDirectories()
        let data = try JSONEncoder().encode(metadata)
        try data.write(to: authURL, options: .atomic)
        applyProtection(to: authURL)
    }

    private func applyProtection(to url: URL) {
        try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: url.path)
    }

    private func setMasterKey(_ key: SymmetricKey?) {
        lock.lock(); masterKey = key; lock.unlock()
    }

    private func withMasterKey<T>(_ body: (SymmetricKey?) -> T) -> T {
        lock.lock(); defer { lock.unlock() }; return body(masterKey)
    }

    // MARK: - Biometrics / Keychain

    private func biometricAvailable() -> Bool {
        let context = LAContext(); var error: NSError?
        return context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
    }

    private func keychainBaseQuery() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: keychainService, kSecAttrAccount as String: keychainAccount]
    }

    private func storeBiometricKey(_ data: Data) throws {
        deleteBiometricKey()
        var error: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, .biometryCurrentSet, &error) else { throw VaultError.biometricUnavailable }
        var query = keychainBaseQuery()
        query[kSecValueData as String] = data
        query[kSecAttrAccessControl as String] = access
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw VaultError.biometricUnavailable }
    }

    private func retrieveBiometricKey() throws -> Data {
        let context = LAContext()
        context.localizedReason = "Mở Sổ Relax"
        var query = keychainBaseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecUseAuthenticationContext as String] = context
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { throw VaultError.biometricFailed }
        return data
    }

    private func deleteBiometricKey() {
        SecItemDelete(keychainBaseQuery() as CFDictionary)
    }

    // MARK: - Backup

    private func backupAAD(type: UInt8, name: String, mime: String) -> Data {
        Data("\(type)|\(name)|\(mime)".utf8)
    }

    private func writeBackupRecord(handle: FileHandle, type: UInt8, name: String, mime: String, plain: Data, key: SymmetricKey) throws {
        guard let nameData = name.data(using: .utf8), let mimeData = mime.data(using: .utf8), nameData.count <= 200, mimeData.count <= 200 else { throw VaultError.backupInvalid }
        let aad = backupAAD(type: type, name: name, mime: mime)
        let box = try AES.GCM.seal(plain, using: key, authenticating: aad)
        guard let combined = box.combined else { throw VaultError.backupInvalid }
        var header = Data([type])
        header.appendBE(UInt16(nameData.count)); header.appendBE(UInt16(mimeData.count)); header.appendBE(UInt64(combined.count))
        header.append(nameData); header.append(mimeData)
        try handle.write(contentsOf: header); try handle.write(contentsOf: combined)
    }

    private func commitRestore(stage: URL) throws {
        let fm = FileManager.default
        let rollback = rootURL.appendingPathComponent(".restore-rollback-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: rollback, withIntermediateDirectories: true)
        let rollbackVault = rollback.appendingPathComponent("vault.bin")
        let rollbackMedia = rollback.appendingPathComponent("Media", isDirectory: true)
        let stageVault = stage.appendingPathComponent("vault.bin")
        let stageMedia = stage.appendingPathComponent("Media", isDirectory: true)
        guard fm.fileExists(atPath: stageVault.path), fm.fileExists(atPath: stageMedia.path) else { throw VaultError.backupInvalid }

        var oldVaultMoved = false, oldMediaMoved = false
        do {
            if fm.fileExists(atPath: vaultURL.path) { try fm.moveItem(at: vaultURL, to: rollbackVault); oldVaultMoved = true }
            if fm.fileExists(atPath: mediaURL.path) { try fm.moveItem(at: mediaURL, to: rollbackMedia); oldMediaMoved = true }
            try fm.moveItem(at: stageVault, to: vaultURL)
            try fm.moveItem(at: stageMedia, to: mediaURL)
            applyProtection(to: vaultURL); applyProtection(to: mediaURL)
            try? fm.removeItem(at: rollback)
            try? fm.removeItem(at: stage)
        } catch {
            try? fm.removeItem(at: vaultURL)
            try? fm.removeItem(at: mediaURL)
            if oldVaultMoved { try? fm.moveItem(at: rollbackVault, to: vaultURL) }
            if oldMediaMoved { try? fm.moveItem(at: rollbackMedia, to: mediaURL) }
            try? fm.removeItem(at: rollback)
            throw VaultError.io("Khôi phục thất bại; dữ liệu cũ đã được giữ nguyên.")
        }
    }

    private static func dateStamp() -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd-HHmmss"; return f.string(from: Date())
    }
}

private final class BinaryReader {
    private let handle: FileHandle
    init(handle: FileHandle) { self.handle = handle }

    func readExact(_ count: Int) throws -> Data {
        guard count >= 0, let data = try handle.read(upToCount: count), data.count == count else { throw SecureVault.VaultError.backupInvalid }
        return data
    }
    func readByte() throws -> UInt8 { try readExact(1)[0] }
    func readBE<T: FixedWidthInteger>() throws -> T {
        let data = try readExact(MemoryLayout<T>.size)
        var value: T = 0
        for byte in data { value = (value << 8) | T(byte) }
        return value
    }
    func isAtEnd() throws -> Bool {
        let data = try handle.read(upToCount: 1)
        return data?.isEmpty ?? true
    }
}

private extension Data {
    mutating func appendBE<T: FixedWidthInteger>(_ value: T) {
        var v = value.bigEndian
        Swift.withUnsafeBytes(of: &v) { append(contentsOf: $0) }
    }

    func readBE<T: FixedWidthInteger>(at offset: inout Int) throws -> T {
        let size = MemoryLayout<T>.size
        guard offset >= 0, offset + size <= count else { throw SecureVault.VaultError.corruptData }
        var value: T = 0
        for byte in self[offset..<(offset + size)] { value = (value << 8) | T(byte) }
        offset += size
        return value
    }
}
