// React hooks and jsx-a11y recommended rules run on apps/**/*.tsx and packages/ui/**/*.tsx (spec §10.1).
import { describe, expect, it } from 'vitest';
import { lint } from './helpers.js';

const hooksCode = `import { useState } from 'react';
export function Counter({ on }: { on: boolean }) {
  if (on) {
    const [n] = useState(0);
    return <p>{n}</p>;
  }
  return null;
}
`;

const a11yCode = `export function Logo() {
  return <img src="/logo.png" />;
}
`;

const cleanCode = `import { useState } from 'react';
export function Counter() {
  const [n] = useState(0);
  return <img src="/logo.png" alt={String(n)} />;
}
`;

const ruleIds = (file: string, code: string): (string | null)[] =>
  lint(file, code).map((m) => m.ruleId);

describe.each(['apps/candidate/src', 'apps/recruiter/src', 'packages/ui/src'])(
  '%s/**/*.tsx',
  (dir) => {
    it('reports a conditional hook call', () => {
      expect(ruleIds(`${dir}/Counter.tsx`, hooksCode)).toContain('react-hooks/rules-of-hooks');
    });

    it('reports an image without alt text', () => {
      expect(ruleIds(`${dir}/Logo.tsx`, a11yCode)).toContain('jsx-a11y/alt-text');
    });

    it('passes clean components', () => {
      expect(lint(`${dir}/Counter.tsx`, cleanCode)).toEqual([]);
    });
  },
);
