// CRITICAL: registerGlobals initializes the native WebRTC C++ core and configures
// iOS AVAudioSession in bidirectional voice-communication mode with hardware
// Acoustic Echo Cancellation (AEC). It MUST run before any component or LiveKit logic loads.
import { registerGlobals } from '@livekit/react-native';
registerGlobals();

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
