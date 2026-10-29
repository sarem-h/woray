import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import { LiveKitRoom } from '@livekit/react-native';
import { useWoraySession } from './hooks/useWoraySession';
import { MainScreen } from './screens/MainScreen';

export default function App() {
  const session = useWoraySession();

  const inner = <MainScreen session={session} />;

  // When a session is active we have a LiveKit token + URL: mount the room
  // declaratively (exactly as before) and bridge the in-room logic via
  // session.RoomSessionView. Otherwise render the plain UI.
  if (session.roomToken && session.roomServerUrl) {
    return (
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
        <SafeAreaView style={styles.root}>
          <session.RoomSessionView />
          {inner}
        </SafeAreaView>
      </LiveKitRoom>
    );
  }

  return <SafeAreaView style={styles.root}>{inner}</SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
});
