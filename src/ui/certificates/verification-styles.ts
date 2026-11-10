// Standalone HTML matches the shared card and badge using existing tokens.
export const verificationStyles = `
@font-face { font-family: 'Golos Text'; font-weight: 400; font-style: normal; font-display: swap; src: url('/verify/fonts/latin') format('woff'); }
@font-face { font-family: 'Golos Text'; font-weight: 400; font-style: normal; font-display: swap; src: url('/verify/fonts/cyrillic') format('woff'); unicode-range: U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--background); color: var(--foreground); font-family: var(--font-sans); line-height: 1.6; }
a { color: var(--primary); }
a:focus-visible { outline: calc(var(--spacing) / 2) solid var(--ring); outline-offset: var(--spacing); }
h1 { font-size: var(--text-3xl); line-height: 1.2; margin: 0 0 calc(var(--spacing) * 6); }
h2 { font-size: var(--text-xl); line-height: 1.4; margin: 0; }
p { margin: 0; }
.verification-header { border-bottom: 1px solid var(--border); background: var(--card); padding: calc(var(--spacing) * 5) calc(var(--spacing) * 6); }
.verification-brand { display: inline-flex; gap: calc(var(--spacing) * 3); align-items: center; text-decoration: none; font-size: var(--text-xl); font-weight: 600; }
.verification-caption { display: block; font-size: var(--text-xs); font-weight: 400; color: var(--muted-foreground); }
.verification-main { max-width: calc(var(--page-width) / 2); margin: calc(var(--spacing) * 10) auto; padding: 0 calc(var(--spacing) * 4); }
.verification-eyebrow { color: var(--muted-foreground); font-size: var(--text-sm); margin-bottom: calc(var(--spacing) * 3); }
[data-slot=card] { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-xl); box-shadow: var(--shadow-soft); padding: calc(var(--spacing) * 6); }
[data-slot=card-header] { display: grid; gap: calc(var(--spacing) * 4); margin-bottom: calc(var(--spacing) * 6); }
[data-slot=badge] { display: inline-flex; gap: var(--spacing); align-items: center; width: fit-content; border-radius: calc(var(--radius) * 3); padding: var(--spacing) calc(var(--spacing) * 3); font-size: var(--text-sm); }
.status-success { background: var(--success-bg); color: var(--success-ink); }
.status-danger { background: var(--danger-bg); color: var(--danger-ink); }
.verification-fields { display: grid; gap: calc(var(--spacing) * 5); margin: 0; overflow-wrap: anywhere; }
dt { color: var(--muted-foreground); font-size: var(--text-sm); }
dd { margin: var(--spacing) 0 0; }
.verification-hint { margin-top: calc(var(--spacing) * 6); padding-top: calc(var(--spacing) * 5); border-top: 1px solid var(--border); font-size: var(--text-sm); }
.verification-notice { margin-top: calc(var(--spacing) * 6); padding: calc(var(--spacing) * 4); border-radius: var(--radius); background: var(--warning-bg); color: var(--warning-ink); font-size: var(--text-sm); }
.verification-retry { display: inline-flex; align-items: center; min-height: calc(var(--spacing) * 11); margin-top: calc(var(--spacing) * 4); }
.concept-notice { display: flex; gap: calc(var(--spacing) * 3); align-items: start; max-width: calc(var(--page-width) / 2); margin: calc(var(--spacing) * 8) auto; padding: 0 calc(var(--spacing) * 4); color: var(--muted-foreground); font-size: var(--text-xs); }
.concept-mark { border: 1px solid var(--border); border-radius: var(--radius); padding: var(--spacing) calc(var(--spacing) * 2); }
`;
