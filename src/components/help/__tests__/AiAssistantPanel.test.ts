import { readFileSync } from 'fs';
import * as path from 'path';

describe('AiAssistantPanel UI safety', () => {
  const panelSource = readFileSync(
    path.join(process.cwd(), 'src/components/help/AiAssistantPanel.tsx'),
    'utf8',
  );

  it('keeps newest messages visible and adds safe scroll padding', () => {
    expect(panelSource).toMatch(/onContentSizeChange=\{scrollToEnd\}/);
    expect(panelSource).toMatch(/onLayout=\{scrollToEnd\}/);
    expect(panelSource).toMatch(/paddingTop: spacing\.sm/);
    expect(panelSource).toMatch(/paddingBottom: spacing\.md/);
  });

  it('gives message bubbles enough room to render long answers without top clipping', () => {
    expect(panelSource).toMatch(/paddingTop: spacing\.sm \+ 2/);
    expect(panelSource).toMatch(/overflow: 'visible'/);
    expect(panelSource).toMatch(/lineHeight: 19/);
    expect(panelSource).toMatch(/paddingTop: 1/);
  });

  it('keeps sending disabled while a request is pending', () => {
    expect(panelSource).toMatch(/draft\.trim\(\)\.length > 0 && !pending/);
    expect(panelSource).toMatch(/disabled=\{!canSend\}/);
    expect(panelSource).toMatch(/editable=\{!pending\}/);
  });

  it('always clears pending after safe assistant responses such as rate-limit messages', () => {
    expect(panelSource).toMatch(/finally \{/);
    expect(panelSource).toMatch(/setPending\(false\)/);
    expect(panelSource).toMatch(/setMessages\(\(current\) => \[/);
  });
});
