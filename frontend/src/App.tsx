import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AppShell } from '@/components/layout/AppShell';
import { Dashboard } from '@/pages/Dashboard';
import { SearchPage } from '@/pages/SearchPage';
import { QuizPage } from '@/pages/QuizPage';
import { ReviewPage } from '@/pages/ReviewPage';
import { LibraryPage } from '@/pages/LibraryPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { CalendarPage } from '@/pages/CalendarPage';
import { MeetingsPage } from '@/pages/MeetingsPage';
import { NoteEditorPage } from '@/pages/NoteEditorPage';
import { PomodoroPage } from '@/pages/PomodoroPage';
import { MoodDashboard } from '@/pages/MoodDashboard';
import { LoginPage } from '@/pages/LoginPage';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { startWellnessScheduler, stopWellnessScheduler } from '@/lib/wellness';
import { startMeetingScheduler, stopMeetingScheduler } from '@/lib/meetingScheduler';

const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.18, ease: 'easeOut' } },
  exit:    { opacity: 0, y: -6, transition: { duration: 0.12, ease: 'easeIn' } },
};

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function WellnessScheduler() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    startWellnessScheduler();
    return () => stopWellnessScheduler();
  }, [user]);

  return null;
}

function MeetingScheduler() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    startMeetingScheduler();
    return () => stopMeetingScheduler();
  }, [user]);

  return null;
}

function AnimatedRoutes() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <motion.div key={location.pathname} variants={pageVariants} initial="initial" animate="animate" exit="exit" className="h-full">
        <Routes location={location}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/*" element={
            <ProtectedRoute>
              <WellnessScheduler />
              <MeetingScheduler />
              <AppShell>
                <ErrorBoundary>
                  <Routes>
                    <Route path="/"         element={<Dashboard />} />
                    <Route path="/search"   element={<SearchPage />} />
                    <Route path="/quiz"     element={<QuizPage />} />
                    <Route path="/review"   element={<ReviewPage />} />
                    <Route path="/library"  element={<LibraryPage />} />
                    <Route path="/calendar" element={<CalendarPage />} />
                    <Route path="/meetings" element={<MeetingsPage />} />
                    <Route path="/notes"    element={<NoteEditorPage />} />
                    <Route path="/pomodoro" element={<PomodoroPage />} />
                    <Route path="/mood" element={<MoodDashboard />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="*" element={
                      <div className="app-card p-10 text-center">
                        <p className="font-bold text-[var(--text-1)]">Page not found</p>
                        <p className="mt-1 text-sm text-[var(--text-3)]">Use the sidebar to return to a Dory workspace.</p>
                      </div>
                    } />
                  </Routes>
                </ErrorBoundary>
              </AppShell>
            </ProtectedRoute>
          } />
        </Routes>
      </motion.div>
    </AnimatePresence>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AnimatedRoutes />
    </AuthProvider>
  );
}
