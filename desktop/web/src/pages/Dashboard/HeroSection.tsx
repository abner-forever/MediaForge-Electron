import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import type { HealthStatus } from '../../api/client';
import StatusDot, { getGreeting } from './StatusDot';

function useCurrentTime() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

function formatTime(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const w = weekdays[d.getDay()];
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  const sec = pad(d.getSeconds());
  return `${y}/${m}/${day} 周${w} ${h}:${min}:${sec}`;
}

export default function HeroSection({ health }: { health: HealthStatus | null }) {
  const now = useCurrentTime();
  const navigate = useNavigate();
  const statusItems: { label: string; ok: boolean | undefined; hash: string }[] = [
    { label: '平台认证', ok: health?.platform_auth, hash: 'system-media-source' },
    { label: '微博 Cookie', ok: health?.weibo_cookie, hash: 'system-media-source' },
    { label: 'AI API Key', ok: health?.ai_api_key, hash: 'system-llm' },
    { label: 'AI Base URL', ok: health?.ai_base_url, hash: 'system-llm' },
  ];

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--card-shadow)',
        padding: '32px 40px',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <h1 style={{
            fontSize: 28,
            fontWeight: 700,
            lineHeight: 1.2,
            letterSpacing: 0,
            margin: 0,
            color: 'var(--text)',
          }}>
            {getGreeting()}，创作者
          </h1>
          <p style={{
            fontSize: 13,
            fontWeight: 500,
            color: 'var(--text-muted)',
            margin: '4px 0 0',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {formatTime(now)}
          </p>
          <p style={{
            fontSize: 16,
            fontWeight: 400,
            lineHeight: 1.5,
            color: 'var(--text-secondary)',
            margin: '8px 0 0',
            maxWidth: 560,
          }}>
            AI 驱动的图文创作工作流 — 发现、评分、发布，一站式完成
          </p>
        </div>
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px 24px',
          paddingTop: 16,
          borderTop: '1px solid var(--border-subtle)',
        }}>
          {statusItems.map((item) => (
            <span
              key={item.label}
              onClick={() => navigate({ pathname: '/settings', hash: item.hash })}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                color: 'var(--text-muted)',
                cursor: 'pointer',
                transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              <StatusDot ok={item.ok} />
              {item.label}
            </span>
          ))}
        </div>
      </div>
    </motion.section>
  );
}
