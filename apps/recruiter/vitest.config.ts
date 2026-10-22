import { baseTest } from '@trace/config/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { ...baseTest, environment: 'node' } });
