/**
 * Client "My Projects" — Create flow uses uiCopy for visible feedback (empty name, loading).
 * Interaction: the create row must stay outside ScrollView on RN Web (see ProjectsView in
 * ClientWebApp) so Pressable/onPress is not swallowed by the scroll responder.
 */
import { uiCopy } from '../../constants/uiCopy';

describe('Client My Projects create (uiCopy contract)', () => {
  it('defines createNameRequired for empty-name feedback', () => {
    expect(uiCopy.projects.createNameRequired).toMatch(/project name/i);
    expect(uiCopy.projects.createNameRequired.length).toBeGreaterThan(5);
  });

  it('defines creatingProject for loading state on Create button', () => {
    expect(uiCopy.projects.creatingProject).toMatch(/creating/i);
  });
});
