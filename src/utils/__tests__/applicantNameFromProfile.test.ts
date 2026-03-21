import { splitProfileDisplayName, normalizeNamePart } from '../applicantNameFromProfile';

describe('applicantNameFromProfile', () => {
  it('splitProfileDisplayName: zwei Wörter', () => {
    expect(splitProfileDisplayName('Anna  Schmidt')).toEqual({ firstName: 'Anna', lastName: 'Schmidt' });
  });

  it('splitProfileDisplayName: ein Wort', () => {
    expect(splitProfileDisplayName('Madonna')).toEqual({ firstName: 'Madonna', lastName: '' });
  });

  it('splitProfileDisplayName: mehrere Wörter im Nachnamen', () => {
    expect(splitProfileDisplayName('Jean  Pierre van Damme')).toEqual({
      firstName: 'Jean',
      lastName: 'Pierre van Damme',
    });
  });

  it('normalizeNamePart', () => {
    expect(normalizeNamePart('  ANNA ')).toBe('anna');
  });
});
