import { Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from '@x10/shared/runtime';

import { AboutPage } from './pages/AboutPage';
import { CallPage } from './pages/CallPage';
import { GlobePage } from './pages/GlobePage';
import { HindsightPage } from './pages/HindsightPage';
import { LogbookPage } from './pages/LogbookPage';
import { StationPage } from './pages/StationPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<AppShell immersive><GlobePage /></AppShell>} />
      <Route path="/call" element={<AppShell wide><CallPage /></AppShell>} />
      <Route path="/station" element={<AppShell wide><StationPage /></AppShell>} />
      <Route path="/logbook" element={<AppShell wide><LogbookPage /></AppShell>} />
      <Route path="/hindsight" element={<AppShell wide><HindsightPage /></AppShell>} />
      <Route path="/about" element={<AppShell><AboutPage /></AppShell>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
