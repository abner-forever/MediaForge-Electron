interface Props {
  balance: number;
  todayEarned: number;
}

export default function BalanceCard({ balance, todayEarned }: Props) {
  return (
    <div
      style={{
        background: 'var(--accent)',
        borderRadius: 'var(--radius-lg)',
        padding: '28px 32px',
        color: '#fff',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'relative' }}>
        <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 8 }}>当前积分</div>
        <div style={{ fontSize: 42, fontWeight: 700, letterSpacing: -1, lineHeight: 1.1 }}>
          {balance.toLocaleString()}
        </div>
        <div style={{ fontSize: 13, opacity: 0.75, marginTop: 12 }}>
          今日已获得 <span style={{ fontWeight: 600 }}>{todayEarned}</span> 积分
        </div>
      </div>
    </div>
  );
}
