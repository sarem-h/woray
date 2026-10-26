import AppIntents
import Foundation

struct StartVoiceSessionIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Voice Session"
    static var description: IntentDescription = "Immediately activates a real-time Woray voice assistant session."
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        let timestamp = Date().timeIntervalSince1970
        UserDefaults.standard.set(timestamp, forKey: "woray_action_button_timestamp")
        UserDefaults.standard.set("action_button", forKey: "woray_trigger_source")
        UserDefaults.standard.synchronize()
        return .result()
    }
}
