/**
 * C++ visual parity: TACTION_TEXT_TRIGGER uses TUTORIAL.INI and MessageListClass.
 *
 * Source references:
 * - init.cpp loads TutorialTextData / TutorialTextOffsets from TUTORIAL.INI.
 * - taction.cpp TACTION_TEXT_TRIGGER pushes TutorialTextOffsets[Data.Value].
 * - msglist.cpp / init.cpp display up to 6 messages at Map.TacPixelX/Y for Rule.MessageDelay.
 */

import { describe, expect, it, vi } from 'vitest';
import { Game } from '../engine';
import { Renderer } from '../engine/renderer';
import { getTutorialText, RA_MESSAGE_DELAY_TICKS } from '../engine/tutorialText';
import { RESFACTOR } from '../engine/types';

function mockCanvas(): HTMLCanvasElement {
  return {
    width: 640,
    height: 400,
    getContext: () => ({
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      fillRect: () => {},
      strokeRect: () => {},
      clearRect: () => {},
      beginPath: () => {},
      closePath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      arc: () => {},
      fill: () => {},
      stroke: () => {},
      fillText: () => {},
      measureText: () => ({ width: 0 }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      save: () => {},
      restore: () => {},
      translate: () => {},
      drawImage: () => {},
      getImageData: () => ({ data: new Uint8ClampedArray(0) }),
      putImageData: () => {},
      canvas: { width: 640, height: 400 },
    }),
  } as unknown as HTMLCanvasElement;
}

describe('TACTION_TEXT_TRIGGER tutorial messages', () => {
  it('uses the Red Alert TUTORIAL.INI text table, not synthetic mission text', () => {
    expect(getTutorialText(8)).toBe('Find Einstein.');
    expect(getTutorialText(27)).toBe('Capture all Tech centers');
    expect(getTutorialText(28)).toBe('Destroy the Iron Curtain');
    expect(getTutorialText(39)).toBe("Don't approach the Chronosphere!");
    expect(getTutorialText(0)).toBeUndefined();
  });

  it('queues trigger text through the Game path with no fallback for unknown IDs', () => {
    const play = vi.fn();
    const gameLike = {
      evaMessages: [] as Array<{ text: string; tick: number }>,
      tick: 42,
      audio: { play },
    };

    (Game.prototype as any).showTutorialTextMessage.call(gameLike, 27);
    (Game.prototype as any).showTutorialTextMessage.call(gameLike, 999);

    expect(gameLike.evaMessages).toEqual([{ text: 'Capture all Tech centers', tick: 42 }]);
    expect(play).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledWith('eva_acknowledged');
  });
});

describe('MessageListClass visual placement', () => {
  it('renders active messages at tactical top-left for Rule.MessageDelay', () => {
    const renderer = new Renderer(mockCanvas());
    const drawBitmapText = vi.fn();
    (renderer as any).drawBitmapText = drawBitmapText;
    renderer.evaMessages = [
      { text: 'Find Einstein.', tick: 0 },
      { text: 'Capture all Tech centers', tick: 1 },
      { text: 'Destroy the Iron Curtain', tick: 2 },
    ];

    renderer.renderEvaMessages(100);

    expect(drawBitmapText).toHaveBeenCalledTimes(3);
    expect(drawBitmapText.mock.calls[0]).toEqual([
      undefined,
      'Find Einstein.',
      0,
      8 * RESFACTOR,
      '#00FF00',
      '6pt',
      { align: 'left' },
    ]);
    expect(drawBitmapText.mock.calls[1][3]).toBe(15 * RESFACTOR);
    expect(drawBitmapText.mock.calls[2][3]).toBe(22 * RESFACTOR);
  });

  it('keeps messages visible past the previous 60-tick cutoff and expires them at C++ delay', () => {
    const renderer = new Renderer(mockCanvas());
    const drawBitmapText = vi.fn();
    (renderer as any).drawBitmapText = drawBitmapText;
    renderer.evaMessages = [{ text: 'Find Einstein.', tick: 0 }];

    renderer.renderEvaMessages(RA_MESSAGE_DELAY_TICKS - 1);
    expect(drawBitmapText).toHaveBeenCalledTimes(1);

    drawBitmapText.mockClear();
    renderer.renderEvaMessages(RA_MESSAGE_DELAY_TICKS);
    expect(drawBitmapText).not.toHaveBeenCalled();
  });
});
