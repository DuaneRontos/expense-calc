import { Text, View } from 'react-native';

import { AppShell } from '../src/layout/AppShell';
import { useNavItems } from '../src/layout/useNavItems';
import { palette, spacing } from '../src/theme/tokens';

/**
 * A second route, so the scaffold proves navigation rather than asserting it.
 *
 * On web this is `/expenses` — a real URL that deep-links, reloads, and works
 * with the back button, which is what issue #3 asks for and what a desktop user
 * assumes without being told. The list itself is #14.
 */
export default function Expenses() {
  const nav = useNavItems();

  return (
    <AppShell title="Expenses" nav={nav}>
      <View style={{ gap: spacing.sm }}>
        <Text style={{ color: palette.text, fontWeight: '600' }}>Expense list</Text>
        <Text style={{ color: palette.textMuted }}>
          Filters, sorting, and pagination land with #14. This route exists so the scaffold can
          demonstrate a deep-linkable URL on the web target.
        </Text>
      </View>
    </AppShell>
  );
}
