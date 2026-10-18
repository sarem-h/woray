import AppIntents
internal import ExpoAppIntents
import Foundation

/// Native App Intent invoked directly by the iPhone 17 Action Button or Siri Shortcut.
/// When the user holds the Action Button, `openAppWhenRun = true` causes iOS to immediately
/// bring VoiceOS into the active foreground and dispatches the action event into the
/// ExpoAppIntents bridge queue.
struct StartVoiceSessionIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Voice Session"
    static var description: IntentDescription = "Immediately activates a real-time VoiceOS voice assistant session."
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        // 1. Redundant native persistence in standard defaults
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "voiceos_action_button_timestamp")
        UserDefaults.standard.synchronize()

        // 2. Dispatch invocation to ExpoAppIntents bridge queue for JS consumption
        await AppIntentDispatcher.shared.dispatch(
            name: "startVoiceSession",
            params: [
                "trigger": "action_button",
                "timestamp": .double(Date().timeIntervalSince1970)
            ]
        )

        // 3. Post notification inside active app process
        NotificationCenter.default.post(
            name: NSNotification.Name("VoiceOSStartVoiceSession"),
            object: nil,
            userInfo: ["trigger": "action_button"]
        )

        return .result()
    }
}
