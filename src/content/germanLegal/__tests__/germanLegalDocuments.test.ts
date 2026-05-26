import {
  GERMAN_LEGAL_DOC_LIST,
  GERMAN_LEGAL_DOCUMENTS,
  germanLegalDocumentForRoute,
} from '../documents';
import { parseGermanLegalMarkdown } from '../parseGermanLegalMarkdown';

describe('germanLegalDocuments', () => {
  test('lists five public documents', () => {
    expect(GERMAN_LEGAL_DOC_LIST).toHaveLength(5);
  });

  test('impressum contains operator contact details', () => {
    const doc = GERMAN_LEGAL_DOCUMENTS.impressum;
    expect(doc.markdown).toContain('Ruben Elge');
    expect(doc.markdown).toContain('ruben@index-casting.com');
    expect(doc.markdown).toContain('+4915207175787');
    expect(doc.markdown).toContain('Hausmat 20');
  });

  test('TOMs, Löschkonzept and Verzeichnis have Stand date', () => {
    expect(GERMAN_LEGAL_DOCUMENTS.toms.stand).toMatch(/26\. Mai 2026/);
    expect(GERMAN_LEGAL_DOCUMENTS.loeschkonzept.stand).toMatch(/26\. Mai 2026/);
    expect(GERMAN_LEGAL_DOCUMENTS.verarbeitungsverzeichnis.stand).toMatch(/26\. Mai 2026/);
  });

  test('subprocessors names Resend and documents production TODOs', () => {
    const doc = GERMAN_LEGAL_DOCUMENTS.subprocessors;
    expect(doc.markdown).toContain('Resend');
    expect(doc.markdown).toContain('Proton Mail');
    expect(doc.markdown).toContain('Mistral AI');
    expect(doc.markdown).toMatch(/TODO.*produktiv/i);
  });

  test('route mapping resolves each document', () => {
    expect(germanLegalDocumentForRoute('legal-impressum').id).toBe('impressum');
    expect(germanLegalDocumentForRoute('legal-toms').id).toBe('toms');
  });

  test('markdown parser handles headings and bullets', () => {
    const blocks = parseGermanLegalMarkdown('## Abschnitt\n\nText.\n\n- Punkt A\n- Punkt B');
    expect(blocks.some((b) => b.type === 'h2' && b.text === 'Abschnitt')).toBe(true);
    expect(blocks.some((b) => b.type === 'ul' && b.items.length === 2)).toBe(true);
  });
});
