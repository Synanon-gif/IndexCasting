import {
  deviceTypeFromWidth,
  isDesktopWidth,
  isMobileWidth,
  isTabletWidth,
} from '../breakpoints';

describe('breakpoints', () => {
  it('classifies mobile', () => {
    expect(isMobileWidth(768)).toBe(true);
    expect(deviceTypeFromWidth(400)).toBe('mobile');
    expect(deviceTypeFromWidth(768)).toBe('mobile');
  });

  it('classifies tablet', () => {
    expect(isTabletWidth(900)).toBe(true);
    expect(isDesktopWidth(900)).toBe(false);
    expect(deviceTypeFromWidth(900)).toBe('tablet');
  });

  it('classifies desktop', () => {
    expect(isDesktopWidth(1024)).toBe(true);
    expect(deviceTypeFromWidth(1024)).toBe('desktop');
    expect(deviceTypeFromWidth(1400)).toBe('desktop');
  });
});
