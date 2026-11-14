/** Defense in depth only. This cannot classify all private data or grant sharing
 * permission: the host must minimize/redact content under its authorization rules.
 * Reject obvious credentials rather than silently changing the reported meaning.
 */
export function assertContextSafe(text:string):void {
  const patterns=[
    /-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----/i,
    /\bauthorization["']?\s*[:=]\s*["']?bearer\s+[a-z0-9._~+\/-]{8,}/i,
    /\b(?:password|passwd|api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|connection)["']?\s*[:=]\s*["']?[a-z0-9._~+\/-]{16,}/i,
    /\bsk-(?:proj-)?[a-z0-9_-]{24,}/i,
  ];
  if(patterns.some(pattern=>pattern.test(text)))throw Object.assign(new Error('Remove credentials before saving host context. Context storage does not grant permission to share sensitive data.'),{code:'sensitive_context'});
}
