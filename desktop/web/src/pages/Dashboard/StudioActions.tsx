import { motion } from 'motion/react';
import { I } from './Icons';

const actionList = [
  { icon: I.search(28), title: '找图发文', desc: '搜索帖子、下载图片、筛选封面并加入队列', path: '/discovery' },
  { icon: I.edit(28), title: '写文章发文', desc: '选择模板、AI 写作、确认后发布', path: '/articles' },
  { icon: I.upload(28), title: '发布队列', desc: '管理和发布待处理内容', path: '/queue' },
  { icon: I.gear(28), title: '设置', desc: '配置大模型和平台账号', path: '/settings' },
];

export default function StudioActions({ navigate }: { navigate: (path: string) => void }) {
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <div style={{ width: 3, height: 16, borderRadius: 2, background: 'var(--accent)' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>创作工作室</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        {actionList.map((a) => (
          <motion.div
            key={a.path}
            whileHover={{ y: -4 }}
            whileTap={{ scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            onClick={() => navigate(a.path)}
            style={{
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-lg)',
              padding: '24px 20px',
              cursor: 'pointer',
              boxShadow: 'var(--card-shadow)',
            }}
          >
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 14,
            }}>
              <motion.div
                whileHover={{ scale: 1.08, rotate: -3 }}
                transition={{ type: 'spring', stiffness: 420, damping: 24 }}
                style={{
                  width: 44,
                  height: 44,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--accent-soft)',
                  color: 'var(--accent)',
                }}
              >
                {a.icon}
              </motion.div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>
                  {a.title}
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-muted)' }}>
                  {a.desc}
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
