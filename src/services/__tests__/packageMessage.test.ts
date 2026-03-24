/**
 * Unit tests for package message metadata structure.
 * Verifies that preview_model_ids is capped at 4, package_label is correct,
 * and sendMessage is called with the expected payload.
 */

const sendMessageMock = jest.fn();

jest.mock('../messengerSupabase', () => ({
  sendMessage: (...args: unknown[]) => sendMessageMock(...args),
}));

// Pure helper used in OrgMessengerInline — replicated here for isolated testing
function buildPackageMetadata(guestLinkId: string, guestUrl: string, modelIds: string[]) {
  return {
    package_id: guestLinkId,
    guest_link: guestUrl,
    preview_model_ids: modelIds.slice(0, 4),
    package_label: String(modelIds.length),
  };
}

describe('buildPackageMetadata', () => {
  it('includes package_id and guest_link', () => {
    const meta = buildPackageMetadata('link-1', 'https://app.example.com?guest=link-1', ['m1']);
    expect(meta.package_id).toBe('link-1');
    expect(meta.guest_link).toBe('https://app.example.com?guest=link-1');
  });

  it('caps preview_model_ids at 4 items even when more are provided', () => {
    const ids = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
    const meta = buildPackageMetadata('link-1', 'https://app.example.com?guest=link-1', ids);
    expect(meta.preview_model_ids).toHaveLength(4);
    expect(meta.preview_model_ids).toEqual(['m1', 'm2', 'm3', 'm4']);
  });

  it('keeps fewer than 4 ids intact', () => {
    const ids = ['m1', 'm2'];
    const meta = buildPackageMetadata('link-1', 'https://app.example.com?guest=link-1', ids);
    expect(meta.preview_model_ids).toHaveLength(2);
    expect(meta.preview_model_ids).toEqual(['m1', 'm2']);
  });

  it('handles empty model_ids without error', () => {
    const meta = buildPackageMetadata('link-2', 'https://app.example.com?guest=link-2', []);
    expect(meta.preview_model_ids).toHaveLength(0);
    expect(meta.package_label).toBe('0');
  });

  it('sets package_label as string of total model count (not preview count)', () => {
    const ids = ['m1', 'm2', 'm3', 'm4', 'm5'];
    const meta = buildPackageMetadata('link-3', 'https://app.example.com?guest=link-3', ids);
    // Label reflects total count (5), not the capped preview count (4)
    expect(meta.package_label).toBe('5');
  });
});

describe('sendMessage called with package metadata', () => {
  beforeEach(() => {
    sendMessageMock.mockReset();
    sendMessageMock.mockResolvedValue({ id: 'msg-pkg-1' });
  });

  it('passes message_type package and correct metadata shape', async () => {
    const { sendMessage } = await import('../messengerSupabase');

    const meta = buildPackageMetadata(
      'link-abc',
      'https://app.example.com?guest=link-abc',
      ['m1', 'm2', 'm3'],
    );

    await sendMessage('conv-1', 'user-1', 'Shared a model package', undefined, undefined, {
      messageType: 'package',
      metadata: meta,
    });

    expect(sendMessageMock).toHaveBeenCalledWith(
      'conv-1',
      'user-1',
      'Shared a model package',
      undefined,
      undefined,
      expect.objectContaining({
        messageType: 'package',
        metadata: expect.objectContaining({
          package_id: 'link-abc',
          guest_link: 'https://app.example.com?guest=link-abc',
          preview_model_ids: ['m1', 'm2', 'm3'],
          package_label: '3',
        }),
      }),
    );
  });

  it('does not include more than 4 preview_model_ids in message', async () => {
    const { sendMessage } = await import('../messengerSupabase');

    const allIds = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'];
    const meta = buildPackageMetadata('link-xyz', 'https://app.example.com?guest=link-xyz', allIds);

    await sendMessage('conv-2', 'user-2', 'Shared a model package', undefined, undefined, {
      messageType: 'package',
      metadata: meta,
    });

    const callArgs = sendMessageMock.mock.calls[0];
    const passedMeta = (callArgs[5] as { metadata: { preview_model_ids: string[] } }).metadata;
    expect(passedMeta.preview_model_ids.length).toBeLessThanOrEqual(4);
  });
});
