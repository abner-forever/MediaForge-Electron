import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  width?: number;
  children: ReactNode;
}

export default function Drawer({ open, onClose, title, width = 360, children }: DrawerProps) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          style={{ position: 'fixed', inset: 0, zIndex: 8000 }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
          onClick={onClose}
        >
          <motion.div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.25)',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
          />
          <motion.div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              width,
              maxWidth: '85vw',
              background: 'var(--bg-card)',
              boxShadow: '-8px 0 28px rgba(0,0,0,0.12)',
              display: 'flex',
              flexDirection: 'column',
            }}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 16px',
              borderBottom: '1px solid var(--border-subtle)',
              flexShrink: 0,
            }}>
              {title && <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{title}</span>}
              <motion.button
                whileHover={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text)' }}
                whileTap={{ scale: 0.94 }}
                onClick={onClose}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 28,
                  height: 28,
                  borderRadius: 'var(--radius-sm)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  marginLeft: 'auto',
                }}
                aria-label="关闭"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </motion.button>
            </div>
            <div style={{ flex: 1, overflow: 'hidden', padding: '12px 16px', display: 'flex', flexDirection: 'column' }}>
              {children}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
