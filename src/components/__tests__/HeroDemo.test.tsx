// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock the reduced motion hook
vi.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: vi.fn(() => false),
}));

import HeroDemo from '../HeroDemo';
import { useReducedMotion } from '@/hooks/useReducedMotion';

const mockedUseReducedMotion = vi.mocked(useReducedMotion);

// Mock IntersectionObserver
const mockObserve = vi.fn();
const mockDisconnect = vi.fn();
class MockIntersectionObserver {
  constructor(public callback: IntersectionObserverCallback) {}
  observe = mockObserve;
  disconnect = mockDisconnect;
  unobserve = vi.fn();
  root = null;
  rootMargin = '';
  thresholds = [0];
  takeRecords = vi.fn(() => []);
}
vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

describe('HeroDemo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseReducedMotion.mockReturnValue(false);
  });

  it('renders <video> with correct attributes', () => {
    const { container } = render(<HeroDemo />);
    const video = container.querySelector('video') as HTMLVideoElement;
    expect(video).not.toBeNull();
    // React sets boolean attributes as properties, not HTML attributes
    expect(video.autoplay).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    // playsInline is set via attribute in jsdom
    expect(video.playsInline || video.hasAttribute('playsinline')).toBe(true);
  });

  it('has WebM and MP4 <source> elements with correct paths', () => {
    const { container } = render(<HeroDemo />);
    const sources = container.querySelectorAll('source');
    expect(sources.length).toBe(2);

    const webm = Array.from(sources).find(s => s.getAttribute('type') === 'video/webm');
    const mp4 = Array.from(sources).find(s => s.getAttribute('type') === 'video/mp4');

    expect(webm).not.toBeUndefined();
    expect(webm!.getAttribute('src')).toBe('/demo/hero-demo.webm');
    expect(mp4).not.toBeUndefined();
    expect(mp4!.getAttribute('src')).toBe('/demo/hero-demo.mp4');
  });

  it('has poster attribute', () => {
    const { container } = render(<HeroDemo />);
    const video = container.querySelector('video');
    expect(video!.getAttribute('poster')).toBe('/demo/hero-demo-poster.png');
  });

  it('has aria-label for accessibility', () => {
    const { container } = render(<HeroDemo />);
    const video = container.querySelector('video');
    expect(video!.getAttribute('aria-label')).toContain('CLIaaS');
  });

  it('renders static <pre> fallback when prefers-reduced-motion is enabled', () => {
    mockedUseReducedMotion.mockReturnValue(true);
    const { container } = render(<HeroDemo />);

    // No video
    expect(container.querySelector('video')).toBeNull();

    // Has <pre> with static content
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
  });

  it('static fallback contains key content strings', () => {
    mockedUseReducedMotion.mockReturnValue(true);
    render(<HeroDemo />);

    expect(screen.getByText('hi Claude, install cliaas')).toBeInTheDocument();
    expect(screen.getByText(/2,847 tickets synced/)).toBeInTheDocument();
  });

  it('sets up IntersectionObserver for play/pause', () => {
    render(<HeroDemo />);
    expect(mockObserve).toHaveBeenCalled();
  });
});
