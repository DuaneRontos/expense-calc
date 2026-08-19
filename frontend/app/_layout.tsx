import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { palette } from '../src/theme/tokens';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          // `AppShell` renders the app's own header on every screen, so the
          // navigator's would be a second one — and it labels screens with the
          // route file name, so it read "index" and "expenses" in lower case
          // above the real title. It also drew a back chevron between two peer
          // destinations that have no parent/child relationship.
          headerShown: false,
          contentStyle: { backgroundColor: palette.background },
        }}
      />
    </SafeAreaProvider>
  );
}
