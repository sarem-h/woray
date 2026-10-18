import AppIntents

/// Registers VoiceOS shortcuts with iOS system services.
/// Conforming to AppShortcutsProvider makes this shortcut discoverable in
/// iOS Settings -> Action Button -> Shortcut, Siri, and the Shortcuts app
/// with zero manual configuration required by the end user.
struct AppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartVoiceSessionIntent(),
            phrases: [
                "Activate VoiceOS with \(.applicationName)",
                "Start voice session in \(.applicationName)",
                "Talk to \(.applicationName)",
                "Open \(.applicationName) Assistant"
            ],
            shortTitle: "Activate VoiceOS",
            systemImageName: "waveform.circle.fill"
        )
    }
}
