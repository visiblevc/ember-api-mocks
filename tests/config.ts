import { activeModel, configure } from '#src/index.ts';
import { resetConfiguration } from '#src/config.ts';

export const API_HOST = 'https://api.example.test';

export function configureDefaults(): void {
  resetConfiguration();
  configure({ apiHost: API_HOST, format: activeModel() });
}
