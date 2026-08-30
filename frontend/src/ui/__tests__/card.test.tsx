import { render, screen } from '@testing-library/react-native';

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
    await render(
      <CardContent>
        <Text>body</Text>
      </CardContent>,
    );

    expect(screen.getByText('body').props.className).toContain('text-text');
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
