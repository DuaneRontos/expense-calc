import { render, screen } from '@testing-library/react-native';

import { Input } from '../Input';

describe('Input', () => {
  it('treats readOnly as not editable, in both the look and the behaviour', async () => {
    // `InputProps` advertises the whole `TextInputProps` surface, and RN
    // resolves the pair itself: `editable={readOnly !== undefined ? !readOnly
    // : editable}` (`TextInput.js:928`). So `readOnly` alone used to leave this
    // component's own `editable` at its `true` default — genuinely uneditable,
    // and drawn as though it were not.
    await render(<Input accessibilityLabel="Locked" readOnly />);

    const input = screen.getByLabelText('Locked');

    expect(input.props.className).toContain('bg-surface');
    expect(input.props.className).toContain('text-textMuted');
    expect(input.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('lets readOnly={false} win over editable={false}, as react-native does', async () => {
    // Deliberately pinning RN's own precedence rather than inventing one:
    // whichever way the two disagree, the look must follow the behaviour.
    await render(<Input accessibilityLabel="Open" readOnly={false} editable={false} />);

    expect(screen.getByLabelText('Open').props.className).toContain('bg-background');
  });

  it('merges a caller’s accessibilityState rather than dropping the disabled flag', async () => {
    await render(
      <Input accessibilityLabel="Amount" editable={false} accessibilityState={{ busy: true }} />,
    );

    expect(screen.getByLabelText('Amount').props.accessibilityState).toMatchObject({
      disabled: true,
      busy: true,
    });
  });
});
