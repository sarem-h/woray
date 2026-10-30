import React from 'react';
import { View, SafeAreaView, StyleSheet } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { LiveKitRoom } from '@livekit/react-native';
import { useWoraySession } from './hooks/useWoraySession';
import { MainScreen } from './screens/MainScreen';
import { Background } from './components/background';

export default function App() {
  const session = useWoraySession();

  const inner = <MainScreen session={session} />;

  // Single full-bleed background layer (edge-to-edge, behind everything),
  // then the transparent SafeAreaView content on top. All background styling
  // is owned by components/background/Background.tsx.
  const frame = (children: React.ReactNode) => (
    <View style={styles.frame}>
      <Background />
      <SafeAreaView style={styles.root}>{children}</SafeAreaView>
    </View>
  );

  // When a session is active we have a LiveKit token + URL: mount the room
  // declaratively (exactly as before) and bridge the in-room logic via
  // session.RoomSessionView. Otherwise render the plain UI.
  return (
    <KeyboardProvider>
      {session.roomToken && session.roomServerUrl ? (
        <LiveKitRoom
          serverUrl={session.roomServerUrl}
          token={session.roomToken}
          connect={session.liveKitRoomProps.connect}
          audio={session.liveKitRoomProps.audio}
          video={session.liveKitRoomProps.video}
          onDisconnected={session.liveKitRoomProps.onDisconnected}
          onError={session.liveKitRoomProps.onError}
          options={session.liveKitRoomProps.options}
        >
          {frame(
            <>
              <session.RoomSessionView />
              {inner}
            </>
          )}
        </LiveKitRoom>
      ) : (
        frame(inner)
      )}
    </KeyboardProvider>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1 },
  root: { flex: 1 },
});
