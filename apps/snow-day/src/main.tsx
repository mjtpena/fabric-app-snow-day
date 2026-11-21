import { BookOpen, CloudSnow, Gavel, Info, Radar, Snowflake } from 'lucide-react';
import type { ReactNode } from 'react';

import { mountApp } from '@x10/shared/runtime';

import { App } from './App';
import { config } from './app.config';
import './index.css';

// Phone tab-bar icons live here so app.config.ts stays JSX-free (the seed tool loads it in Node).
const ICONS: Record<string, ReactNode> = {
  '/': <Snowflake />,
  '/call': <Gavel />,
  '/station': <CloudSnow />,
  '/logbook': <BookOpen />,
  '/hindsight': <Radar />,
  '/about': <Info />,
};

mountApp({ ...config, nav: config.nav.map((n) => ({ ...n, icon: ICONS[n.to] })) }, <App />);
