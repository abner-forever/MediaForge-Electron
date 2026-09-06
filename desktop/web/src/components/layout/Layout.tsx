import { useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import Sidebar from './Sidebar';
import Toast from '../ui/Toast';
import Lightbox from './Lightbox';
import ProgressOverlay from './ProgressOverlay';
import { useStore } from '../../stores';
import { put } from '../../api/base';

const isWin = typeof navigator !== 'undefined' && navigator.platform?.includes('Win');

export default function Layout() {
  const syncTheme = useStore(s => s.syncTheme);
  const pipelineRunning = useStore(s => s.pipelineRunning);
  const activeTasks = useStore(s => s.activeTasks);
  const sidebarWidthSynced = useStore(s => s.sidebarWidthSynced);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => { syncTheme(); }, [syncTheme]);

  // 同步进行中的任务到后端（桌面应用关闭时由 Electron 查询）
  useEffect(() => {
    const tasks = [...activeTasks];
    if (pipelineRunning) tasks.push('智能流水线');
    put('/api/status/active-tasks', { tasks }).catch(() => {});
  }, [activeTasks, pipelineRunning]);

  // 不在流水线页面时显示全局浮动指示器
  const showPipelineIndicator = pipelineRunning && location.pathname !== '/pipeline';

  return (
    <div className={`flex h-screen overflow-hidden${isWin ? ' win32' : ''}`} style={{ background: 'var(--bg)' }}>
      {sidebarWidthSynced && <Sidebar />}
      <main style={{
        flex: 1,
        overflow: 'hidden',
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 32px', flex: 1, minHeight: 0, width: '100%', overflowY: 'auto' }}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              style={{ minHeight: 0 }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      <Toast />
      <Lightbox />
      <ProgressOverlay />

      {/* 流水线运行中浮动指示器 */}
      {showPipelineIndicator && (
        <motion.button
          onClick={() => navigate('/pipeline')}
          className="fixed bottom-6 right-6 z-[7000] group flex items-center gap-2 rounded-full pl-3 pr-4 py-2 shadow-lg"
          style={{ background: 'var(--bg-card)', boxShadow: 'var(--card-shadow)' }}
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 360, damping: 28 }}
          title="点击查看流水线进度"
        >
          <span className="relative flex items-center justify-center w-8 h-8">
            <motion.span
              className="absolute inset-0 rounded-full bg-accent/20"
              animate={{ scale: [1, 1.8], opacity: [0.7, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
            />
            <motion.span
              className="absolute inset-1 rounded-full bg-accent/30"
              animate={{ scale: [1, 1.45], opacity: [0.6, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut', delay: 0.2 }}
            />
            <motion.span
              className="relative w-3 h-3 rounded-full bg-accent"
              animate={{ scale: [1, 1.12, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            />
          </span>
          <span className="text-xs font-medium text-text">流水线运行中</span>
        </motion.button>
      )}
    </div>
  );
}
