import AppIntents
import Foundation
import UIKit

/// Native App Intent invoked directly by the iPhone 17 Action Button or Siri Shortcut.
/// When the user holds the Action Button, `openAppWhenRun = true` causes iOS to immediately
/// bring Woray into the active foreground.
/// The intent dispatches the deep link URL `woray://start?trigger=action_button`
/// so the React Native JavaScript layer handles the session initialization instantly.
struct StartVoiceSessionIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Voice Session"
    static var description: IntentDescription = "Immediately activates a real-time Woray voice assistant session."
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        // Record timestamp in standard defaults for redundancy
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "woray_action_button_timestamp")
        UserDefaults.standard.synchronize()

        // Trigger deep link into running React Native app (handled by expo-linking)
        let timestamp = Date().timeIntervalSince1970
        if let url = URL(string: "woray://start?trigger=action_button&ts=\(timestamp)") {
            await UIApplication.shared.open(url)
        }

        return .result()
    }
}
