import { describe, it, expect } from 'vitest';
import { sanitizeHtml, sanitizeCss } from '../sanitize-html';

describe('sanitizeHtml', () => {
  it('strips script tags', () => {
    expect(sanitizeHtml('<div>ok</div><script>alert(1)</script>')).toBe('<div>ok</div>');
  });

  it('strips style tags', () => {
    expect(sanitizeHtml('<style>body{}</style><p>hi</p>')).toBe('<p>hi</p>');
  });

  it('strips iframe, object, embed tags', () => {
    expect(sanitizeHtml('<iframe src="evil.com"></iframe><p>ok</p>')).toBe('<p>ok</p>');
    expect(sanitizeHtml('<object data="x"><embed src="y"></object>')).toBe('');
  });

  it('strips event handler attributes', () => {
    expect(sanitizeHtml('<img src="x" onerror="alert(1)">')).toBe('<img src="x">');
    expect(sanitizeHtml('<div onmouseover="steal()">')).toBe('<div>');
    expect(sanitizeHtml('<svg onload="pwn()">')).toBe('<svg>');
  });

  it('strips javascript: URIs', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">click</a>')).toBe('<a >click</a>');
  });

  it('strips data:text/html URIs', () => {
    expect(sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">x</a>')).toBe('<a >x</a>');
  });

  it('strips form elements', () => {
    expect(sanitizeHtml('<form action="/steal"><input type="text"></form>')).toBe('');
  });

  it('preserves safe HTML', () => {
    const safe = '<div class="header"><h1>Welcome</h1><p>Hello world</p></div>';
    expect(sanitizeHtml(safe)).toBe(safe);
  });
});

describe('sanitizeCss', () => {
  it('blocks javascript: in url()', () => {
    expect(sanitizeCss('background: url("javascript:alert(1)")')).toContain('blocked:');
  });

  it('blocks @import', () => {
    expect(sanitizeCss('@import url("evil.css"); body { color: red; }')).toContain('@import blocked');
    expect(sanitizeCss('@import url("evil.css"); body { color: red; }')).toContain('color: red');
  });

  it('blocks expression()', () => {
    expect(sanitizeCss('width: expression(alert(1))')).toContain('blocked(');
  });

  it('blocks -moz-binding', () => {
    expect(sanitizeCss('-moz-binding: url(evil.xml)')).toContain('blocked');
  });

  it('strips script/style tags embedded in CSS', () => {
    expect(sanitizeCss('</style><script>alert(1)</script><style>')).not.toContain('<script');
  });

  it('preserves safe CSS', () => {
    const safe = '.header { color: #333; font-size: 16px; }';
    expect(sanitizeCss(safe)).toBe(safe);
  });
});
