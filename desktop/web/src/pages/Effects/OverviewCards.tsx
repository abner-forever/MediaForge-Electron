import type { EffectSummary } from '../../types';
import { formatCount } from '../../utils/format';

const CARDS = [
  { key: 'total_posts' as const, label: '发布总数', color: '#4e6fc2' },
  { key: 'total_reads' as const, label: '总阅读量', color: '#3b82f6' },
  { key: 'total_comments' as const, label: '总评论', color: '#10b981' },
  { key: 'total_likes' as const, label: '总点赞', color: '#f59e0b' },
];

export default function OverviewCards({ summary }: { summary: EffectSummary }) {
  return (
    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
      {CARDS.map(({ key, label, color }) => (
        <div
          key={key}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            padding: '18px 20px',
            transition: 'background 0.2s',
            boxShadow: 'var(--card-shadow)',
          }}
        >
          <div style={{
            width: 42,
            height: 42,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 'var(--radius-sm)',
            background: `${color}18`,
            color,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.04em',
          }}>
            {label.slice(0, 2)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              title={summary[key].toLocaleString()}
              style={{
                fontSize: 24,
                fontWeight: 700,
                lineHeight: 1,
                marginBottom: 5,
                color: 'var(--text)',
                fontFeatureSettings: '"tnum"',
              }}
            >
              {formatCount(summary[key])}
            </div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)' }}>
              {label}
            </div>
          </div>
        </div>
      ))}
    </section>
  );
}
