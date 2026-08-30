import { render, screen } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../Card';
import { Text } from '../Text';

describe('Card', () => {
  it('renders each region', async () => {
    await render(
      <Card>
        <CardHeader>
          <CardTitle>October</CardTitle>
          <CardDescription>Net of refunds</CardDescription>
        </CardHeader>
        <CardContent>
          <Text>₱1,234.50</Text>
        </CardContent>
        <CardFooter>
          <Text>7 expenses</Text>
        </CardFooter>
      </Card>,
    );

    expect(screen.getByText('October')).toBeOnTheScreen();
    expect(screen.getByText('Net of refunds')).toBeOnTheScreen();
    expect(screen.getByText('₱1,234.50')).toBeOnTheScreen();
    expect(screen.getByText('7 expenses')).toBeOnTheScreen();
  });

  it('exposes its title as a heading', async () => {
    // So a screen reader user can navigate by heading the way a sighted user
    // scans for the card, rather than the title being a heading by font size
    // alone.
    await render(
      <Card>
        <CardHeader>
          <CardTitle>October</CardTitle>
        </CardHeader>
      </Card>,
    );

    expect(screen.getByRole('header', { name: 'October' })).toBeOnTheScreen();
  });
});

describe('Text', () => {
  it('takes the class its container publishes', async () => {
    // `text-textMuted`, which `Text` does **not** carry on its own. The first
    // version asserted `text-text` — `Text`'s own base class — so it passed
    // with the provider deleted outright and proved nothing. An assertion about
    // inheritance has to name something only the container supplies.
    await render(
      <CardContent>
        <Text>body</Text>
      </CardContent>,
    );

    expect(screen.getByText('body').props.className).toContain('text-textMuted');
  });

  it('lets the caller win over the inherited class', async () => {
    // Context first, caller last, resolved by `cn` — so a one-off override does
    // not need the container to know about it.
    await render(
      <CardContent>
        <Text className="text-negative">refund</Text>
      </CardContent>,
    );

    expect(screen.getByText('refund').props.className).toContain('text-negative');
  });
});

describe('Text asChild', () => {
  it('hands its props to the child instead of wrapping it', async () => {
    // The case this exists for is `CardTitle`: without it,
    // `<CardTitle asChild><Pressable/></CardTitle>` puts `role="header"` on a
    // wrapper and leaves the control beside it, so heading navigation lands
    // next to the thing rather than on it.
    await render(
      <CardTitle asChild>
        <RNText testID="slotted">October</RNText>
      </CardTitle>,
    );

    const node = screen.getByTestId('slotted');

    expect(node.props.accessibilityRole).toBe('header');
    expect(node.props.className).toContain('font-semibold');
  });

  it('renders one node, not a wrapper around one', async () => {
    await render(
      <CardTitle asChild>
        <RNText testID="slotted">October</RNText>
      </CardTitle>,
    );

    // Guards the guard: if `asChild` were ignored, the assertions above would
    // still pass on a wrapped child that inherited nothing — there would just
    // be two header nodes instead of one.
    expect(screen.getAllByRole('header')).toHaveLength(1);
  });
});
