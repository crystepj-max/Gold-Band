import { describe, expect, it } from 'vitest';
import { resolveWindowControlsPolicy } from '../src/lib/window-controls';

describe('resolveWindowControlsPolicy', () => {
  it('uses native macOS traffic lights with overlay title bar', () => {
    expect(resolveWindowControlsPolicy('macos')).toEqual({
      decorations: true,
      titleBarStyle: 'overlay',
      showCustomControls: false,
      leadingInsetClassName: 'pl-[72px]',
    });
  });

  it('keeps undecorated custom controls on windows', () => {
    expect(resolveWindowControlsPolicy('windows')).toEqual({
      decorations: false,
      titleBarStyle: null,
      showCustomControls: true,
      leadingInsetClassName: '',
    });
  });
});
