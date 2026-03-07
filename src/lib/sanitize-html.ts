/**
 * Sanitize HTML by removing all dangerous elements and attributes.
 * Strips: script, style, iframe, object, embed, form, input tags.
 * Strips: all event handler attributes (on*), javascript: URIs.
 */
export function sanitizeHtml(html: string): string {
  return html
    // Remove script tags and content
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    // Remove style tags and content
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    // Remove iframe, object, embed, form, input, textarea, select, button tags
    .replace(/<\/?(iframe|object|embed|form|input|textarea|select|button|applet|meta|link|base)[^>]*>/gi, '')
    // Remove all event handler attributes (onclick, onerror, onload, onmouseover, etc.)
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // Remove javascript: URIs in any attribute
    .replace(/(href|src|action|formaction|data|poster|background)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, '')
    // Remove data: URIs with script content
    .replace(/(href|src)\s*=\s*(?:"data:text\/html[^"]*"|'data:text\/html[^']*')/gi, '');
}

/**
 * Sanitize CSS to prevent injection attacks.
 * Removes: url() with javascript/data, @import, expression(), -moz-binding.
 */
export function sanitizeCss(css: string): string {
  return css
    // Remove script/style tags that might have been injected
    .replace(/<\/?style[^>]*>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    // Remove url() with javascript: or data:text/html
    .replace(/url\s*\(\s*(['"]?)\s*javascript:/gi, 'url($1blocked:')
    .replace(/url\s*\(\s*(['"]?)\s*data:text\/html/gi, 'url($1blocked:')
    // Remove @import (can load external CSS with exfiltration)
    .replace(/@import\b[^;]*/gi, '/* @import blocked */')
    // Remove expression() (IE CSS expressions)
    .replace(/expression\s*\(/gi, 'blocked(')
    // Remove -moz-binding (Firefox XBL binding)
    .replace(/-moz-binding\s*:/gi, '/* blocked */');
}
