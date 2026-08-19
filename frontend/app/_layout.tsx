import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppShell } from '../src/layout/AppShell';
import { palette } from '../src/theme/tokens';

/**
 * Seeds Overview beneath any deep-linked child.
 *
 * Without it, a cold `expensecalc://expenses` open on iOS or Android mounts a
 * stack containing only that route — so the Android hardware back button and
 * the iOS swipe-back exit the app from what the UI presents as a peer tab. On
 * web the same cold load is fine, because leaving the site is what Back is
 * meant to do there, which is why testing this on web alone proves nothing.
 *
 * Spelled `initialRouteName` before SDK 54.
 */
export const unstable_settings = { anchor: 'index' };

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {/*
        The shell wraps the navigator rather than sitting inside each screen, so
        the header, the nav controls and the tab bar are mounted once and stay
        put while only the screen beneath them animates.
      */}
      <AppShell>
        <Stack
          screenOptions={{
            // `AppShell` renders the app's own header, so the navigator's would
            // be a second one — and it labels screens with the route file name,
            // so it read "index" and "expenses" in lower case above the real
            // title. It also drew a back chevron between two peer destinations
            // that have no parent/child relationship.
            headerShown: false,
            contentStyle: { backgroundColor: palette.background },
          }}
        >
          {/*
            Titles are still declared with the header hidden: this is the string
            screen-change announcements read on iOS and Android.

            It does **not** drive `document.title` on web. That was the
            assumption on the first attempt, and checking the browser tab showed
            it stayed empty — with `headerShown: false` nothing consumes the
            option on that platform. The web title comes from `<Head>` in each
            route instead, so both mechanisms are deliberate, not redundant.
          */}
          <Stack.Screen name="index" options={{ title: 'Overview' }} />
          <Stack.Screen name="expenses" options={{ title: 'Expenses' }} />
        </Stack>
      </AppShell>
    </SafeAreaProvider>
  );
}
