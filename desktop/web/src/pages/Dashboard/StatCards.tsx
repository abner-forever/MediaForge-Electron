import { motion } from 'motion/react';
import type { DashboardStats } from '../../api/client';
import { I } from './Icons';

export default function StatCards({ stats, navigate }: { stats: DashboardStats | null; navigate: (path: string) => void }) {
  const statList = [
    { label: '本地图片', value: stats?.local_images ?? 0, path: '/materials', icon: I.image(22) },
    { label: '发布队列', value: stats?.queue_size ?? 0, path: '/queue', icon: I.upload(22) },
    { label: '已选图片', value: stats?.selected_count ?? 0, icon: I.check(22) },
    { label: '搜索结果', value: stats?.discovery_count ?? 0, icon: I.target(22) },
  ];

  return (
    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
      {statList.map((item) => (
        <motion.div
          key={item.label}
          whileHover={item.path ? { y: -3 } : undefined}
          whileTap={item.path ? { scale: 0.985 } : undefined}
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          onClick={() => item.path && navigate(item.path)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            padding: '18px 20px',
            cursor: item.path ? 'pointer' : 'default',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          <motion.div
            whileHover={{ scale: 1.08, rotate: -3 }}
            transition={{ type: 'spring', stiffness: 420, damping: 24 }}
            style={{
              width: 42,
              height: 42,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--accent-soft)',
              color: 'var(--accent)',
            }}
          >
            {item.icon}
          </motion.div>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 24,
              fontWeight: 700,
              lineHeight: 1,
              color: 'var(--text)',
              fontFeatureSettings: '"tnum"',
              marginBottom: 5,
            }}>
              {item.value}
            </div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>
              {item.label}
            </div>
          </div>
        </motion.div>
      ))}
    </section>
  );
}
